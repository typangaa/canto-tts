# canto-tts 🎙️

**Languages:** English (this page) · [繁體中文](README.zh-Hant.md) · [廣東話](README.md)

> Cantonese (Hong Kong) Text-to-Speech
> CPU-first, ONNX Runtime, Apache-2.0 — no GPU required.

[![PyPI](https://img.shields.io/pypi/v/canto-tts)](https://pypi.org/project/canto-tts/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Python](https://img.shields.io/pypi/pyversions/canto-tts)](https://pypi.org/project/canto-tts/)
[![HuggingFace](https://img.shields.io/badge/🤗%20Model-typangaa%2Fcanto--tts--nano-yellow)](https://huggingface.co/typangaa/canto-tts-nano)

---

## ✅ Status

> **Published** — `pip install canto-tts` ([PyPI](https://pypi.org/project/canto-tts/)), weights on
> HuggingFace ([`typangaa/canto-tts-nano`](https://huggingface.co/typangaa/canto-tts-nano)).
> `canto-tts-nano-v1` has passed every quality gate (CER 11.82% / tone accuracy 84.22% /
> code-switch CER 13.87%, N=5 repeat eval). `CantoTTS()` works out of the box with zero arguments.
>
> See [Limitations](#limitations) / [Model & License](#model--license) for the full gate table.

---

## Overview

`canto-tts` is an open-source Cantonese (Hong Kong) text-to-speech Python SDK.
It runs on CPU via ONNX Runtime (no GPU needed) and is fine-tuned from
[MOSS-TTS-Nano](https://github.com/OpenMOSS/MOSS-TTS) (0.1B parameters, GPT-2 backbone,
Apache-2.0, by OpenMOSS).

Key facts:
- **Input**: jyutping-phoneme tokens (the library converts raw Hanzi for you via `canto_hk_g2p`).
- **English code-switching**: English words inside a Cantonese sentence are kept as orthography and pronounced naturally.
- **CPU-first**: default backend is ONNX Runtime; PyTorch is optional.
- **Single default voice**: unconditional generation — no voice cloning or voice selection in the ONNX path (yet).
- **Weights**: auto-download from [typangaa/canto-tts-nano](https://huggingface.co/typangaa/canto-tts-nano) on first use (cached under `~/.cache/huggingface`).
- **Training data**: privately sourced (not released, for copyright reasons) — only the model weights are public.

---

## Install

```bash
pip install canto-tts
```

Optional extras:

| Extra | What it adds |
|-------|-------------|
| `canto-tts[demo]` | FastAPI demo server (`canto-tts-demo` command) |
| `canto-tts[torch]` | PyTorch backend |
| `canto-tts[quality]` | `quality="best_of_n"` with the default ASR reranker (torch-free) — see [Quality Modes](#quality-modes-opt-in-inference-time-reranking) |
| `canto-tts[quality-sensevoice]` | `quality="best_of_n"` with the faster `asr_backend="sensevoice"` reranker (adds torch) |
| `canto-tts[dev]` | Dev / test tools |

Installing from source (for development, or to track `main`):

```bash
git clone https://github.com/typangaa/canto-tts.git
cd canto-tts
pip install -e .
```

---

## Quickstart (Python SDK)

```python
from canto_tts import CantoTTS

tts = CantoTTS()  # auto-downloads typangaa/canto-tts-nano from HuggingFace on first use
tts.synthesize("多謝晒，今日天氣幾好。", "hello.wav")
print("Saved to hello.wav")

# Code-switching: English words inside Cantonese are read naturally
tts.synthesize("我哋一齊去 IFC food court 食飯。", "codeswitching.wav")
```

To point at your own locally-exported ONNX bundle instead (e.g. a checkpoint you fine-tuned
yourself via [`scripts/export_onnx.py`](scripts/export_onnx.py)), pass `checkpoint=`:

```python
tts = CantoTTS(checkpoint="/path/to/your/exported/onnx_weights")
```

See [`examples/quickstart.py`](examples/quickstart.py) for the full annotated version.

---

## CLI

```bash
canto-tts synthesize "多謝晒，今日天氣幾好。" -o hello.wav   # auto-downloads weights on first use

# Point at your own local export instead
canto-tts synthesize "..." -o out.wav --backend onnx --checkpoint /path/to/onnx_weights
```

Run `canto-tts --help` for all commands.

---

## Quality Modes (opt-in inference-time reranking)

`synthesize()` runs a single draw by default (fastest). Two opt-in `quality=` modes don't
change the model itself — they just pick a better draw to keep:

- `quality="duration_filter"`: runs up to `max_attempts` (default 3) draws and keeps the one
  whose duration is closest to the phoneme-length expectation. Catches the two most common
  catastrophic AR-codec failures (premature truncation / infinite looping). No extra
  dependencies — stops as soon as an in-range draw appears, doesn't always use the full budget.
- `quality="best_of_n"`: runs `best_of_n` (default 4) draws, transcribes each with a local ASR
  model, and keeps the one with the lowest character-error-rate (CER) against the input text.
  Catches problems duration-filtering can't (wrong tone, mispronunciation, garbled code-switch
  segments). Requires `canto-tts[quality]` (`asr_backend="whisper"`, default) or
  `canto-tts[quality-sensevoice]` (`asr_backend="sensevoice"`).

```python
tts.synthesize(text, "out.wav", quality="duration_filter", max_attempts=3)
tts.synthesize(text, "out.wav", quality="best_of_n", best_of_n=4, asr_backend="whisper")
```

```bash
canto-tts synthesize "..." -o out.wav --quality best_of_n --best-of-n 4 --asr-backend whisper
```

`asr_backend` options for `quality="best_of_n"` (measured on this project's own generation
output — mean CER is the ASR's own transcription error vs. known text, i.e. how sharp a
reranking signal it gives, not a general-purpose ASR quality claim):

| `asr_backend` | Extra | Mean CER | Speed | Dependency footprint |
|---|---|---|---|---|
| `"whisper"` (default) | `canto-tts[quality]` | 0.036 (most accurate) | ~1.3s/candidate | torch-free (faster-whisper / CTranslate2, a Cantonese fine-tune of whisper-small) |
| `"sensevoice"` | `canto-tts[quality-sensevoice]` | 0.053 | ~0.18s/candidate (~7x faster) | pulls in torch + torchaudio; non-OSI ModelScope model license (commercial use permitted) |

See [`canto_tts/quality.py`](src/canto_tts/quality.py)'s module docstring for the full tradeoff writeup.

---

## Web Demo (self-hosted)

```bash
pip install "canto-tts[demo]"
canto-tts-demo   # auto-downloads weights on first use; set CANTO_TTS_CHECKPOINT to override
# → open http://localhost:8000
```

The demo provides a browser-based UI with a text input and an audio player.
No API key required — designed for local / self-hosted use.

---

## Docker

```bash
# weights auto-download on first use; only edit docker/docker-compose.yml if you
# want to bind-mount your own local export and set CANTO_TTS_CHECKPOINT instead
docker compose -f docker/docker-compose.yml up
# → open http://localhost:8000
```

See [`docs/DEPLOY.md`](docs/DEPLOY.md) for full self-hosting instructions.

---

## Limitations

| Item | Detail |
|------|--------|
| **Quality** | CER 11.82% / tone accuracy 84.22% / code-switch CER 13.87% on a 100-sentence gate set (N=5 repeat eval, Qwen3-ASR judge). Pure-English CER 9.7%. Voice-clone (zero-shot) CER 10.2%. |
| **Voice** | Single baked default voice in the published ONNX bundle. No runtime voice selection or cloning via the ONNX backend; the underlying checkpoint supports zero-shot voice cloning (see the torch backend / `--ref-audio`), a multi-voice picker for the ONNX path is planned. |
| **Language** | Cantonese (Hong Kong) + English code-switching only. **No Mandarin support** (intentionally not preserved). |
| **Training data** | Privately sourced — not released (copyright), regardless of weight-release status. |
| **Weights** | ✅ Published — [huggingface.co/typangaa/canto-tts-nano](https://huggingface.co/typangaa/canto-tts-nano). |
| **Input** | Converts Hanzi → jyutping internally via `canto_hk_g2p`. Homophones are disambiguated by the G2P model; errors are possible. |
| **Audio** | 48,000 Hz stereo WAV output (native codec rate — see `MOSS-Audio-Tokenizer-Nano`). |

---

## Model & License

| | |
|--|--|
| **Base model** | [MOSS-TTS-Nano](https://github.com/OpenMOSS/MOSS-TTS) by OpenMOSS — 0.1B params, GPT-2 backbone |
| **Fine-tune** | Hong Kong Cantonese, privately sourced training data |
| **Weights** | ✅ Published at [huggingface.co/typangaa/canto-tts-nano](https://huggingface.co/typangaa/canto-tts-nano) |
| **License** | [Apache-2.0](LICENSE) (inherited from MOSS-TTS-Nano) |
| **GitHub** | [github.com/typangaa/canto-tts](https://github.com/typangaa/canto-tts) |

---

## Contributing

Issues and PRs welcome. Please open an issue before starting significant work.
See `CONTRIBUTING.md` (coming soon) for coding style and test conventions.

---

## Citation

If you use this work in research, please cite the base model:

```bibtex
@misc{moss-tts-nano,
  author    = {OpenMOSS},
  title     = {MOSS-TTS-Nano},
  year      = {2024},
  url       = {https://github.com/OpenMOSS/MOSS-TTS}
}
```
