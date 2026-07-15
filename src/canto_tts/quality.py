"""canto_tts.quality — opt-in inference-time quality modes.

Backend-agnostic wrappers around TTSBackend.synthesize() that trade extra
compute for better output selection, WITHOUT any retraining. Both modes only
ever operate on top of a backend's existing single-draw synthesize() — they
never change what a single draw looks like, only which draw(s) get kept.

Deliberately NOT the default for TTSBackend.synthesize() itself (each backend
stays a single deterministic-cost draw) — CantoTTS.synthesize()'s `quality=`
kwarg is where these get wired in, so:
  - eval/harness.py-style N-repeat variance measurement (in the private repo)
    stays uncontaminated if it ever calls a backend directly.
  - Callers who want the current cheap/fast single-draw behavior (the
    self-hosted demo's default, latency-sensitive use) get it unchanged.

Two modes, cheapest first:

  duration_filter (Rank 1): generate up to `max_attempts` draws, keep the one
  whose duration is closest to the phoneme-length-calibrated expectation
  (backends.base.expected_duration_seconds). Catches the two most common
  catastrophic AR-codec failure modes -- early truncation and runaway
  looping -- without needing any ASR. Cheap (~1-3 draws, no extra model).

  best_of_n (Rank 2): generate `best_of_n` independent draws, transcribe each
  via a local ASR model (lazy-imported), keep the lowest character-error-rate
  candidate vs. the input text. Strictly more expensive (an ASR pass per
  candidate) but catches quality issues duration alone can't (wrong tones,
  mispronunciation, garbled code-switch segments) -- see research notes in
  the project's private PROGRESS.md for citations (VALL-E 2 RAS, Tortoise-TTS
  CLVP/CVVP precedent for ASR/scorer-based best-of-N reranking).

  Two ASR backends, selected via `asr_backend`: "whisper" (default,
  faster-whisper + the alvanlii/whisper-small-cantonese fine-tune,
  `canto-tts[quality]`, torch-free) or "sensevoice" (SenseVoice-Small,
  `canto-tts[quality-sensevoice]`). Measured on this project's own
  generation output (16-candidate real-checkpoint sample, 2026-07-15):
  the whisper default's mean CER is 0.036 vs sensevoice's 0.053 -- whisper
  is more accurate here, but sensevoice is still ~7x faster per candidate
  (CTC, no autoregressive decode loop), at the cost of pulling in
  torch+torchaudio (funasr hard-requires them even for CPU inference) and a
  non-OSI ModelScope model license (commercial use permitted). Pick whisper
  when accuracy matters most (the default), sensevoice when candidate count
  or call volume makes the latency difference dominate. See quality.py's
  Rank-2 section for the full tradeoff.
"""
from __future__ import annotations

import math
import os
import re
import tempfile
from typing import Any, Optional

from canto_tts.backends.base import TTSBackend, char_error_rate, expected_duration_seconds

_PUNCT_RE = re.compile(r"[。！？，、；：「」『』（）,.!?;:()\"'\s]+")


def _normalize_for_cer(text: str) -> str:
    """Strip punctuation/whitespace so ASR-transcribed candidates (which never
    include the source's punctuation) aren't penalized for it uniformly."""
    return _PUNCT_RE.sub("", text)


def _new_temp_wav() -> str:
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    return tmp.name


def _finalize(chosen_path: str, out_path: str, all_paths: list[str]) -> str:
    """Move the chosen candidate to out_path, clean up the rest."""
    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)
    os.replace(chosen_path, out_path)
    for p in all_paths:
        if p != chosen_path and os.path.exists(p):
            os.unlink(p)
    return out_path


# ── Rank 1: duration filter + redraw ─────────────────────────────────────────

