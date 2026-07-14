# canto-tts Deployment Guide

> ⚠️ **Weights are not published yet** (source-only preview — see the repo README
> Status section). Every `CantoTTS()` / CLI / demo call below needs an explicit
> local checkpoint (`--checkpoint`, `checkpoint=`, or `CANTO_TTS_CHECKPOINT`) from
> [`scripts/export_onnx.py`](../scripts/export_onnx.py) until then. Once published,
> drop the checkpoint argument and it will auto-download.

This guide covers three ways to run canto-tts: local pip install, Docker self-hosting,
and a note on the public hosted demo.

---

## 1. Local — pip install + CLI

### Requirements

- Python ≥ 3.9
- Internet access on first run (to download model weights from HuggingFace, ~400 MB) — once published
- No GPU required

### Install

```bash
git clone https://github.com/typangaa/canto-tts.git && cd canto-tts && pip install -e .
```

(Not on PyPI yet — once published, this will be `pip install canto-tts`.)

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

⚠️ Weights are not published yet — edit `docker/docker-compose.yml` to bind-mount a
local `scripts/export_onnx.py` output dir and set `CANTO_TTS_CHECKPOINT` (see the
commented example in that file) before starting. Once weights are published, the
container will download them from HuggingFace on first start and cache them in a
named Docker volume (`huggingface_cache`); subsequent restarts are fast.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CANTO_TTS_CHECKPOINT` | *(none — auto-download once published)* | Local model directory inside the container (bind-mount it, see compose file) |
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
> The model is experimental beta (~26.7% CER) and is not suitable for production workloads.

---

## Security notes

- The demo API has no authentication or API key by design (v0.1.0, self-hosted OSS).
- If exposing publicly, add rate limiting at the reverse-proxy layer (e.g. nginx `limit_req`).
- The `/synthesize` endpoint accepts text up to 500 characters; longer inputs are rejected.

---

## Model weights & licensing

⚠️ Not published yet — checkpoint quality is still in active iteration (currently
~26.7% CER, see the repo README Status section). Once published, weights will
auto-download from
[huggingface.co/typangaa/canto-tts-nano](https://huggingface.co/typangaa/canto-tts-nano)
and will be subject to the Apache-2.0 license (inherited from the MOSS-TTS-Nano base model by OpenMOSS).
