#!/usr/bin/env python3
"""
scripts/build_sidecar.py
~~~~~~~~~~~~~~~~~~~~~~~~~
Builds the CantoTTS PyInstaller standalone sidecar executable and places it in
the Tauri sidecar binary directory (desktop/src-tauri/bin/).
"""

import platform
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent.resolve()
DESKTOP_TAURI_BIN_DIR = ROOT_DIR / "desktop" / "src-tauri" / "bin"


def get_target_triple() -> str:
    """Get Tauri target triple for the current operating system and architecture."""
    machine = platform.machine().lower()
    system = platform.system().lower()

    if machine in ("x86_64", "amd64"):
        arch = "x86_64"
    elif machine in ("aarch64", "arm64"):
        arch = "aarch64"
    else:
        arch = machine

    if system == "linux":
        return f"{arch}-unknown-linux-gnu"
    elif system == "darwin":
        return f"{arch}-apple-darwin"
    elif system == "windows":
        return f"{arch}-pc-windows-msvc"
    else:
        return f"{arch}-{system}"


def build_sidecar() -> Path:
    target_triple = get_target_triple()
    executable_name = f"canto-tts-sidecar-{target_triple}"
    if platform.system() == "Windows":
        executable_name += ".exe"

    DESKTOP_TAURI_BIN_DIR.mkdir(parents=True, exist_ok=True)
    entry_script = ROOT_DIR / "scripts" / "sidecar_entry.py"

    import canto_hk_g2p
    g2p_dir = Path(canto_hk_g2p.__file__).parent

    sep = ";" if platform.system() == "Windows" else ":"

    pyinstaller_cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--onefile",
        "--name",
        executable_name,
        "--distpath",
        str(DESKTOP_TAURI_BIN_DIR),
        "--workpath",
        str(ROOT_DIR / "build" / "pyinstaller_work"),
        "--specpath",
        str(ROOT_DIR / "build"),
        "--add-data", f"{ROOT_DIR / 'src' / 'canto_tts' / 'api' / 'templates'}{sep}canto_tts/api/templates",
        "--add-data", f"{ROOT_DIR / 'src' / 'canto_tts' / 'api' / 'static'}{sep}canto_tts/api/static",
        "--add-data", f"{ROOT_DIR / 'src' / 'canto_tts' / '_vendor' / 'openmoss'}{sep}canto_tts/_vendor/openmoss",
        "--add-data", f"{g2p_dir}{sep}canto_hk_g2p",
        "--hidden-import", "canto_tts",
        "--hidden-import", "canto_tts.api.app",
        "--hidden-import", "canto_tts._vendor.openmoss.ort_cpu_runtime",
        "--hidden-import", "canto_hk_g2p",
        "--hidden-import", "onnxruntime",
        "--hidden-import", "scipy",
        "--hidden-import", "scipy.special",
        "--hidden-import", "scipy.signal",
        "--hidden-import", "soundfile",
        "--hidden-import", "fastapi",
        "--hidden-import", "uvicorn",
        "--hidden-import", "uvicorn.protocols",
        "--hidden-import", "uvicorn.protocols.http",
        "--hidden-import", "uvicorn.protocols.http.h11_impl",
        "--hidden-import", "uvicorn.lifespan",
        "--hidden-import", "uvicorn.lifespan.on",
        "--hidden-import", "uvicorn.loops",
        "--hidden-import", "uvicorn.loops.asyncio",
        "--hidden-import", "sentencepiece",
        "--hidden-import", "huggingface_hub",
        "--hidden-import", "huggingface_hub.file_download",
        "--hidden-import", "huggingface_hub.utils",
        "--hidden-import", "tqdm",
        "--hidden-import", "jinja2",
        "--hidden-import", "starlette",
        "--hidden-import", "pydantic",
        str(entry_script),
    ]

    print(f"Building sidecar binary: {executable_name}...")
    print("Command:", " ".join(pyinstaller_cmd))

    res = subprocess.run(pyinstaller_cmd, cwd=str(ROOT_DIR))
    if res.returncode != 0:
        print("ERROR: PyInstaller build failed!")
        sys.exit(res.returncode)

    target_binary = DESKTOP_TAURI_BIN_DIR / executable_name
    print(f"SUCCESS: Sidecar executable generated at {target_binary}")
    return target_binary


if __name__ == "__main__":
    build_sidecar()
