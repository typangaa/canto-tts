#!/usr/bin/env python3
"""scripts/quantize_int8.py — dynamic int8 quantization of the fine-tuned TTS
ONNX graphs produced by scripts/export_onnx.py.

Only the 5 MOSS-TTS-Nano-cantophon-ONNX graphs are quantized (the fine-tuned
LM: global GPT-2 transformer + local per-channel transformer — these are the
autoregressive-stepping bottleneck, run once per output frame). The codec
graphs (MOSS-Audio-Tokenizer-Nano-ONNX) are deliberately left untouched: they
are OpenMOSS's own stock, unmodified pretrained weights (never fine-tuned by
this project), run only once at the very end of generation (not per-frame),
and audio-fidelity risk from quantizing a codec is a worse trade than the
speed/size win — see docs/PRODUCTION_SERVING_PLAN.md §12 (VieNeu-TTS prior art)
for the same LM-only quantization scope.

All 5 graphs are MatMul-dominated (no Gemm/Conv — verified via onnx.load
graph.node op_type counts), so onnxruntime.quantization.quantize_dynamic's
default QUInt8 weight-only dynamic quantization is the standard fit (no
calibration data needed, unlike static/QDQ quantization).

Usage:
    .venv/bin/python3 scripts/quantize_int8.py \\
        --input-dir onnx_weights/ --output-dir onnx_weights_int8/
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

TTS_SUBDIR_NAME = "MOSS-TTS-Nano-cantophon-ONNX"
CODEC_SUBDIR_NAME = "MOSS-Audio-Tokenizer-Nano-ONNX"

TTS_GRAPH_NAMES = [
    "moss_tts_prefill",
    "moss_tts_decode_step",
    "moss_tts_local_decoder",
    "moss_tts_local_cached_step",
    "moss_tts_local_fixed_sampled_frame",
]


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--input-dir", required=True, help="Output dir from scripts/export_onnx.py")
    p.add_argument("--output-dir", required=True)
    p.add_argument(
        "--weight-type",
        default="QUInt8",
        choices=["QUInt8", "QInt8"],
        help="onnxruntime.quantization.QuantType for weights (default QUInt8, ORT's recommended default for CPU EP)",
    )
    return p.parse_args(argv)


def quantize_one(src: Path, dst: Path, weight_type: str) -> None:
    from onnxruntime.quantization import QuantType, quantize_dynamic

    quant_type = QuantType.QUInt8 if weight_type == "QUInt8" else QuantType.QInt8
    quantize_dynamic(
        model_input=str(src),
        model_output=str(dst),
        weight_type=quant_type,
        # Graphs use external-data initializers (moss_tts_*_shared.data) — quantize_dynamic
        # loads/writes them via onnx's external-data machinery automatically; no extra flag needed
        # as long as src/dst share nothing on disk except paths (fresh output dir per graph avoids
        # any external-data filename collision between quantized and original weight files).
    )


def main() -> None:
    args = parse_args()
    in_dir = Path(args.input_dir).resolve()
    out_dir = Path(args.output_dir).resolve()
    tts_in = in_dir / TTS_SUBDIR_NAME
    tts_out = out_dir / TTS_SUBDIR_NAME
    codec_in = in_dir / CODEC_SUBDIR_NAME
    codec_out = out_dir / CODEC_SUBDIR_NAME

    if not tts_in.is_dir():
        raise FileNotFoundError(f"{tts_in} not found — run scripts/export_onnx.py first")

    out_dir.mkdir(parents=True, exist_ok=True)
    tts_out.mkdir(parents=True, exist_ok=True)

    print(f"[1/3] quantizing {len(TTS_GRAPH_NAMES)} TTS graphs ({args.weight_type}) -> {tts_out}")
    for name in TTS_GRAPH_NAMES:
        src = tts_in / f"{name}.onnx"
        dst = tts_out / f"{name}.onnx"
        print(f"      {name}.onnx ...", end=" ", flush=True)
        quantize_one(src, dst, args.weight_type)
        before = src.stat().st_size
        after = dst.stat().st_size
        print(f"{before/1e6:.1f}MB -> {after/1e6:.1f}MB ({after/before:.2f}x)")

    # meta/tokenizer files for the TTS graph dir: copy verbatim (no weights to touch).
    # Deliberately EXCLUDE *_shared.data: quantize_dynamic embeds all initializers
    # (quantized UINT8 + leftover FLOAT scale/bias) directly into each output .onnx
    # protobuf (verified via onnx.load(..., load_external_data=False) -> zero
    # initializers have external_data set) -- the original external-data blob these
    # 5 graphs used to share is fully orphaned post-quantization; shipping it would
    # just be ~640MB of dead weight.
    for extra in tts_in.glob("*"):
        if extra.suffix in (".onnx", ".data") or extra.name in TTS_GRAPH_NAMES:
            continue
        if extra.is_file():
            shutil.copy2(extra, tts_out / extra.name)

    print(f"[2/3] copying codec graphs unchanged (stock OpenMOSS weights, not fine-tuned) -> {codec_out}")
    if codec_in.is_dir():
        shutil.copytree(codec_in, codec_out, dirs_exist_ok=True)
    else:
        print(f"      WARNING: {codec_in} not found, skipping codec copy")

    print("[3/3] copying top-level manifest/tokenizer files unchanged")
    for extra in in_dir.glob("*"):
        if extra.is_dir():
            continue
        shutil.copy2(extra, out_dir / extra.name)

    def dir_size(p: Path) -> int:
        return sum(f.stat().st_size for f in p.rglob("*") if f.is_file())

    print(f"\ndone: {out_dir}")
    print(f"total bundle size: {dir_size(in_dir)/1e6:.0f}MB (fp32) -> {dir_size(out_dir)/1e6:.0f}MB (int8)")
    print(
        "NOTE: the 5 TTS graphs share MatMul weights pairwise via external-data reuse in the fp32 "
        "export (prefill<->decode_step share the global-transformer weights; local_decoder<->"
        "local_cached_step<->local_fixed_sampled_frame share the local-transformer weights) -- "
        "quantize_dynamic operates one graph file at a time and has no cross-graph dedup, so each "
        "output graph embeds its OWN quantized copy of those shared tensors. The size reduction "
        "above is therefore smaller than a naive 4x (fp32->int8) estimate would suggest; true "
        "cross-graph dedup would need a custom shared-blob rewrite (out of scope here) -- see "
        "docs/DEPLOY.md quantization note."
    )


if __name__ == "__main__":
    main()
