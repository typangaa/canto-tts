"""
canto_tts.api.app
~~~~~~~~~~~~~~~~~
Minimal FastAPI demo server for the canto-tts SDK.

Usage (via console script):
    canto-tts-demo          # starts on http://0.0.0.0:8000

Or directly:
    python -m canto_tts.api.app

# TODO: rate-limit at reverse-proxy layer for public hosting
#       (e.g. nginx limit_req_zone or Traefik middleware).
#       Do NOT add in-app rate limiting for v0.1.0 — this is
#       a self-hosted OSS demo; auth / throttling is out of scope.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, field_validator

# ---------------------------------------------------------------------------
# Lifespan: load the TTS model once at startup, share via app.state
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load CantoTTS once at startup; clean up on shutdown.

    CANTO_TTS_CHECKPOINT (optional): local model directory to use instead of
    auto-downloading the default HuggingFace repo -- e.g. for self-hosters
    running docker-compose with a bind-mounted export, or for testing a
    freshly-exported bundle before it's published to the Hub.
    """
    from canto_tts import CantoTTS  # imported here so the app module is importable
                                     # even if canto_tts core isn't fully installed yet
    checkpoint = os.environ.get("CANTO_TTS_CHECKPOINT")
    app.state.tts = CantoTTS(checkpoint=checkpoint)
    app.state.synth_lock = asyncio.Lock()
    # HF Hub's cache layout is `snapshots/<commit_sha>/` -- the resolved model
    # dir's own basename IS the loaded revision, no separate lookup needed.
    model_dir = getattr(getattr(app.state.tts, "_backend", None), "_model_dir", None)
    app.state.model_revision = Path(model_dir).name if model_dir else None
    yield
    # Nothing to clean up for the ONNX backend, but hook is here for future use.


# ---------------------------------------------------------------------------
# App instance
# ---------------------------------------------------------------------------

app = FastAPI(
    title="canto-tts demo",
    description=(
        "Self-hosted Cantonese HK text-to-speech demo. "
        "⚠️ Experimental beta — single default voice, no cloning."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS & Auth Middleware
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Dynamic origins allowed for localhost IPC
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Canto-Auth-Token"],
    expose_headers=["X-Canto-Phonemes", "X-Canto-Latency-Ms", "X-Canto-Quality-Mode"],
)


@app.middleware("http")
async def verify_auth_token(request: Request, call_next):
    """Verify X-Canto-Auth-Token header if CANTO_TTS_SECRET_TOKEN is set in environment."""
    secret = os.environ.get("CANTO_TTS_SECRET_TOKEN")
    if secret and request.url.path not in ("/health", "/", "/docs", "/openapi.json"):
        token = request.headers.get("X-Canto-Auth-Token")
        if not token or token != secret:
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=401, content={"detail": "Unauthorized: invalid or missing X-Canto-Auth-Token"})
    return await call_next(request)

_TEMPLATES_DIR = Path(__file__).parent / "templates"
_TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
templates = Jinja2Templates(directory=str(_TEMPLATES_DIR))

_STATIC_DIR = Path(__file__).parent / "static"
_STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class SynthesizeRequest(BaseModel):
    text: str
    quality: str | None = None
    max_attempts: int = 3
    best_of_n: int = 4
    asr_backend: str = "whisper"

    @field_validator("text")
    @classmethod
    def text_must_not_be_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("text must not be empty")
        if len(v) > 500:
            raise ValueError("text must be ≤ 500 characters for the demo")
        return v

    @field_validator("quality")
    @classmethod
    def quality_must_be_valid(cls, v: str | None) -> str | None:
        if v not in (None, "duration_filter", "best_of_n"):
            raise ValueError("quality must be one of None, 'duration_filter', 'best_of_n'")
        return v

    @field_validator("asr_backend")
    @classmethod
    def asr_backend_must_be_valid(cls, v: str) -> str:
        if v not in ("whisper", "sensevoice"):
            raise ValueError("asr_backend must be one of 'whisper', 'sensevoice'")
        return v


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
async def health(request: Request):
    """Health check endpoint for sidecar and desktop UI status monitoring."""
    tts = getattr(request.app.state, "tts", None)
    model_loaded = tts is not None and getattr(tts, "_backend", None) is not None
    model_dir = str(getattr(tts._backend, "_model_dir", "")) if model_loaded else None
    return {
        "status": "ok",
        "version": "0.1.0",
        "backend": "onnx",
        "model_loaded": model_loaded,
        "model_dir": model_dir,
    }


