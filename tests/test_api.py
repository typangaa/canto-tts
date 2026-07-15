"""Tests for the FastAPI demo server (canto_tts.api.app).

Uses a fake TTS backend to avoid loading real ONNX/torch models.  The
lifespan is neutralised by patching ``canto_tts.backends.factory.get_backend``
before the TestClient context starts, so no HuggingFace download is attempted.
"""
from __future__ import annotations

import wave
from unittest.mock import patch
from urllib.parse import unquote

import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Fake backend — same spirit as _FakeBackend in tests/test_quality.py
# ---------------------------------------------------------------------------

class _FakeBackend:
    """Writes a minimal valid WAV to out_path; returns a deterministic phoneme string."""

    def synthesize(self, text: str, out_path: str, **kwargs) -> str:
        # Write a tiny 1-frame silent WAV so the size-check in the handler passes.
        with wave.open(out_path, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(b"\x00\x00")
        return out_path

    @staticmethod
    def to_phoneme(text: str) -> str:
        # Real phoneme output preserves full-width punctuation from the
        # source text (e.g. "aa1 bb2 ， cc3") -- not latin-1-safe, so it
        # must be percent-encoded before use as an HTTP header value.
        return "aa1 bb2 ， cc3"


# ---------------------------------------------------------------------------
# Fixture: TestClient with fake backend injected via lifespan patch
# ---------------------------------------------------------------------------

@pytest.fixture()
def client():
    """Yield a TestClient whose lifespan never calls the real CantoTTS constructor.

    ``get_backend`` (called inside ``CantoTTS.__init__``) is patched to return
    the fake backend, so no model weights are downloaded.
    """
    from canto_tts.api.app import app

    fake = _FakeBackend()

    with patch("canto_tts.backends.factory.get_backend", return_value=fake):
        with TestClient(app, raise_server_exceptions=True) as c:
            yield c


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_synthesize_basic_returns_200_with_audio(client):
    """POST /synthesize with plain text returns 200, audio/wav content-type."""
    resp = client.post("/synthesize", json={"text": "你好"})
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("audio/")


def test_synthesize_basic_has_required_headers(client):
    """Custom X-Canto-* headers are present and quality-mode defaults to 'none'."""
    resp = client.post("/synthesize", json={"text": "你好"})
    assert resp.status_code == 200
    assert "x-canto-phonemes" in resp.headers
    assert "x-canto-latency-ms" in resp.headers
    assert "x-canto-quality-mode" in resp.headers
    assert resp.headers["x-canto-quality-mode"] == "none"


def test_synthesize_quality_duration_filter(client):
    """Passing quality='duration_filter' is accepted and reflected in the header."""
    resp = client.post("/synthesize", json={"text": "你好", "quality": "duration_filter"})
    assert resp.status_code == 200
    assert resp.headers["x-canto-quality-mode"] == "duration_filter"


def test_synthesize_invalid_quality_returns_422(client):
    """An unknown quality value triggers Pydantic validation -> 422."""
    resp = client.post("/synthesize", json={"text": "你好", "quality": "bogus"})
    assert resp.status_code == 422


def test_synthesize_invalid_asr_backend_returns_422(client):
    """An unknown asr_backend value triggers Pydantic validation -> 422."""
    resp = client.post("/synthesize", json={"text": "你好", "asr_backend": "bogus"})
    assert resp.status_code == 422


def test_synthesize_phonemes_header_is_percent_encoded(client):
    """X-Canto-Phonemes must survive round-trip even when the phoneme string
    contains non-latin-1 characters (real phoneme output preserves full-width
    punctuation from the source text) -- raw non-ASCII would crash FileResponse's
    header encoding (UnicodeEncodeError), so the server percent-encodes it."""
    resp = client.post("/synthesize", json={"text": "你好，世界。"})
    assert resp.status_code == 200
    assert unquote(resp.headers["x-canto-phonemes"]) == "aa1 bb2 ， cc3"
