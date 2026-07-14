"""
canto-tts quickstart
====================

Demonstrates the minimal 3-line SDK usage.

⚠️ Weights are NOT published yet (source-only preview, see repo README Status
section) — CantoTTS() with no arguments will fail on auto-download for now.
Pass `checkpoint=` pointing at a local bundle from scripts/export_onnx.py.
Once weights are published to HuggingFace (typangaa/canto-tts-nano, ~400 MB),
CantoTTS() with no arguments will auto-download and cache them via the Hugging
Face Hub cache (~/.cache/huggingface/hub/) and this example will work as-is.

Requirements (install from source until published to PyPI, see README):
    pip install -e .          # ONNX Runtime backend (default, no GPU needed)
    # OR
    pip install -e ".[torch]" # PyTorch backend
"""

from canto_tts import CantoTTS

# ── Basic Cantonese synthesis ────────────────────────────────────────────────
tts = CantoTTS(checkpoint="/path/to/your/exported/onnx_weights")  # see module docstring
tts.synthesize("多謝晒，今日天氣幾好。", "hello.wav")
print("Saved to hello.wav")

# ── Code-switching also works (Cantonese + English) ─────────────────────────
# English words are kept as orthography and read naturally within the Cantonese
# sentence — no extra configuration needed.
tts.synthesize("我哋一齊去 IFC food court 食飯。", "codeswitching.wav")
print("Saved to codeswitching.wav")
