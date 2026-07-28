# scripts/sidecar_entry.py — PyInstaller entry point for CantoTTS Sidecar

import multiprocessing
import sys
from canto_tts.api.app import main

if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