def duration_filter_synthesize(
    backend: TTSBackend,
    text: str,
    out_path: str,
    *,
    max_attempts: int = 3,
    min_ratio: float = 0.5,
    max_ratio: float = 1.8,
    synth_kwargs: Optional[dict[str, Any]] = None,
) -> str:
    """Generate up to `max_attempts` draws; keep whichever duration is closest
    to the phoneme-length-calibrated expectation. Stops early (no wasted
    draws) the first time a draw lands inside [min_ratio, max_ratio] of the
    expected duration. Falls back to the least-bad draw seen if none land in
    range within the attempt budget -- this mode can only ever match or beat
    a single plain draw, never do worse."""
    import soundfile as sf

    synth_kwargs = synth_kwargs or {}
    phoneme = backend.to_phoneme(text)
    expected = expected_duration_seconds(phoneme)

    attempts: list[str] = []
    best_path: Optional[str] = None
    best_score = math.inf

    for _ in range(max(1, max_attempts)):
        tmp = _new_temp_wav()
        backend.synthesize(text, tmp, **synth_kwargs)
        attempts.append(tmp)

        duration = sf.info(tmp).duration
        ratio = duration / expected if expected > 0 else 1.0
        # log-distance from ratio=1.0 -- symmetric for "too short" vs "too long"
        score = abs(math.log(ratio)) if ratio > 0 else math.inf
        if score < best_score:
            best_score, best_path = score, tmp

        if min_ratio <= ratio <= max_ratio:
            break

    assert best_path is not None
    return _finalize(best_path, out_path, attempts)


# ── Rank 2: best-of-N + ASR rerank ───────────────────────────────────────────
#
# Two interchangeable ASR rerankers, picked via `asr_backend`. Measured on
# this project's own generation output (16-candidate real-checkpoint sample,
# 2026-07-15; mean CER = the ASR's own transcription error vs. known text,
# i.e. how sharp a reranking signal it gives -- lower is better):
#
#   asr_backend="whisper" (default): a Cantonese fine-tune of
#   openai/whisper-small (alvanlii/whisper-small-cantonese, Apache-2.0),
#   loaded via faster-whisper / CTranslate2 -- torch-free,
#   `canto-tts[quality]` only. Measured mean CER 0.036 -- best of all
#   options tested (including the stock multilingual "small", 0.265, and
#   SenseVoice-Small, 0.053), at stock-"small" latency (~1.3s/candidate).
#   MUST use `language="zh"`, not "yue" -- "yue" triggers decoder collapse
#   on Whisper-family models (empty/garbage output; confirmed both in this
#   project's own testing and independently in the private sibling corpus
#   pipeline's KNOWN_ISSUES.md). The stock multilingual model is decisively
#   worse (~7x higher CER) and is not exposed as an option -- there's no
#   real use case for it once the fine-tune is the only extra download
#   involved either way.
#
#   asr_backend="sensevoice": SenseVoice-Small (funasr), CTC
#   non-autoregressive, native Cantonese ("yue" -- architecturally distinct
#   from Whisper, unaffected by the yue-collapse bug above). Measured mean
#   CER 0.053 -- between the two whisper options above -- but ~7x faster per
#   candidate than either (CTC has no autoregressive decode loop, ~0.18s vs
#   ~1.3s/candidate). Cost: funasr hard-requires torch+torchaudio at import
#   time (not declared as its own dependency, but `import torch` fails
#   loudly without it) even for CPU-only inference, so this is a separate,
#   heavier extra (`canto-tts[quality-sensevoice]`), not folded into the
#   default `quality` extra. Also emits Simplified Chinese (converted to
#   Traditional HK via OpenCC s2hk) and ModelScope's model license is
#   non-OSI (commercial use permitted; see project docs). Worth choosing
#   over the whisper default when candidate count or call volume is high
#   enough that the ~7x latency difference matters more than the accuracy
#   gap, and the torch dependency is acceptable.

_ASR_CACHE: dict[str, Any] = {}
_TAG_RE = re.compile(r"<\|[^|]*\|>")


# alvanlii/whisper-small-cantonese (Apache-2.0): a Cantonese fine-tune of
# openai/whisper-small, ships a pre-converted CTranslate2 bundle under its
# `cts/` subfolder -- no local conversion needed, no extra dependency beyond
# faster-whisper's own (huggingface_hub is already a core canto-tts dep).
# Measured mean CER 0.036 on this project's own generation output (same
# 16-candidate sample as the sensevoice comparison, language="zh" -- NOT
# "yue", which triggers decoder collapse on Whisper-family models), beating
# both the stock multilingual "small" (0.265) and SenseVoice-Small (0.053),
# at comparable per-candidate latency to stock "small" (~1.3s). This is the
# only whisper model asr_backend="whisper" ever loads -- the stock
# multilingual model isn't exposed as an option (see Rank-2 comment above).
_CANTONESE_SMALL_REPO = "alvanlii/whisper-small-cantonese"


