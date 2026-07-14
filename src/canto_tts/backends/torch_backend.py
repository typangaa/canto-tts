"""canto_tts.backends.torch_backend — PyTorch inference backend for canto-tts V1.

Loads the MOSS-TTS-Nano cantophon checkpoint once and exposes synthesize().

Three deliberate deviations from the stock MOSS infer path:
  1. We do NOT run WeTextProcessing (a Mandarin normalizer) — we call
     model.inference() directly so it never runs.
  2. We patch `_prepare_text_for_sentence_chunking`: its non-CJK branch
     upper-cases the first character, which would corrupt the leading
     "<o-..>" phoneme token. The patch keeps safe CJK behaviour for ALL inputs
     (see safe_prepare_text() in base.py).
  3. L2 control: synthesize() accepts control/tokens and injects them by
     monkeypatching the bundled prompting module's USER_TEMPLATE_AFTER_REFERENCE
     string constant (NOT the build_user_prompt_after_reference function —
     `from .prompting import` inside the model's modeling file freezes a
     reference to the function object, so reassigning the function on the
     prompting module afterward would not be seen by modeling's already-bound
     copy. The STRING constant works because the function's body resolves it
     via a bare-name lookup in its OWN defining module's globals — i.e. the
     prompting module itself — at CALL time, regardless of which module's
     bound copy invoked it. This covers BOTH continuation (via
     build_prompt_token_ids -> build_prompt_prefix, entirely internal to the
     prompting module) and voice_clone (modeling calls
     build_user_prompt_after_reference directly) generation modes.
     Verified empirically before landing this.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, Optional

import torch

from canto_tts.core import cantophon as cp
from canto_tts.core import prompting as pr
from canto_tts.backends.base import (
    Control,
    TTSBackend,
    _SENTENCE_END,
    adaptive_max_new_frames,
    safe_prepare_text,
)


class TorchBackend(TTSBackend):
    """Load a cantophon checkpoint once, synthesize many times."""

    def __init__(
        self,
        checkpoint: str,
        *,
        codec_path: Optional[str] = None,
        device: str = "cuda",
        dtype: torch.dtype = torch.bfloat16,
    ) -> None:
        # TODO(hub): default via canto_tts.hub.resolve_codec_path()
        if codec_path is None:
            raise ValueError(
                "codec_path is required. Pass a local path to the MOSS-Audio-Tokenizer-Nano "
                "codec directory, or use canto_tts.hub to resolve one automatically "
                "(see canto_tts.hub.resolve_codec_path — a separate workstream)."
            )

        from transformers import AutoModelForCausalLM

        self.codec_path = codec_path
        self.device = torch.device(device if torch.cuda.is_available() else "cpu")
        ckpt = str(Path(checkpoint).resolve())
        self.model = (
            AutoModelForCausalLM.from_pretrained(ckpt, trust_remote_code=True, dtype=dtype)
            .to(self.device)
            .eval()
        )
        type(self.model)._prepare_text_for_sentence_chunking = staticmethod(safe_prepare_text)

        modeling_mod = sys.modules[type(self.model).__module__]
        self._prompting_mod = sys.modules[modeling_mod.build_user_prompt_after_reference.__module__]
        self._stock_after_reference = self._prompting_mod.USER_TEMPLATE_AFTER_REFERENCE

    @staticmethod
    def to_phoneme(text: str) -> str:
        """Cantonese/EN text -> cantophon phoneme string (same g2p as training)."""
        return cp.text_to_string(text)

    def synthesize(
        self,
        text: str,
        out_path: str,
        *,
        ref_audio: Optional[str] = None,
        control: Control = None,
        tokens: Optional[int] = None,
        seed: Optional[int] = 42,
        max_new_frames: int = 375,
        adaptive_duration_cap: bool = True,
        text_temperature: float = 0.9,
        text_top_p: float = 1.0,
        text_top_k: int = 50,
        audio_temperature: float = 0.9,
        audio_top_p: float = 0.9,
        audio_top_k: int = 25,
        audio_repetition_penalty: float = 1.0,
    ) -> str:
        """Synthesize `text` to `out_path` (wav). Returns out_path.

        ref_audio set -> mode=voice_clone (model encodes clip + conditions on speaker).
        control/tokens -> L2 control (emotion/rate/pitch/energy dict|string, duration
        frame count); None/None renders byte-identical to the stock unconditional
        prompt. adaptive_duration_cap (default True): scale the effective
        max_new_frames down for short sentences instead of giving every sentence
        the same fixed ceiling -- only ever tightens, never loosens, `max_new_frames`.
        audio_repetition_penalty (default 1.0 = no-op): the model natively
        supports this; ~1.15 is the literature-typical value for reducing
        repetition-loop runaway generation, not yet validated as a new default.
        """
        if seed is not None:
            torch.manual_seed(seed)
            if torch.cuda.is_available():
                torch.cuda.manual_seed_all(seed)

        phoneme = self.to_phoneme(text)
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        mode = "voice_clone" if ref_audio else "continuation"
        effective_max_new_frames = (
            adaptive_max_new_frames(phoneme, hard_cap=max_new_frames) if adaptive_duration_cap else max_new_frames
        )

        self._prompting_mod.USER_TEMPLATE_AFTER_REFERENCE = pr.render_suffix_prefix(
            pr.build_control_fields(control, tokens)
        )
        try:
            self.model.inference(
                text=phoneme,
                output_audio_path=out_path,
                mode=mode,
                reference_audio_path=ref_audio,
                audio_tokenizer_pretrained_name_or_path=self.codec_path,
                device=self.device,
                max_new_frames=effective_max_new_frames,
                do_sample=True,
                text_temperature=text_temperature,
                text_top_p=text_top_p,
                text_top_k=text_top_k,
                audio_temperature=audio_temperature,
                audio_top_p=audio_top_p,
                audio_top_k=audio_top_k,
                audio_repetition_penalty=audio_repetition_penalty,
            )
        finally:
            # Never leak control state into the next call (which may be unconditional).
            self._prompting_mod.USER_TEMPLATE_AFTER_REFERENCE = self._stock_after_reference
        return out_path


# Backwards-friendly alias — docs may reference either name.
CantoTTSInference = TorchBackend
