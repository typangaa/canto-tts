"""canto_tts — Cantonese (HK) text-to-speech SDK.

Public API quick-start::

    from canto_tts import CantoTTS

    tts = CantoTTS()                          # auto-downloads weights on first run
    tts.synthesize("多謝晒。", "out.wav")    # returns output path

The :class:`CantoTTS` convenience wrapper auto-selects the best available
backend:

* **ONNX** (CPU-first, default) — requires the core ``canto-tts`` install.
* **Torch** — requires ``canto-tts[torch]``.

Use the ``backend`` kwarg to pin a specific backend::

    tts = CantoTTS(backend="onnx")   # explicit ONNX
    tts = CantoTTS(backend="torch")  # explicit Torch
"""

from __future__ import annotations

__version__ = "0.1.0"
__all__ = ["CantoTTS"]


class CantoTTS:
    """High-level entry point. Auto-selects ONNX backend if available, else torch.

    Parameters
    ----------
    checkpoint:
        Path to a local model directory **or** a HuggingFace repo-id string.
        When *None* the default HuggingFace repo is downloaded automatically.
    codec_path:
        Path to the codec weights directory.  When *None* it is resolved from
        the same HuggingFace repo as *checkpoint* (subfolder ``codec/``).
    backend:
        ``"onnx"`` | ``"torch"`` | ``None``.  *None* lets the factory choose.
    **kwargs:
        Forwarded verbatim to the selected backend constructor (e.g. ``device``,
        ``dtype``).

    Example
    -------
    ::

        from canto_tts import CantoTTS
        tts = CantoTTS()                       # first run fetches weights
        tts.synthesize("今日天氣幾好。", "out.wav")
    """

    def __init__(
        self,
        checkpoint: str | None = None,
        *,
        codec_path: str | None = None,
        backend: str | None = None,
        **kwargs,
    ) -> None:
        # Import deferred so that importing canto_tts at the top level never
        # crashes when optional deps (torch / onnxruntime) are absent; the
        # error surfaces only when CantoTTS() is actually instantiated.
        from canto_tts.backends.factory import get_backend  # noqa: PLC0415

        self._backend = get_backend(
            checkpoint=checkpoint,
            codec_path=codec_path,
            prefer=backend,
            **kwargs,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def synthesize(self, text: str, out_path: str, **kwargs) -> str:
        """Synthesise *text* and write audio to *out_path*.

        Parameters
        ----------
        text:
            Cantonese text (Traditional Chinese script).
        out_path:
            Destination ``.wav`` file path.
        **kwargs:
            Backend-specific keyword arguments (e.g. ``ref_audio``).

        Returns
        -------
        str
            The resolved output path (same as *out_path* on success).
        """
        return self._backend.synthesize(text, out_path, **kwargs)

    def to_phoneme(self, text: str) -> str:
        """Convert *text* to Jyutping phoneme string.

        Parameters
        ----------
        text:
            Cantonese text (Traditional Chinese script).

        Returns
        -------
        str
            Space-separated Jyutping syllables.
        """
        return self._backend.to_phoneme(text)
