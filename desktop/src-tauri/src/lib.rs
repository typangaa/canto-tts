// CantoTTS Desktop App — Tauri v2 entry point & Rust sidecar / engine supervisor

use std::process::Child;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

/// Managed state for the Python engine child process
pub struct EngineProcess(pub Mutex<Option<Child>>);

/// Check if port is already listening locally
fn is_port_in_use(port: u16) -> bool {
    std::net::TcpStream::connect(("127.0.0.1", port)).is_ok()
}

/// Locate Python executable and spawn canto_tts.api.app server across Linux, macOS, and Windows
fn try_start_python_engine(port: u16, state: &EngineProcess) -> Result<String, String> {
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

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW flag (0x08000000) prevents spawning console window on Windows
        cmd.creation_flags(0x08000000);
    }

    match cmd.spawn() {
        Ok(child) => {
            if let Ok(mut lock) = state.0.lock() {
                *lock = Some(child);
            }
            Ok(format!("Successfully launched Python engine server on port {}", port))
        }
        Err(e) => Err(format!("Failed to launch Python engine (exec: {}): {}", python_exec, e)),
    }
}

#[tauri::command]
fn start_python_engine(state: tauri::State<'_, EngineProcess>, port: Option<u16>) -> Result<String, String> {
    let listen_port = port.unwrap_or(8000);
    try_start_python_engine(listen_port, &state)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(EngineProcess(Mutex::new(None)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // 1. Auto-check and spin up Python server on default port 8000
            let default_port = 8000;
            let state = app.state::<EngineProcess>();
            if let Err(err) = try_start_python_engine(default_port, &state) {
                eprintln!("Warning: Auto-start python engine notice: {}", err);
            }

            // 2. Spawn bundled sidecar binary if present
            if let Ok(sidecar) = app.handle().shell().sidecar("canto-tts-sidecar") {
                let sidecar_port = portpicker::pick_unused_port().unwrap_or(8960);
                let _ = sidecar
                    .env("CANTO_TTS_PORT", sidecar_port.to_string())
                    .spawn();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![start_python_engine])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
            let state = app_handle.state::<EngineProcess>();
            let child_opt = state.0.lock().ok().and_then(|mut lock| lock.take());
            if let Some(mut child) = child_opt {
                println!("Terminating Python engine child process...");
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        _ => {}
    });
}
