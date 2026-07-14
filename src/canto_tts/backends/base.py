"""canto_tts.backends.base — backend-agnostic abstractions for canto-tts inference.

Defines the abstract TTSBackend interface and the shared pure helpers that every
backend (Torch, ONNX, …) needs:

  - TTSBackend: ABC with abstract synthesize() and concrete to_phoneme() staticmethod.
  - Control type alias (str | dict | None).
  - Duration-cap constants and adaptive_max_new_frames().
  - safe_prepare_text(): public, importable helper for text pre-processing
    (stock CJK-branch behaviour for ALL inputs — see torch_backend.py deviation #2).
"""
from __future__ import annotations

import abc
import math
from typing import Dict, Optional, Union

# ── type alias ───────────────────────────────────────────────────────────────

Control = Union[str, Dict[str, str], None]

# ── sentence-end punctuation ─────────────────────────────────────────────────

_SENTENCE_END = set("。！？.!?；;")

# ── adaptive duration-cap constants ──────────────────────────────────────────
#
# A fixed max_new_frames applies the SAME ceiling to every sentence regardless
# of length, so a short sentence has just as much "runway" to runaway-generate
# as a long one. ADAPTIVE_SEC_PER_PHONCHAR is the median observed
# (duration / phoneme-string-length) ratio across real generation draws.

ADAPTIVE_SEC_PER_PHONCHAR = 0.0213
ADAPTIVE_SAFETY_MULT = 2.5
CODEC_FRAME_RATE_HZ = 12.5     # MOSS-Audio-Tokenizer-Nano codec frame rate
ADAPTIVE_MIN_FRAMES = 50       # floor (~4s) so very short utterances aren't choked


def adaptive_max_new_frames(phoneme: str, hard_cap: int = 375) -> int:
    """Duration cap scaled to THIS phoneme string's length, capped by `hard_cap`
    (never looser than the caller's existing ceiling, only ever tighter)."""
    phon_len = max(len(phoneme), 1)
    expected_frames = ADAPTIVE_SAFETY_MULT * ADAPTIVE_SEC_PER_PHONCHAR * phon_len * CODEC_FRAME_RATE_HZ
    return max(ADAPTIVE_MIN_FRAMES, min(hard_cap, math.ceil(expected_frames)))


def safe_prepare_text(text: str) -> str:
    """Stock CJK-branch behaviour for ALL inputs (no upper-casing / padding).

    This is the public name for what was _safe_prepare() in the private repo.
    Named public because future ONNX and other backends need to call it directly.
    """
    t = str(text).strip().replace("\n", " ").replace("\r", " ")
    while "  " in t:
        t = t.replace("  ", " ")
    if t == "":
        raise ValueError("Text prompt cannot be empty.")
    if t[-1] not in _SENTENCE_END:
        t = t + "。"
    return t


# ── abstract base class ───────────────────────────────────────────────────────

class TTSBackend(abc.ABC):
    """Abstract interface every canto-tts backend must implement."""

    @staticmethod
    def to_phoneme(text: str) -> str:
        """Cantonese/EN text -> cantophon phoneme string (same g2p as training)."""
        from canto_tts.core.cantophon import text_to_string
        return text_to_string(text)

    @abc.abstractmethod
    def synthesize(self, text: str, out_path: str, **kwargs) -> str:
        """Synthesize `text` to `out_path` (wav). Returns out_path."""
        ...
