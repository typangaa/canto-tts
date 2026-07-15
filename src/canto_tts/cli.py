"""canto-tts command-line interface.

Registered as the ``canto-tts`` console script via pyproject.toml.

Usage
-----
::

    # Synthesise text (positional or --text flag)
    canto-tts synthesize "今日天氣幾好。" -o out.wav

    # With optional reference audio for voice cloning / style transfer
    canto-tts synthesize "多謝晒。" -o out.wav --ref-audio clip.wav

    # Pin backend and checkpoint explicitly
    canto-tts synthesize "你好。" -o out.wav \\
        --backend onnx \\
        --checkpoint /path/to/model \\
        --codec-path /path/to/codec
"""

from __future__ import annotations

import argparse
import sys


# ---------------------------------------------------------------------------
# Sub-command handlers
# ---------------------------------------------------------------------------


def _cmd_synthesize(args: argparse.Namespace) -> int:
    """Handle the ``synthesize`` sub-command."""
    from canto_tts import CantoTTS  # noqa: PLC0415 — deferred to surface missing-dep errors clearly

    # Build keyword arguments for the backend constructor.
    ctor_kwargs: dict = {}
    if args.backend:
        ctor_kwargs["backend"] = args.backend

    tts = CantoTTS(
        checkpoint=args.checkpoint or None,
        codec_path=args.codec_path or None,
        **ctor_kwargs,
    )

    # Build keyword arguments forwarded to synthesize().
    synth_kwargs: dict = {}
    if args.ref_audio:
        synth_kwargs["ref_audio"] = args.ref_audio
    if args.quality:
        synth_kwargs["quality"] = args.quality
        synth_kwargs["max_attempts"] = args.max_attempts
        synth_kwargs["best_of_n"] = args.best_of_n
        synth_kwargs["asr_backend"] = args.asr_backend

    out = tts.synthesize(args.text, args.out, **synth_kwargs)
    print(out)
    return 0


# ---------------------------------------------------------------------------
# Argument parser construction
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="canto-tts",
        description="Cantonese (HK) text-to-speech — CPU-first ONNX SDK",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            '  canto-tts synthesize "今日天氣幾好。" -o out.wav\n'
            '  canto-tts synthesize "多謝晒。" -o out.wav --ref-audio clip.wav\n'
            '  canto-tts synthesize "你好。" -o out.wav --backend onnx\n'
        ),
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {_get_version()}",
    )

    subparsers = parser.add_subparsers(dest="command", metavar="<command>")
    subparsers.required = True

    # ------------------------------------------------------------------
    # synthesize sub-command
    # ------------------------------------------------------------------
    syn = subparsers.add_parser(
        "synthesize",
        help="Synthesise Cantonese text to a WAV file",
        description="Synthesise Cantonese text to a WAV file.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    syn.add_argument(
        "text",
        nargs="?",
        metavar="TEXT",
        help="Cantonese text to synthesise (Traditional Chinese script). "
             "May also be supplied via --text.",
    )
    syn.add_argument(
        "--text",
        dest="text",
        metavar="TEXT",
        help="Cantonese text to synthesise (alternative to positional argument).",
    )
    syn.add_argument(
        "-o",
        "--out",
        required=True,
        metavar="PATH",
        help="Output WAV file path (e.g. out.wav).",
    )
    syn.add_argument(
        "--ref-audio",
        metavar="PATH",
        default=None,
        help="Optional reference audio clip for voice cloning / style transfer.",
    )
    syn.add_argument(
        "--checkpoint",
        metavar="PATH",
        default=None,
        help="Path to local model directory or HuggingFace repo-id. "
             "Defaults to the official typangaa/canto-tts-nano repo.",
    )
    syn.add_argument(
        "--codec-path",
        metavar="PATH",
        default=None,
        help="Path to codec weights directory. "
             "Defaults to the codec/ subfolder of the resolved checkpoint.",
    )
    syn.add_argument(
        "--backend",
        choices=["onnx", "torch"],
        default=None,
        metavar="BACKEND",
        help="Inference backend: 'onnx' (default, CPU-first) or 'torch'.",
    )
    syn.add_argument(
        "--quality",
        choices=["duration_filter", "best_of_n"],
        default=None,
        metavar="MODE",
        help="Opt-in inference-time quality mode (default: single draw, fastest). "
             "'duration_filter': up to --max-attempts draws, keep the one whose "
             "duration best matches expectation (no extra deps). 'best_of_n': "
             "generate --best-of-n draws, keep the lowest-CER one per a local ASR "
             "rerank (requires `pip install canto-tts[quality]`).",
    )
    syn.add_argument(
        "--max-attempts",
        type=int,
        default=3,
        metavar="N",
        help="Draw budget for --quality duration_filter (default: 3).",
    )
    syn.add_argument(
        "--best-of-n",
        type=int,
        default=4,
        metavar="N",
        help="Candidate count for --quality best_of_n (default: 4).",
    )
    syn.add_argument(
        "--asr-backend",
        choices=["whisper", "sensevoice"],
        default="whisper",
        metavar="BACKEND",
        help="ASR reranker for --quality best_of_n: 'whisper' (default, "
             "faster-whisper, torch-free, uses a Cantonese-fine-tuned small "
             "model) or 'sensevoice' (~7x faster per candidate, requires "
             "`pip install canto-tts[quality-sensevoice]`, adds torch).",
    )
    syn.set_defaults(func=_cmd_synthesize)

    return parser


def _get_version() -> str:
    try:
        from importlib.metadata import version  # noqa: PLC0415

        return version("canto-tts")
    except Exception:
        return "0.1.0"


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> None:
    """Console-script entry point registered in pyproject.toml."""
    parser = _build_parser()
    args = parser.parse_args(argv)

    # Validate: text must be provided via positional arg or --text flag.
    if args.command == "synthesize" and not args.text:
        parser.error(
            "TEXT is required: supply it as a positional argument or via --text."
        )

    try:
        rc = args.func(args)
    except Exception as exc:  # noqa: BLE001
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)

    sys.exit(rc)


if __name__ == "__main__":
    main()
