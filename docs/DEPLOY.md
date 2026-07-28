# canto-tts Deployment Guide

> ✅ **Weights published** — [`typangaa/canto-tts-nano`](https://huggingface.co/typangaa/canto-tts-nano).
> Every `CantoTTS()` / CLI / demo call below auto-downloads on first use; pass an explicit
> local checkpoint (`--checkpoint`, `checkpoint=`, or `CANTO_TTS_CHECKPOINT`) only if you want
> to point at your own [`scripts/export_onnx.py`](../scripts/export_onnx.py) output instead.

This guide covers three ways to run canto-tts: local pip install, Docker self-hosting,
and a note on the public hosted demo.

---

## 1. Local — pip install + CLI

### Requirements

- Python ≥ 3.9
- Internet access on first run (to download model weights from HuggingFace, ~400 MB)
- No GPU required

### Install

```bash
pip install canto-tts
```

Installing from source instead (for development, or to track `main`):

```bash
git clone https://github.com/typangaa/canto-tts.git && cd canto-tts && pip install -e .
```

### Synthesise from the command line

```bash
canto-tts synthesize "多謝晒，今日天氣幾好。" -o hello.wav --checkpoint /path/to/onnx_weights
```

Run `canto-tts --help` for all options.

### Python SDK

```python
from canto_tts import CantoTTS

tts = CantoTTS(checkpoint="/path/to/onnx_weights")
tts.synthesize("多謝晒，今日天氣幾好。", "hello.wav")
```

### Self-hosted web demo

```bash
pip install -e ".[demo]"
CANTO_TTS_CHECKPOINT=/path/to/onnx_weights canto-tts-demo
# → open http://localhost:8000
```

> **Note**: For public-facing hosting, put a reverse proxy (nginx, Traefik, Caddy)
> in front to handle TLS, rate limiting, and any authentication you require.
> The demo app itself has no built-in auth or rate limiting by design (v0.1.0).

---

## 2. Docker (self-hosted)

### Prerequisites

- Docker ≥ 24
- Docker Compose ≥ 2

### Start the demo server

```bash
git clone https://github.com/typangaa/canto-tts.git
cd canto-tts
docker compose -f docker/docker-compose.yml up
# → open http://localhost:8000
```

Weights auto-download from HuggingFace on first start and are cached in a named Docker
volume (`huggingface_cache`); subsequent restarts are fast. Only edit
`docker/docker-compose.yml` if you want to bind-mount your own
`scripts/export_onnx.py` output dir and set `CANTO_TTS_CHECKPOINT` instead (see the
commented example in that file).

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CANTO_TTS_CHECKPOINT` | *(none — auto-downloads from HuggingFace)* | Local model directory inside the container (bind-mount it, see compose file) |
| `CANTO_TTS_PORT` | `8000` | Listen port inside the container |
| `HF_HOME` | `/root/.cache/huggingface` | HuggingFace cache path inside container |

### Stopping

```bash
docker compose -f docker/docker-compose.yml down
```

To also delete the weight cache volume:

```bash
docker compose -f docker/docker-compose.yml down -v
```

---

## 3. Public hosted demo

<!-- TODO: add hosted demo URL once deployed -->

A public hosted demo may be available in future. Check the project page for updates:
**https://github.com/typangaa/canto-tts**

> ⚠️ Even if a public demo is hosted, it is provided as-is for evaluation purposes only.
> Gate results: CER 11.82% / tone accuracy 84.22% / code-switch CER 13.87% (N=5 repeat eval).

---

## Security notes

- The demo API has no authentication or API key by design (v0.1.0, self-hosted OSS).
- If exposing publicly, add rate limiting at the reverse-proxy layer (e.g. nginx `limit_req`).
- The `/synthesize` endpoint accepts text up to 500 characters; longer inputs are rejected.

---

## Model weights & licensing

✅ Published — weights auto-download from
[huggingface.co/typangaa/canto-tts-nano](https://huggingface.co/typangaa/canto-tts-nano)
and are subject to the Apache-2.0 license (inherited from the MOSS-TTS-Nano base model by OpenMOSS).
