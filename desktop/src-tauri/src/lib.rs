// CantoTTS Desktop App — Tauri v2 entry point & Rust sidecar / engine supervisor

use std::process::Child;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[cfg(target_os = "linux")]
use webkit2gtk::{PermissionRequestExt, SettingsExt, WebViewExt};

/// Managed state for the Python engine child process and sidecar process
pub struct EngineProcess {
    pub python_child: Mutex<Option<Child>>,
    pub sidecar_child: Mutex<Option<CommandChild>>,
}

/// Check if port is already listening locally
fn is_port_in_use(port: u16) -> bool {
    std::net::TcpStream::connect(("127.0.0.1", port)).is_ok()
}

/// Path to the locally-persisted HuggingFace access token (optional). Storing it lets a user
/// authenticate model-weight downloads with their own free HF account instead of hitting HF
/// Hub's anonymous-request rate limit, which is what causes first-run downloads to queue for a
/// long time on a shared/anonymous quota.
fn hf_token_file(app_handle: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to resolve app config dir: {}", e))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app config dir: {}", e))?;
    Ok(dir.join("hf_token"))
}

fn read_hf_token(app_handle: &AppHandle) -> Option<String> {
    let path = hf_token_file(app_handle).ok()?;
    let token = std::fs::read_to_string(path).ok()?;
    let token = token.trim().to_string();
    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

#[tauri::command]
fn set_hf_token(app_handle: AppHandle, token: String) -> Result<(), String> {
    let path = hf_token_file(&app_handle)?;
    let token = token.trim();
    if token.is_empty() {
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| format!("Failed to clear token: {}", e))?;
        }
        return Ok(());
    }
    std::fs::write(&path, token).map_err(|e| format!("Failed to save token: {}", e))
}

#[tauri::command]
fn get_hf_token(app_handle: AppHandle) -> Result<String, String> {
    Ok(read_hf_token(&app_handle).unwrap_or_default())
}

/// Locate Python executable and spawn canto_tts.api.app server across Linux, macOS, and Windows.
///
/// Dev-convenience only: packaged/release builds never call this (see `cfg!(debug_assertions)`
/// gates in `start_python_engine` / `setup()`) — a shipped app has no `.venv` to find and this
/// would always fail, so release builds go straight to the bundled sidecar.
fn try_start_python_engine(app_handle: Option<&AppHandle>, port: u16, state: &EngineProcess) -> Result<String, String> {
    if is_port_in_use(port) {
        return Ok(format!("Engine server is already running on port {}", port));
    }

    let default_binary = if cfg!(target_os = "windows") { "python.exe" } else { "python3" };
    let mut python_exec = default_binary.to_string();

    // Cross-platform virtualenv relative path checks
    let venv_rel_paths = if cfg!(target_os = "windows") {
        vec![".venv\\Scripts\\python.exe", "..\\.venv\\Scripts\\python.exe", "..\\..\\.venv\\Scripts\\python.exe"]
    } else {
        vec![".venv/bin/python3", "../.venv/bin/python3", "../../.venv/bin/python3", ".venv/bin/python", "../.venv/bin/python"]
    };

    // Search current working directory and parent ancestors for virtualenv
    if let Ok(cwd) = std::env::current_dir() {
        for ancestor in cwd.ancestors() {
            let candidate = if cfg!(target_os = "windows") {
                ancestor.join(".venv").join("Scripts").join("python.exe")
            } else {
                ancestor.join(".venv").join("bin").join("python3")
            };
            if candidate.exists() {
                python_exec = candidate.to_string_lossy().to_string();
                break;
            }
        }
    }

    // Fallback relative checks
    if python_exec == default_binary {
        for rel in &venv_rel_paths {
            if std::path::Path::new(rel).exists() {
                python_exec = rel.to_string();
                break;
            }
        }
    }

    println!("Starting Python Engine Server using executable: {}", python_exec);

    let mut cmd = std::process::Command::new(&python_exec);
    cmd.arg("-m")
       .arg("canto_tts.api.app")
       .arg("--port")
       .arg(port.to_string());

    if let Some(token) = app_handle.and_then(read_hf_token) {
        cmd.env("HF_TOKEN", token);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW flag (0x08000000) prevents spawning console window on Windows
        cmd.creation_flags(0x08000000);
    }

    let mut lock = state
        .python_child
        .lock()
        .map_err(|e| format!("Failed to lock python_child state: {}", e))?;

    if let Some(mut existing) = lock.take() {
        println!("Terminating previous Python engine child process...");
        let _ = existing.kill();
        let _ = existing.wait();
    }

    match cmd.spawn() {
        Ok(child) => {
            *lock = Some(child);
            Ok(format!("Successfully launched Python engine server on port {}", port))
        }
        Err(e) => Err(format!("Failed to launch Python engine (exec: {}): {}", python_exec, e)),
    }
}

