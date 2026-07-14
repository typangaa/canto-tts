"""canto_tts.backends.onnx_backend — CPU-first ONNX Runtime inference backend.

This is the DEFAULT/primary backend (see backends/factory.py) — no torch, no
GPU required. It downloads pre-exported ONNX weights via canto_tts.hub and
drives them with `ort_cpu_runtime.OrtCpuRuntime`, vendored unmodified from
OpenMOSS/MOSS-TTS-Nano (see scripts/vendor/openmoss/README.md for why this is
vendored rather than reimplemented).

Three ways this deviates from OpenMOSS's own ONNX driver (`onnx_tts_runtime.py`,
NOT vendored — see that decision in the vendor README):

  1. Single baked default voice, no runtime voice cloning. OpenMOSS's ONNX
     runtime always requires `prompt_audio_codes` (from a user-supplied
     reference clip or a built-in preset); canto-tts bakes exactly ONE
     default-voice's prompt_audio_codes into the manifest at export time
     (scripts/export_onnx.py) and always uses it — no `ref_audio` parameter
     here (unlike backends/torch_backend.py, which does support one, since
     the torch path is a dev/internal tool, not the public default). This
     also means the shipped runtime never needs the codec "encode" ONNX
     session at inference time, only "decode"/"decode_step".
  2. No WeTextProcessing, no text-normalization pipeline at all. Matches the
     rest of this project (see backends/torch_backend.py's module docstring,
     deviation #1) — our `text` is already a fully-formed phoneme string by
     the time it reaches this backend (canto_tts.core.cantophon), never raw
     Hanzi that needs Mandarin-oriented normalization.
  3. Custom tokenizer-free text encoding (`_PhonemeEncoder` below) instead of
     OpenMOSS's raw `sentencepiece.SentencePieceProcessor.encode()`. Our
     checkpoint's cantophon tokenizer surgery added ~90 special tokens
     (onset/rime/tone/pause) that live in `added_tokens.json`, OUTSIDE the
     base sentencepiece vocab — encoding with raw sentencepiece alone would
     silently produce the WRONG token ids for every phoneme token. Verified
     byte-identical against the checkpoint's real HF `AutoTokenizer.encode()`
     output before landing this (see scripts/export_onnx.py's `_LightTokenizer`,
     the same logic used at export/manifest-baking time).
"""
from __future__ import annotations

import json
import re
import sys
import wave
from pathlib import Path
from typing import Any, Optional

import numpy as np

from canto_tts.backends.base import Control, TTSBackend, safe_prepare_text

# ort_cpu_runtime.py lives inside the installed package itself (src/canto_tts/
# _vendor/openmoss/) -- unlike the export-only vendor files in scripts/vendor/
# openmoss/ (export_hf_to_tts_onnx.py, export_moss_tts_browser_onnx.py, which
# only ever run from a maintainer's source checkout at packaging time), this
# one is a genuine runtime dependency of every end user's `import canto_tts`
# and MUST ship inside the wheel. (Discovered via `docker run` smoke test: a
# real `pip install`-from-wheel has no scripts/ directory at all -- an
# earlier version of this pointed at scripts/vendor/openmoss/, which only
# happened to work in editable/dev installs.)
_VENDOR_DIR = Path(__file__).resolve().parent.parent / "_vendor" / "openmoss"


def _ort_cpu_runtime_module():
    if str(_VENDOR_DIR) not in sys.path:
        sys.path.insert(0, str(_VENDOR_DIR))
    import ort_cpu_runtime  # noqa: PLC0415

    return ort_cpu_runtime


class _PhonemeEncoder:
    """Tokenizer-free text -> token-id encoding: exact-match added phoneme
    tokens, sentencepiece-encode everything else. See module docstring
    deviation #3 — this MUST stay in sync with scripts/export_onnx.py's
    `_LightTokenizer` (same algorithm, duplicated because one runs at
    packaging time with no canto_tts install available yet, the other at
    inference time with no training-repo checkpoint files available)."""

    def __init__(self, model_dir: Path) -> None:
        import sentencepiece as spm

        added = json.loads((model_dir / "added_tokens.json").read_text(encoding="utf-8"))
        self._added = {k: int(v) for k, v in added.items()}
        self._sp = spm.SentencePieceProcessor(model_file=str(model_dir / "tokenizer.model"))
        added_sorted = sorted(self._added, key=len, reverse=True)
        self._pattern = re.compile("(" + "|".join(re.escape(t) for t in added_sorted) + ")") if added_sorted else None

    def encode(self, text: str) -> list[int]:
        if not self._pattern:
            return [int(i) for i in self._sp.encode(text, out_type=int)]
        ids: list[int] = []
        for part in self._pattern.split(text):
            if not part:
                continue
            if part in self._added:
                ids.append(self._added[part])
            else:
                ids.extend(int(i) for i in self._sp.encode(part, out_type=int))
        return ids


