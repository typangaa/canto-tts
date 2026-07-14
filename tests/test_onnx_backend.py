"""
tests/test_onnx_backend.py
~~~~~~~~~~~~~~~~~~~~~~~~~~
Tests for the ONNX Runtime backend.

Design principles:
- Skip gracefully if `onnxruntime` is not installed.
- Skip the synthesis test if model weights are not cached locally or
  the network / HuggingFace Hub is unavailable — CI should not hard-fail
  because of a large weight download.
- One lightweight phoneme test (test_text_to_string) has zero weight
  dependency and should always pass in CI once the package is installed.
"""

import os

import pytest

# ---------------------------------------------------------------------------
# Module-level skip: nothing in this file can run without onnxruntime
# ---------------------------------------------------------------------------
onnxruntime = pytest.importorskip(
    "onnxruntime",
    reason="onnxruntime not installed — skipping ONNX backend tests",
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def tts_onnx():
    """
    Return a CantoTTS instance using the ONNX backend.

    Skips the test if:
    - canto_tts itself cannot be imported, or
    - the HuggingFace Hub download fails (no cached weights, no network).
    """
    try:
        import canto_tts  # noqa: PLC0415
    except ImportError as exc:
        pytest.skip(f"canto_tts not importable: {exc}")

    try:
        instance = canto_tts.CantoTTS(backend="onnx")
    except Exception as exc:  # noqa: BLE001
        # Covers HfHubHTTPError, OSError for missing cache, etc.
        pytest.skip(
            f"Could not instantiate CantoTTS (weights unavailable or download failed): {exc}"
        )

    return instance


# ---------------------------------------------------------------------------
# Test 1: full synthesis round-trip (requires weights)
# ---------------------------------------------------------------------------


def test_synthesize_produces_nonempty_wav(tts_onnx, tmp_path):
    """
    Synthesise a short Cantonese phrase and verify that a non-empty WAV file
    is written to disk.
    """
    out = tmp_path / "test_output.wav"
    tts_onnx.synthesize("測試。", str(out))

    assert out.exists(), f"Expected output file at {out} — file not created"
    assert os.path.getsize(str(out)) > 0, f"Output file at {out} is empty"


# ---------------------------------------------------------------------------
# Test 2: lightweight phoneme tokenisation — no weights needed
# ---------------------------------------------------------------------------


def test_text_to_string_returns_phoneme_tokens():
    """
    Verify that the G2P / phonemiser converts a Cantonese string into a
    non-empty token sequence containing at least one tone token (<t…).

    This test requires only the `canto_hk_g2p` package and no model weights,
    so it should always pass in CI once the package is installed.
    """
    # Skip if the G2P dependency is absent (separate optional install)
    canto_hk_g2p = pytest.importorskip(
        "canto_hk_g2p",
        reason="canto_hk_g2p not installed — skipping G2P unit test",
    )

    try:
        from canto_tts.core import cantophon  # noqa: PLC0415
    except ImportError as exc:
        pytest.skip(f"canto_tts.core.cantophon not importable: {exc}")

    result = cantophon.text_to_string("我係香港人")

    assert isinstance(result, str), "text_to_string should return a str"
    assert len(result) > 0, "text_to_string returned an empty string"
    assert "<t" in result, (
        f"Expected at least one tone token '<t…' in phoneme string, got: {result!r}"
    )
