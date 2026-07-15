"""Unit tests for canto_tts.quality — mock the backend and ASR calls so these
run with no model downloads (no faster-whisper/funasr network access needed).
"""
from __future__ import annotations

import os
import wave

import pytest

from canto_tts import quality as quality_mod
from canto_tts.backends.base import TTSBackend, expected_duration_seconds
from canto_tts.quality import (
    _normalize_for_cer,
    best_of_n_synthesize,
    duration_filter_synthesize,
)


def _write_silence_wav(path: str, duration_seconds: float, sr: int = 16000) -> None:
    n_frames = max(1, int(duration_seconds * sr))
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b"\x00\x00" * n_frames)


class _FakeBackend(TTSBackend):
    """Each synthesize() call writes a real (silent) wav whose duration comes
    from `durations` in order, so duration_filter_synthesize's sf.info() read
    succeeds without any real model."""

    def __init__(self, durations=None):
        self.durations = list(durations or [])
        self.call_count = 0

    @staticmethod
    def to_phoneme(text: str) -> str:
        return text

    def synthesize(self, text: str, out_path: str, **kwargs) -> str:
        idx = self.call_count
        duration = self.durations[idx] if idx < len(self.durations) else 1.0
        self.call_count += 1
        _write_silence_wav(out_path, duration)
        return out_path


# A phoneme string whose expected_duration_seconds() lands near 1.0s, so the
# test's `durations` ratios below are easy to reason about.
_PHONEME = "a" * round(1.0 / 0.0213)


# ── duration_filter_synthesize ────────────────────────────────────────────────


def test_duration_filter_stops_early_on_in_range_draw(tmp_path):
    import soundfile as sf

    expected = expected_duration_seconds(_PHONEME)
    assert expected == pytest.approx(1.0, abs=0.05)

    # First draw way too long (ratio ~3, outside [0.5, 1.8]); second draw is
    # in range and should trigger an early stop -- third duration must never
    # be consumed.
    backend = _FakeBackend(durations=[3.0, 1.0, 999.0])
    out_path = str(tmp_path / "out.wav")

    result = duration_filter_synthesize(backend, _PHONEME, out_path, max_attempts=3)

    assert result == out_path
    assert backend.call_count == 2
    assert sf.info(out_path).duration == pytest.approx(1.0, abs=0.05)


def test_duration_filter_falls_back_to_least_bad_draw(tmp_path):
    import soundfile as sf

    # None of these land in [0.5, 1.8] -- picks whichever has the smallest
    # |log(ratio)| after exhausting the full attempt budget. ratio=4.0 (score
    # ~1.386) beats ratio=5.0 (~1.609) and ratio=0.1 (~2.303).
    backend = _FakeBackend(durations=[5.0, 0.1, 4.0])
    out_path = str(tmp_path / "out.wav")

    result = duration_filter_synthesize(backend, _PHONEME, out_path, max_attempts=3)

    assert result == out_path
    assert backend.call_count == 3
    assert sf.info(out_path).duration == pytest.approx(4.0, abs=0.05)


def test_duration_filter_cleans_up_rejected_attempts(tmp_path):
    backend = _FakeBackend(durations=[3.0, 1.0])
    out_path = str(tmp_path / "out.wav")

    duration_filter_synthesize(backend, _PHONEME, out_path, max_attempts=2)

    # Only the final out_path should remain -- the OS temp dir shouldn't
    # accumulate the rejected draw.
    assert os.path.exists(out_path)


# ── best_of_n_synthesize ──────────────────────────────────────────────────────


def test_best_of_n_picks_lowest_cer_candidate(tmp_path, monkeypatch):
    import soundfile as sf

    ref_text = "我今日去咗街市買嘢。"
    hyps = [
        "完全唔啱嘅野丙丁戊己",  # way off -> high CER
        "我今日去咗街市買嘢",  # exact match after punctuation stripping -> CER 0
        "我今日去街市買嘢啦",  # close but not exact -> some CER > 0
    ]
    call_count = {"n": 0}

    def fake_transcribe(model, path):
        i = call_count["n"]
        call_count["n"] += 1
        return hyps[i]

    monkeypatch.setattr(quality_mod, "_get_whisper_model", lambda: object())
    monkeypatch.setattr(quality_mod, "_transcribe_whisper", fake_transcribe)

    # Distinct durations per candidate so the chosen wav is identifiable.
    backend = _FakeBackend(durations=[1.0, 2.0, 3.0])
    out_path = str(tmp_path / "out.wav")

    result = best_of_n_synthesize(backend, ref_text, out_path, best_of_n=3, asr_backend="whisper")

    assert result == out_path
    assert backend.call_count == 3  # best_of_n always draws the full budget
    # Candidate 1 (duration 2.0) had the exact-match transcript -> CER 0.
    assert sf.info(out_path).duration == pytest.approx(2.0, abs=0.05)


def test_best_of_n_sensevoice_backend(tmp_path, monkeypatch):
    import soundfile as sf

    ref_text = "多謝晒。"
    hyps = ["多謝晒", "唔該"]
    call_count = {"n": 0}

    def fake_transcribe(model, path):
        i = call_count["n"]
        call_count["n"] += 1
        return hyps[i]

    monkeypatch.setattr(quality_mod, "_get_sensevoice_model", lambda: object())
    monkeypatch.setattr(quality_mod, "_transcribe_sensevoice", fake_transcribe)

    backend = _FakeBackend(durations=[1.0, 2.0])
    out_path = str(tmp_path / "out.wav")

    result = best_of_n_synthesize(backend, ref_text, out_path, best_of_n=2, asr_backend="sensevoice")

    assert result == out_path
    assert sf.info(out_path).duration == pytest.approx(1.0, abs=0.05)


def test_best_of_n_unknown_backend_raises(tmp_path):
    backend = _FakeBackend(durations=[1.0])
    out_path = str(tmp_path / "out.wav")

    with pytest.raises(ValueError, match="Unknown asr_backend"):
        best_of_n_synthesize(backend, "你好", out_path, best_of_n=1, asr_backend="nonexistent")


# ── _normalize_for_cer ────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("我今日去咗街市買嘢。", "我今日去咗街市買嘢"),
        ("Hello, world!", "Helloworld"),
        ("  多 空格   同、標點；：符號  ", "多空格同標點符號"),
    ],
)
def test_normalize_for_cer_strips_punctuation_and_whitespace(raw, expected):
    assert _normalize_for_cer(raw) == expected