@app.get("/model-version")
async def model_version(request: Request):
    """Cheap check for a newer model-weight revision on HuggingFace Hub.

    Metadata-only (no download) -- safe for the desktop UI to call once per
    launch to decide whether to show a "new model weights available" notice.
    """
    from canto_tts.hub import DEFAULT_HF_REPO, check_for_model_update

    current_revision = getattr(request.app.state, "model_revision", None)
    return check_for_model_update(repo_id=DEFAULT_HF_REPO, current_revision=current_revision)


class PhonemeRequest(BaseModel):
    text: str


@app.post("/phonemize")
async def phonemize(body: PhonemeRequest, request: Request):
    """Convert text to space-separated Jyutping phonemes."""
    tts = request.app.state.tts
    return {"text": body.text, "phonemes": tts.to_phoneme(body.text)}


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def index(request: Request) -> HTMLResponse:
    """Serve the single-page demo UI."""
    return templates.TemplateResponse(request, "index.html")


@app.post("/synthesize")
async def synthesize(body: SynthesizeRequest, request: Request):
    """
    Synthesize speech from Cantonese (or Cantonese+English) text.

    Returns a WAV audio file.
    """
    tts = request.app.state.tts

    # Write to a temp file; FastAPI's FileResponse will stream it.
    # We use delete=False so FileResponse can read it after the context exits,
    # then clean it up via background= parameter.
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp_path = tmp.name
    tmp.close()

    try:
        synth_lock = getattr(request.app.state, "synth_lock", None)
        if synth_lock is not None:
            async with synth_lock:
                t_start = time.perf_counter()
                tts.synthesize(
                    body.text,
                    tmp_path,
                    quality=body.quality,
                    max_attempts=body.max_attempts,
                    best_of_n=body.best_of_n,
                    asr_backend=body.asr_backend,
                )
        else:
            t_start = time.perf_counter()
            tts.synthesize(
                body.text,
                tmp_path,
                quality=body.quality,
                max_attempts=body.max_attempts,
                best_of_n=body.best_of_n,
                asr_backend=body.asr_backend,
            )
    except Exception as exc:
        # Clean up the temp file on error
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise HTTPException(status_code=500, detail=f"Synthesis failed: {exc}") from exc
    elapsed_ms = str(round((time.perf_counter() - t_start) * 1000))

    if not os.path.exists(tmp_path) or os.path.getsize(tmp_path) == 0:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise HTTPException(status_code=500, detail="Synthesis produced no output.")

    try:
        phonemes = tts.to_phoneme(body.text)
        header_phonemes = quote(phonemes)
    except Exception as exc:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise HTTPException(status_code=500, detail=f"Phonemization failed: {exc}") from exc

    return FileResponse(
        path=tmp_path,
        media_type="audio/wav",
        filename="output.wav",
        background=_delete_file_background(tmp_path),
        headers={
            # Percent-encoded: phoneme output can carry the source text's
            # full-width punctuation (e.g. ，。), which isn't latin-1-safe
            # and HTTP headers require latin-1. The frontend decodes with
            # decodeURIComponent().
            "X-Canto-Phonemes": header_phonemes,
            "X-Canto-Latency-Ms": elapsed_ms,
            "X-Canto-Quality-Mode": body.quality if body.quality is not None else "none",
        },
    )


# ---------------------------------------------------------------------------
# Helper: background cleanup task for the temp WAV
# ---------------------------------------------------------------------------

from starlette.background import BackgroundTask  # noqa: E402 — after app definition


def _delete_file_background(path: str) -> BackgroundTask:
    def _rm():
        try:
            os.unlink(path)
        except OSError:
            pass
    return BackgroundTask(_rm)


# ---------------------------------------------------------------------------
# Entry point (console script: canto-tts-demo)
# ---------------------------------------------------------------------------

def main() -> None:
    """Start the demo server / sidecar process.

    Supports CLI flags:
        --port <port>           Listen port (default: 8000 or CANTO_TTS_PORT)
        --secret-token <token>  Secret token required in X-Canto-Auth-Token header
    """
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser(description="CantoTTS Engine API Server & Sidecar")
    parser.add_argument("--port", type=int, default=int(os.environ.get("CANTO_TTS_PORT", "8000")), help="Listen port")
    parser.add_argument("--secret-token", type=str, default=os.environ.get("CANTO_TTS_SECRET_TOKEN"), help="Secret auth token")
    args, _ = parser.parse_known_args()

    if args.secret_token:
        os.environ["CANTO_TTS_SECRET_TOKEN"] = args.secret_token

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=args.port,
        reload=False,
    )


if __name__ == "__main__":
    main()
