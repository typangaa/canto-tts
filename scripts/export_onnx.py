#!/usr/bin/env python3
"""Maintainer-only: export a canto-tts (MOSS-TTS-Nano fine-tune) checkpoint to
the ONNX artifact layout consumed by src/canto_tts/backends/onnx_backend.py.

NOT packaged/shipped to end users (see pyproject.toml — this lives in
scripts/, not src/canto_tts/). Requires the checkpoint's own training
environment (torch + transformers==4.57.1 + trust_remote_code deps), so run
it with the *training* venv's Python, not canto-tts's own (torch-free) venv:

    <path-to-training-repo>/.venv/bin/python3 scripts/export_onnx.py \\
        --checkpoint-path <path-to-training-repo>/training/<run>/checkpoint-last \\
        --default-voice-audio <path-to-a-reference-wav> \\
        --output-dir onnx_weights/

Produces, under --output-dir:
    MOSS-TTS-Nano-cantophon-ONNX/     (prefill/decode_step/local_*.onnx + tts_browser_onnx_meta.json)
    MOSS-Audio-Tokenizer-Nano-ONNX/   (stock OpenMOSS codec ONNX, downloaded unmodified)
    browser_poc_manifest.json         (wrapper manifest: prompt_templates, tts_config, default voice)
    tokenizer.model, added_tokens.json (needed by onnx_backend.py's tokenizer-free text encoder)

This directory is what gets uploaded to HuggingFace (Stage F) and what
onnx_backend.py downloads via canto_tts.hub at first use.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import numpy as np

VENDOR_DIR = Path(__file__).resolve().parent / "vendor" / "openmoss"

# Stock OpenMOSS codec — unmodified, NOT fine-tuned by canto-tts, so we reuse
# their already-published ONNX export rather than re-exporting it ourselves.
CODEC_ONNX_REPO_ID = "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint-path", required=True, help="Path to the fine-tuned HF checkpoint directory.")
    parser.add_argument("--output-dir", required=True, help="Directory to write the final ONNX artifact bundle to.")
    parser.add_argument(
        "--default-voice-audio",
        required=True,
        help=(
            "Reference clip encoded ONCE into the single baked default-voice prompt_audio_codes "
            "(canto-tts ships unconditional/single-default-voice only, no runtime voice cloning). "
            "Must be a rights-cleared clip, NOT an arbitrary training-corpus sample "
            "(see docs/NANO_OSS_SERVING_PLAN.md — default-voice source is a pending decision)."
        ),
    )
    parser.add_argument("--default-voice-name", default="default", help="Name for the baked voice entry.")
    parser.add_argument("--opset", type=int, default=17)
    return parser.parse_args()


def run_export(checkpoint_path: Path, tts_out_dir: Path, opset: int) -> None:
    tts_out_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            sys.executable,
            str(VENDOR_DIR / "export_hf_to_tts_onnx.py"),
            "--checkpoint-path", str(checkpoint_path),
            "--output-dir", str(tts_out_dir),
            "--opset", str(opset),
        ],
        check=True,
    )


def download_codec_onnx(codec_out_dir: Path) -> None:
    from huggingface_hub import snapshot_download

    snapshot_download(repo_id=CODEC_ONNX_REPO_ID, local_dir=str(codec_out_dir))


def load_checkpoint_prompting_module(checkpoint_path: Path):
    """Dynamically import the checkpoint's OWN bundled trust_remote_code
    prompting.py + configuration_moss_tts_nano.py, so the exact chat-template
    strings and special-token ids always come from the live checkpoint, never
    hardcoded here (this project's rule: don't fork vendor/trust_remote_code
    logic, read it directly).
    """
    def _load(name: str, filename: str):
        spec = importlib.util.spec_from_file_location(name, checkpoint_path / filename)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
        return module

    config_mod = _load("_canto_tts_export_config", "configuration_moss_tts_nano.py")
    # prompting.py does `from .configuration_moss_tts_nano import MossTTSNanoConfig` (relative import) —
    # register it under the same package-relative name so that import resolves.
    sys.modules["_canto_tts_export_config.configuration_moss_tts_nano"] = config_mod
    prompting_spec = importlib.util.spec_from_file_location(
        "_canto_tts_export_config.prompting", checkpoint_path / "prompting.py"
    )
    prompting_mod = importlib.util.module_from_spec(prompting_spec)
    prompting_spec.loader.exec_module(prompting_mod)
    return prompting_mod, config_mod


class _LightTokenizer:
    """Tokenizer-free encode used ONLY at export/packaging time to bake the
    prompt-template token ids into the manifest (mirrors the runtime encoder
    in onnx_backend.py exactly — see that module for the validated logic and
    why raw sentencepiece alone is insufficient once added tokens exist)."""

    def __init__(self, checkpoint_path: Path) -> None:
        import sentencepiece as spm

        self._added = json.loads((checkpoint_path / "added_tokens.json").read_text(encoding="utf-8"))
        self._sp = spm.SentencePieceProcessor(model_file=str(checkpoint_path / "tokenizer.model"))
        added_sorted = sorted(self._added.keys(), key=len, reverse=True)
        self._pattern = re.compile("(" + "|".join(re.escape(t) for t in added_sorted) + ")") if added_sorted else None

    def encode(self, text: str, add_special_tokens: bool = False) -> list[int]:
        if not self._pattern:
            return [int(i) for i in self._sp.encode(text, out_type=int)]
        ids: list[int] = []
        for part in self._pattern.split(text):
            if not part:
                continue
            if part in self._added:
                ids.append(int(self._added[part]))
            else:
                ids.extend(int(i) for i in self._sp.encode(part, out_type=int))
        return ids


def build_prompt_templates(checkpoint_path: Path) -> dict[str, list[int]]:
    prompting_mod, config_mod = load_checkpoint_prompting_module(checkpoint_path)
    config = config_mod.MossTTSNanoConfig.from_pretrained(str(checkpoint_path))
    tokenizer = _LightTokenizer(checkpoint_path)
    return {
        "user_prompt_prefix_token_ids": prompting_mod.build_user_prompt_prefix(tokenizer, config),
        "user_prompt_after_reference_token_ids": prompting_mod.build_user_prompt_after_reference(tokenizer),
        "assistant_prompt_prefix_token_ids": prompting_mod.build_assistant_prompt_prefix(tokenizer, config),
    }


def encode_default_voice(
    *,
    audio_path: Path,
    codec_dir: Path,
    codec_meta: dict[str, Any],
) -> list[list[int]]:
    """Run the codec encode ONNX graph once over the chosen reference clip.
    This is the ONLY place onnx_backend.py's shipped runtime needs a codec
    "encode" capability for — at inference time canto-tts only ever decodes
    (single baked default voice, no user-supplied ref_audio in the ONNX path)."""
    import onnxruntime as ort
    import soundfile as sf
    from scipy.signal import resample_poly
    from math import gcd

    session = ort.InferenceSession(str(codec_dir / codec_meta["files"]["encode"]))
    waveform, sample_rate = sf.read(str(audio_path), dtype="float32", always_2d=True)  # (samples, channels)
    waveform = waveform.T  # -> (channels, samples)

    target_sr = int(codec_meta["codec_config"]["sample_rate"])
    target_ch = int(codec_meta["codec_config"]["channels"])
    if sample_rate != target_sr:
        divisor = gcd(target_sr, sample_rate)
        waveform = resample_poly(waveform, target_sr // divisor, sample_rate // divisor, axis=1)
    current_ch = waveform.shape[0]
    if current_ch == target_ch:
        pass
    elif current_ch == 1 and target_ch > 1:
        waveform = np.repeat(waveform, target_ch, axis=0)
    elif current_ch > 1 and target_ch == 1:
        waveform = waveform.mean(axis=0, keepdims=True)
    else:
        raise ValueError(f"Unsupported reference audio channel conversion: {current_ch} -> {target_ch}")

    wav_np = waveform[np.newaxis, :, :].astype(np.float32, copy=False)
    outputs = session.run(
        None, {"waveform": wav_np, "input_lengths": np.asarray([wav_np.shape[-1]], dtype=np.int32)}
    )
    named = dict(zip([o.name for o in session.get_outputs()], outputs))
    audio_codes = np.asarray(named["audio_codes"], dtype=np.int32)
    code_len = int(np.asarray(named["audio_code_lengths"]).reshape(-1)[0])
    num_q = int(codec_meta["codec_config"]["num_quantizers"])
    return [[int(audio_codes[0, f, q]) for q in range(num_q)] for f in range(code_len)]


def build_manifest(
    *,
    tts_meta: dict[str, Any],
    prompt_templates: dict[str, list[int]],
    default_voice_codes: list[list[int]],
    default_voice_name: str,
) -> dict[str, Any]:
    model_config = tts_meta["model_config"]
    return {
        "format_version": 1,
        "model_files": {
            "tts_meta": "MOSS-TTS-Nano-cantophon-ONNX/tts_browser_onnx_meta.json",
            "codec_meta": "MOSS-Audio-Tokenizer-Nano-ONNX/codec_browser_onnx_meta.json",
            "tokenizer_model": "tokenizer.model",
            "added_tokens": "added_tokens.json",
        },
        "tts_config": {
            "n_vq": model_config["n_vq"],
            "audio_pad_token_id": model_config["audio_pad_token_id"],
            "audio_start_token_id": model_config["audio_start_token_id"],
            "audio_end_token_id": model_config["audio_end_token_id"],
            "audio_user_slot_token_id": model_config["audio_user_slot_token_id"],
            "audio_assistant_slot_token_id": model_config["audio_assistant_slot_token_id"],
        },
        "prompt_templates": prompt_templates,
        "generation_defaults": {
            "max_new_frames": 375,
            "do_sample": True,
            "sample_mode": "fixed",
            "text_temperature": 0.9,
            "text_top_p": 1.0,
            "text_top_k": 50,
            "audio_temperature": 0.9,
            "audio_top_p": 0.9,
            "audio_top_k": 25,
            "audio_repetition_penalty": 1.0,
        },
        # Single baked default voice (no runtime voice cloning in v0.1 ONNX path).
        "default_voice": {"voice": default_voice_name, "prompt_audio_codes": default_voice_codes},
    }


def main() -> None:
    args = parse_args()
    checkpoint_path = Path(args.checkpoint_path).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    tts_out_dir = output_dir / "MOSS-TTS-Nano-cantophon-ONNX"
    codec_out_dir = output_dir / "MOSS-Audio-Tokenizer-Nano-ONNX"

    print("[1/5] exporting TTS graphs (torch.onnx.export via vendored OpenMOSS script)...")
    run_export(checkpoint_path, tts_out_dir, args.opset)

    print("[2/5] downloading stock OpenMOSS codec ONNX (unmodified, not fine-tuned)...")
    download_codec_onnx(codec_out_dir)

    print("[3/5] baking prompt-template token ids from the checkpoint's own trust_remote_code prompting.py...")
    prompt_templates = build_prompt_templates(checkpoint_path)

    print("[4/5] encoding the default-voice reference clip through the codec...")
    tts_meta = json.loads((tts_out_dir / "tts_browser_onnx_meta.json").read_text(encoding="utf-8"))
    codec_meta = json.loads((codec_out_dir / "codec_browser_onnx_meta.json").read_text(encoding="utf-8"))
    default_voice_codes = encode_default_voice(
        audio_path=Path(args.default_voice_audio).expanduser().resolve(),
        codec_dir=codec_out_dir,
        codec_meta=codec_meta,
    )

    print("[5/5] writing manifest + copying tokenizer files...")
    manifest = build_manifest(
        tts_meta=tts_meta,
        prompt_templates=prompt_templates,
        default_voice_codes=default_voice_codes,
        default_voice_name=args.default_voice_name,
    )
    (output_dir / "browser_poc_manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (output_dir / "tokenizer.model").write_bytes((checkpoint_path / "tokenizer.model").read_bytes())
    (output_dir / "added_tokens.json").write_text(
        (checkpoint_path / "added_tokens.json").read_text(encoding="utf-8"), encoding="utf-8"
    )

    print(f"Done. ONNX bundle ready at: {output_dir}")


if __name__ == "__main__":
    main()