/// Spawn the bundled `canto-tts-sidecar` binary, guarding against a duplicate spawn while one is
/// already tracked in state (e.g. still downloading model weights on first launch — the listen
/// port isn't bound yet during that window, so a naive second spawn would silently succeed and
/// race the first one). Forwards stdout/stderr (incl. HuggingFace Hub's tqdm download progress)
/// to the frontend via an `engine-log` event.
fn spawn_sidecar(app_handle: &AppHandle, state: &EngineProcess, port: u16) -> Result<String, String> {
    if is_port_in_use(port) {
        return Ok(format!("Engine server is already running on port {}", port));
    }

    {
        let lock = state
            .sidecar_child
            .lock()
            .map_err(|e| format!("Failed to lock sidecar_child state: {}", e))?;
        if lock.is_some() {
            return Ok(format!("Sidecar engine is already starting on port {}", port));
        }
    }

    let mut sidecar = app_handle
        .shell()
        .sidecar("canto-tts-sidecar")
        .map_err(|e| format!("Failed to resolve bundled sidecar binary: {}", e))?
        .env("CANTO_TTS_PORT", port.to_string());

    if let Some(token) = read_hf_token(app_handle) {
        sidecar = sidecar.env("HF_TOKEN", token);
    }

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    {
        let mut lock = state
            .sidecar_child
            .lock()
            .map_err(|e| format!("Failed to lock sidecar_child state: {}", e))?;
        *lock = Some(child);
    }

    let app_handle_task = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line).to_string();
                    let _ = app_handle_task.emit("engine-log", text);
                }
                CommandEvent::Error(err) => {
                    let _ = app_handle_task.emit("engine-log", format!("[error] {}", err));
                }
                CommandEvent::Terminated(payload) => {
                    // Clear state so a future launch attempt isn't blocked by a stale "already
                    // starting" guard once the process has actually exited.
                    if let Some(engine_state) = app_handle_task.try_state::<EngineProcess>() {
                        if let Ok(mut lock) = engine_state.sidecar_child.lock() {
                            *lock = None;
                        }
                    }
                    let _ = app_handle_task.emit("engine-log", format!("[sidecar terminated: {:?}]", payload));
                }
                _ => {}
            }
        }
    });

    Ok(format!("已成功啟動 Sidecar 引擎 (Port: {})", port))
}

#[tauri::command]
fn start_python_engine(app_handle: AppHandle, state: tauri::State<'_, EngineProcess>, port: Option<u16>) -> Result<String, String> {
    let listen_port = port.unwrap_or(8000);

    // Dev-convenience only: in a packaged/release build there is no `.venv` to find, so skip
    // straight to the bundled sidecar rather than probing for one and failing every time.
    if cfg!(debug_assertions) {
        if let Ok(msg) = try_start_python_engine(Some(&app_handle), listen_port, &state) {
            return Ok(msg);
        }
    }

    spawn_sidecar(&app_handle, &state, listen_port)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(EngineProcess {
            python_child: Mutex::new(None),
            sidecar_child: Mutex::new(None),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Enable WebKitGTK media stream and handle permission requests on Linux
            #[cfg(target_os = "linux")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.with_webview(|webview| {
                    let webview_ptr = webview.inner();
                    if let Some(settings) = webview_ptr.settings() {
                        settings.set_enable_media_stream(true);
                        settings.set_enable_webrtc(true);
                    }
                    webview_ptr.connect_permission_request(|_webview, req| {
                        req.allow();
                        true
                    });
                });
            }

            let default_port = 8000;
            let state = app.state::<EngineProcess>();
            let app_handle = app.handle().clone();

            // 1. Dev-only: try local `.venv` Python environment first.
            if cfg!(debug_assertions) {
                if let Err(err) = try_start_python_engine(Some(&app_handle), default_port, &state) {
                    eprintln!("Warning: Auto-start python engine notice: {}", err);
                }
            }

            // 2. Everyone else (incl. release builds where step 1 is skipped entirely): the
            //    bundled sidecar is the actual engine. Only spawn it if a python engine isn't
            //    already active from step 1.
            let python_active = is_port_in_use(default_port)
                || state
                    .python_child
                    .lock()
                    .map_or(false, |guard| guard.is_some());

            if !python_active {
                if let Err(err) = spawn_sidecar(&app_handle, &state, default_port) {
                    eprintln!("Warning: sidecar auto-start failed: {}", err);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![start_python_engine, set_hf_token, get_hf_token])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::Exit => {
            let state = app_handle.state::<EngineProcess>();

            let python_opt = state.python_child.lock().ok().and_then(|mut lock| lock.take());
            if let Some(mut child) = python_opt {
                println!("Terminating Python engine child process...");
                let _ = child.kill();
                let _ = child.wait();
            }

            let sidecar_opt = state.sidecar_child.lock().ok().and_then(|mut lock| lock.take());
            if let Some(child) = sidecar_opt {
                println!("Terminating sidecar child process...");
                let _ = child.kill();
            }
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;

    #[test]
    fn test_engine_process_mutex_concurrency() {
        let state = Arc::new(EngineProcess {
            python_child: Mutex::new(None),
            sidecar_child: Mutex::new(None),
        });

        let mut handles = vec![];
        for _ in 0..10 {
            let state_clone = Arc::clone(&state);
            handles.push(thread::spawn(move || {
                let lock = state_clone.python_child.lock();
                assert!(lock.is_ok());
            }));
        }

        for h in handles {
            h.join().unwrap();
        }
    }

    #[test]
    fn test_try_start_python_engine_replacement() {
        let state = EngineProcess {
            python_child: Mutex::new(None),
            sidecar_child: Mutex::new(None),
        };
        // Test spawning/replacing python process on an unused port
        let unused_port = portpicker::pick_unused_port().unwrap_or(18960);
        let res1 = try_start_python_engine(None, unused_port, &state);
        // It should attempt execution using system python
        if res1.is_ok() {
            // Call again on another port to test killing and replacing previous child process
            let unused_port2 = portpicker::pick_unused_port().unwrap_or(18961);
            let res2 = try_start_python_engine(None, unused_port2, &state);
            assert!(res2.is_ok());
            // Clean up state
            if let Ok(mut lock) = state.python_child.lock() {
                if let Some(mut child) = lock.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    }
}
