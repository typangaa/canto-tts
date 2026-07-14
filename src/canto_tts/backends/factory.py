"""canto_tts.backends.factory — backend auto-selection.

ONNX is the default (CPU-first, no torch required — the whole point of this
project's OSS release). Torch is available as an explicit opt-in for anyone
who has installed the `canto-tts[torch]` extra and wants the dev/internal
backend (e.g. it is the only one supporting `ref_audio` voice-clone today —
see backends/torch_backend.py's module docstring).
"""
from __future__ import annotations

from typing import Any, Optional

from canto_tts.backends.base import TTSBackend


def _onnx_available() -> bool:
    try:
        import onnxruntime  # noqa: F401
    except ImportError:
        return False
    return True


def _torch_available() -> bool:
    try:
        import torch  # noqa: F401
    except ImportError:
        return False
    return True


def get_backend(
    *,
    checkpoint: Optional[str] = None,
    codec_path: Optional[str] = None,
    prefer: Optional[str] = None,
    **kwargs: Any,
) -> TTSBackend:
    """Resolve and construct a backend.

    Parameters
    ----------
    checkpoint:
        For ``prefer="onnx"`` (or auto-selected onnx): a local directory in
        the scripts/export_onnx.py bundle layout, or *None* to auto-download
        via canto_tts.hub. For ``prefer="torch"``: the local HF checkpoint
        directory (required, no default — see torch_backend.py).
    codec_path:
        Only meaningful for the torch backend; ignored (with a warning) for
        onnx, whose codec weights are bundled into the same downloaded dir.
    prefer:
        ``"onnx"`` | ``"torch"`` | *None* (auto: onnx if onnxruntime is
        installed, else torch if torch is installed, else raise).
    """
    backend_name = prefer or ("onnx" if _onnx_available() else "torch" if _torch_available() else None)

    if backend_name == "onnx":
        if not _onnx_available():
            raise ImportError("backend='onnx' requested but onnxruntime is not installed (pip install canto-tts).")
        if codec_path is not None:
            import warnings

            warnings.warn(
                "codec_path is ignored by the onnx backend — codec weights are bundled "
                "into the same downloaded model_dir (see canto_tts.hub).",
                stacklevel=2,
            )
        from canto_tts.backends.onnx_backend import OnnxBackend

        model_dir = checkpoint
        if model_dir is None:
            from canto_tts.hub import resolve_onnx_model_dir

            model_dir = resolve_onnx_model_dir()
        return OnnxBackend(model_dir, **kwargs)

    if backend_name == "torch":
        if not _torch_available():
            raise ImportError("backend='torch' requested but torch is not installed (pip install canto-tts[torch]).")
        if checkpoint is None:
            raise ValueError(
                "The torch backend requires an explicit checkpoint path (no default/auto-download — "
                "it is a dev/internal backend, see backends.torch_backend module docstring)."
            )
        from canto_tts.backends.torch_backend import TorchBackend

        return TorchBackend(checkpoint, codec_path=codec_path, **kwargs)

    raise ImportError(
        "Neither onnxruntime nor torch is installed. Install one: `pip install canto-tts` (onnx, "
        "recommended) or `pip install canto-tts[torch]`."
    )
