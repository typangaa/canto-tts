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

    def synthesize(
        self,
        text: str,
        out_path: str,
        *,
        quality: str | None = None,
        max_attempts: int = 3,
        best_of_n: int = 4,
        asr_backend: str = "whisper",
        **kwargs,
    ) -> str:
        """Synthesise *text* and write audio to *out_path*.

        Parameters
        ----------
        text:
            Cantonese text (Traditional Chinese script).
        out_path:
            Destination ``.wav`` file path.
        quality:
            ``None`` (default) — a single draw, cheapest/fastest, matches the
            backend's raw behavior exactly.
            ``"duration_filter"`` — up to `max_attempts` draws, keeps the one
            whose duration best matches the phoneme-length-calibrated
            expectation (catches truncation/runaway-looping). No extra deps.
            ``"best_of_n"`` — `best_of_n` independent draws, transcribed via a
            local ASR model and reranked by character-error-rate vs `text`.
            Requires an ASR extra — see `asr_backend`.
        max_attempts:
            Draw budget for ``quality="duration_filter"``.
        best_of_n:
            Candidate count for ``quality="best_of_n"``.
        asr_backend:
            ASR reranker for ``quality="best_of_n"``: ``"whisper"`` (default,
            a Cantonese fine-tune of whisper-small, ``canto-tts[quality]``,
            torch-free — measured most accurate of all options tested) or
            ``"sensevoice"`` (SenseVoice-Small, ``canto-tts[quality-sensevoice]``
            — ~7x faster per candidate but less accurate than the whisper
            default; pulls in torch and a non-OSI ModelScope model license).
            See `canto_tts.quality` module docstring for the measured
            comparison.
        **kwargs:
            Backend-specific keyword arguments (e.g. ``ref_audio``), forwarded
            to every draw.

        Returns
        -------
        str
            The resolved output path (same as *out_path* on success).
        """
        if quality is None:
            return self._backend.synthesize(text, out_path, **kwargs)
        if quality == "duration_filter":
            from canto_tts.quality import duration_filter_synthesize

            return duration_filter_synthesize(
                self._backend, text, out_path, max_attempts=max_attempts, synth_kwargs=kwargs
            )
        if quality == "best_of_n":
            from canto_tts.quality import best_of_n_synthesize

            return best_of_n_synthesize(
                self._backend,
                text,
                out_path,
                best_of_n=best_of_n,
                asr_backend=asr_backend,
                synth_kwargs=kwargs,
            )
        raise ValueError(f"Unknown quality mode {quality!r} — expected None, 'duration_filter', or 'best_of_n'.")

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
