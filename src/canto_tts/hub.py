"""Auto-download canto-tts model weights from HuggingFace Hub, cached under
~/.cache/huggingface (standard huggingface_hub cache location — no custom cache
dir so users' existing HF_HOME overrides are respected automatically).

Usage::

    from canto_tts.hub import resolve_onnx_model_dir

    model_dir = resolve_onnx_model_dir()  # downloads on first call, reuses cache after

`resolve_onnx_model_dir()` returns the ONNX bundle produced by
scripts/export_onnx.py: `browser_poc_manifest.json` + the fine-tuned TTS ONNX
graphs + the stock (unmodified) OpenMOSS codec ONNX graphs, all in one flat
snapshot dir — exactly what `canto_tts.backends.onnx_backend.OnnxBackend`
expects as `model_dir`. There is no separate codec repo/subfolder to resolve:
export_onnx.py already bundles OpenMOSS's own published codec ONNX into the
same output dir that gets uploaded here, so one `snapshot_download` covers
everything the ONNX backend needs.

The torch backend (`backends.torch_backend.TorchBackend`) is a dev/internal
tool, not this project's public default (see that module's docstring) — it
takes an explicit local `checkpoint`/`codec_path` from the caller and has no
`hub.py`-resolved default.
"""

from __future__ import annotations

from huggingface_hub import snapshot_download

# NOTE: This is the *public* HuggingFace repo that ships the pre-trained ONNX
# weights for canto-tts-nano. Never reference any private training-repo path
# or internal checkpoint/run identifier anywhere in this file or in any other
# public-facing SDK file.
DEFAULT_HF_REPO = "typangaa/canto-tts-nano"


def resolve_onnx_model_dir(
    repo_id: str = DEFAULT_HF_REPO,
    revision: str | None = None,
) -> str:
    """Download (or reuse cached) ONNX model bundle; return the local directory path.

    Parameters
    ----------
    repo_id:
        HuggingFace Hub repository id, e.g. ``"typangaa/canto-tts-nano"``.
    revision:
        Git branch, tag, or commit hash.  *None* means the default branch
        (``main``).

    Returns
    -------
    str
        Absolute path to the locally-cached snapshot directory, suitable to
        pass directly as ``OnnxBackend(model_dir=...)``.
    """
    return snapshot_download(repo_id=repo_id, revision=revision)
