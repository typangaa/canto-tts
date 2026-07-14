# ------------------------------------------------------------
# canto-tts — CPU-first demo image (OSS / Nano release)
# Base: official python:3.12-slim (Debian bookworm-slim, ~45 MB)
# NO CUDA/GPU layers — GPU production images live in a separate repo.
# ------------------------------------------------------------
FROM python:3.12-slim

# ------------------------------------------------------------
# System dependencies
# build-essential is included defensively in case any transitive
# dependency needs a C compiler at install time.  In practice:
#   • onnxruntime ships prebuilt manylinux wheels → no compiler needed
#   • canto-hk-g2p (Rust+PyO3) ships prebuilt abi3 wheels → no compiler needed
# If future testing confirms these assumptions hold, this layer
# can be removed to shave ~200 MB off the image.
# ------------------------------------------------------------
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------
# Working directory — all app code lives here inside the image.
# ------------------------------------------------------------
WORKDIR /app

# ------------------------------------------------------------
# Copy the entire repository into the image and install the
# package in non-editable ("production") mode so the image is
# self-contained without requiring the source tree at runtime.
# The [demo] extra pulls in FastAPI, Uvicorn, and any other
# demo-server dependencies declared in pyproject.toml.
# --no-cache-dir keeps the layer lean by not writing the pip
# download cache to disk.
# ------------------------------------------------------------
COPY . /app

RUN pip install --no-cache-dir ".[demo]"

# ------------------------------------------------------------
# Hugging Face model cache
# Setting HF_HOME here lets operators bind-mount or use a
# named volume (see docker-compose.yml) so model weights
# downloaded on first run are reused across container restarts
# without re-downloading from the Hub.
# ------------------------------------------------------------
ENV HF_HOME=/root/.cache/huggingface

# ------------------------------------------------------------
# Port the demo FastAPI app listens on.
# ------------------------------------------------------------
EXPOSE 8000

# ------------------------------------------------------------
# Default entry point — the `canto-tts-demo` console script
# registered in pyproject.toml, which starts Uvicorn on 0.0.0.0:8000
# with the /synthesize endpoint and the bundled demo HTML page.
# ------------------------------------------------------------
CMD ["canto-tts-demo"]