def _resolve_cantonese_small() -> str:
    from huggingface_hub import snapshot_download

    local_dir = snapshot_download(_CANTONESE_SMALL_REPO, allow_patterns=["cts/*"])
    return f"{local_dir}/cts"


def _get_whisper_model():
    key = "whisper"
    if key not in _ASR_CACHE:
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise ImportError(
                "asr_backend='whisper' requires the 'quality' extra: "
                "pip install \"canto-tts[quality]\" (adds faster-whisper)."
            ) from exc
        _ASR_CACHE[key] = WhisperModel(_resolve_cantonese_small(), device="cpu", compute_type="int8")
    return _ASR_CACHE[key]


def _transcribe_whisper(model, path: str) -> str:
    segments, _ = model.transcribe(path, language="zh", task="transcribe")
    return "".join(s.text for s in segments).strip()


def _get_sensevoice_model():
    key = ("sensevoice", None)
    if key not in _ASR_CACHE:
        try:
            from funasr import AutoModel
        except ImportError as exc:
            raise ImportError(
                "asr_backend='sensevoice' requires the 'quality-sensevoice' extra: "
                "pip install \"canto-tts[quality-sensevoice]\" "
                "(adds funasr, modelscope, torch, torchaudio, opencc)."
            ) from exc
        # disable_update: skip funasr's home-phone-in version check on every load.
        _ASR_CACHE[key] = AutoModel(
            model="iic/SenseVoiceSmall", trust_remote_code=True, device="cpu", disable_update=True
        )
    return _ASR_CACHE[key]


def _transcribe_sensevoice(model, path: str) -> str:
    from opencc import OpenCC

    cc = OpenCC("s2hk")
    result = model.generate(input=path, cache={}, language="yue", use_itn=True)
    raw = result[0]["text"] if result else ""
    return cc.convert(_TAG_RE.sub("", raw).strip())


def best_of_n_synthesize(
    backend: TTSBackend,
    text: str,
    out_path: str,
    *,
    best_of_n: int = 4,
    asr_backend: str = "whisper",
    synth_kwargs: Optional[dict[str, Any]] = None,
) -> str:
    """Generate `best_of_n` independent draws, transcribe each via a local ASR
    model, keep the lowest character-error-rate candidate vs. `text`.

    asr_backend: "whisper" (default, `canto-tts[quality]`, torch-free --
    always the alvanlii/whisper-small-cantonese fine-tune, see module
    docstring) or "sensevoice" (`canto-tts[quality-sensevoice]`, pulls in
    torch -- see module docstring for the measured comparison; sensevoice
    is ~7x faster per candidate but less accurate than the whisper default).
    """
    synth_kwargs = synth_kwargs or {}
    if asr_backend == "whisper":
        asr = _get_whisper_model()
        transcribe = _transcribe_whisper
    elif asr_backend == "sensevoice":
        asr = _get_sensevoice_model()
        transcribe = _transcribe_sensevoice
    else:
        raise ValueError(f"Unknown asr_backend {asr_backend!r} -- expected 'whisper' or 'sensevoice'.")

    ref_norm = _normalize_for_cer(text)

    attempts: list[str] = []
    best_path: Optional[str] = None
    best_cer = math.inf

    for _ in range(max(1, best_of_n)):
        tmp = _new_temp_wav()
        backend.synthesize(text, tmp, **synth_kwargs)
        attempts.append(tmp)

        hyp = transcribe(asr, tmp)
        cer = char_error_rate(ref_norm, _normalize_for_cer(hyp))
        if cer < best_cer:
            best_cer, best_path = cer, tmp

    assert best_path is not None
    return _finalize(best_path, out_path, attempts)