def _write_wav(path: Path, waveform: np.ndarray, sample_rate: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    audio = np.clip(np.asarray(waveform, dtype=np.float32), -1.0, 1.0)
    if audio.ndim == 1:
        audio = audio.reshape(-1, 1)
    pcm16 = np.round(audio * 32767.0).astype(np.int16)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(int(pcm16.shape[1]))
        wf.setsampwidth(2)
        wf.setframerate(int(sample_rate))
        wf.writeframes(pcm16.tobytes())


class OnnxBackend(TTSBackend):
    """CPU-first ONNX Runtime backend. No GPU, no torch required.

    `model_dir` must contain the layout produced by scripts/export_onnx.py:
    `browser_poc_manifest.json`, the TTS + codec ONNX subfolders, and
    `tokenizer.model`/`added_tokens.json`.
    """

    def __init__(self, model_dir: str, *, thread_count: int = 4, **_unused: Any) -> None:
        ort_cpu_runtime = _ort_cpu_runtime_module()
        self._model_dir = Path(model_dir).expanduser().resolve()
        self._runtime = ort_cpu_runtime.OrtCpuRuntime(model_dir=self._model_dir, thread_count=thread_count)
        self._encoder = _PhonemeEncoder(self._model_dir)
        self._default_voice_codes = self._runtime.manifest["default_voice"]["prompt_audio_codes"]

    def synthesize(
        self,
        text: str,
        out_path: str,
        *,
        control: Control = None,
        tokens: Optional[int] = None,
        max_new_frames: int = 375,
        text_temperature: float = 0.9,
        text_top_p: float = 1.0,
        text_top_k: int = 50,
        audio_temperature: float = 0.9,
        audio_top_p: float = 0.9,
        audio_top_k: int = 25,
        audio_repetition_penalty: float = 1.0,
        **_unused: Any,
    ) -> str:
        """Synthesize `text` (already phoneme-converted by the caller — see
        TTSBackend.to_phoneme / CantoTTS.synthesize) to `out_path` using the
        single baked default voice. `control`/`tokens` (L2 control) are
        accepted for interface parity with torch_backend.py but this project
        ships no fine-tuned control-conditioned behaviour differences between
        backends beyond text conditioning; see canto_tts.core.prompting if
        extending this.
        """
        if control is not None or tokens is not None:
            # L2 control renders into the text-side suffix, not the baked
            # prompt-template ids — see core/prompting.render_suffix_text if
            # wiring this through; not yet exercised by the ONNX export path.
            raise NotImplementedError(
                "control/tokens are not yet wired through the ONNX backend's baked "
                "prompt templates; use backends.torch_backend for L2 control today."
            )

        phoneme = self.to_phoneme(text)
        prepared = safe_prepare_text(phoneme)
        text_token_ids = self._encoder.encode(prepared)

        gen_defaults = self._runtime.manifest["generation_defaults"]
        gen_defaults.update(
            max_new_frames=int(max_new_frames),
            text_temperature=float(text_temperature),
            text_top_p=float(text_top_p),
            text_top_k=int(text_top_k),
            audio_temperature=float(audio_temperature),
            audio_top_p=float(audio_top_p),
            audio_top_k=int(audio_top_k),
            audio_repetition_penalty=float(audio_repetition_penalty),
        )

        request_rows = self._runtime.build_voice_clone_request_rows(self._default_voice_codes, text_token_ids)
        generated_frames = self._runtime.generate_audio_frames(request_rows)
        channel_arrays, audio_length = self._runtime.decode_full_audio(generated_frames)
        merged = (
            np.stack([np.asarray(c, dtype=np.float32) for c in channel_arrays], axis=1)
            if len(channel_arrays) > 1
            else np.asarray(channel_arrays[0], dtype=np.float32).reshape(-1, 1)
        )
        sample_rate = int(self._runtime.codec_meta["codec_config"]["sample_rate"])
        _write_wav(Path(out_path), merged, sample_rate)
        return out_path
