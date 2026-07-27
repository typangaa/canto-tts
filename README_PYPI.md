# canto-tts

**Cantonese Hong Kong Text-to-Speech · CPU-first · Apache-2.0**

[![PyPI](https://img.shields.io/pypi/v/canto-tts)](https://pypi.org/project/canto-tts/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/typangaa/canto-tts/blob/main/LICENSE)
[![Python](https://img.shields.io/pypi/pyversions/canto-tts)](https://pypi.org/project/canto-tts/)

An open-source Cantonese (Hong Kong) text-to-speech SDK.
Runs on CPU via ONNX Runtime — no GPU required.
Fine-tuned from [MOSS-TTS-Nano](https://github.com/OpenMOSS/MOSS-TTS)
(0.1 B params, GPT-2 backbone, Apache-2.0, by OpenMOSS).

> **Weights published** — CER 11.82% / tone accuracy 84.22% / code-switch CER 13.87%
> on a 100-sentence gate set (N=5 repeat eval).
> Single default voice only — no voice cloning, no voice selection (yet).
> **PyPI package not published yet** — install from source for now;
> see the [GitHub repo](https://github.com/typangaa/canto-tts) for current status.

---

## Install

```bash
git clone https://github.com/typangaa/canto-tts.git && cd canto-tts && pip install -e .
```

## Quickstart

```python
from canto_tts import CantoTTS

tts = CantoTTS()  # auto-downloads typangaa/canto-tts-nano from HuggingFace on first use
tts.synthesize("多謝晒，今日天氣幾好。", "hello.wav")
print("Saved to hello.wav")

# English code-switching works too
tts.synthesize("我哋一齊去 IFC food court 食飯。", "codeswitching.wav")
```

Weights auto-download from HuggingFace and cache via the Hub (`~/.cache/huggingface/hub/`).

## Quality Modes (opt-in)

Two opt-in `quality=` modes trade extra compute for a more reliable draw, without touching the model:

```python
tts.synthesize(text, "out.wav", quality="duration_filter", max_attempts=3)   # no extra deps
tts.synthesize(text, "out.wav", quality="best_of_n", best_of_n=4)            # needs canto-tts[quality]
```

`quality="best_of_n"` reranks N draws by ASR character-error-rate; pass `asr_backend="sensevoice"` (needs `canto-tts[quality-sensevoice]`) for ~7x faster reranking at a small accuracy cost. Full writeup: [GitHub README](https://github.com/typangaa/canto-tts#quality-modes-opt-in-inference-time-reranking).

## Limitations

| | |
|--|--|
| **Quality** | CER 11.82% / tone accuracy 84.22% / code-switch CER 13.87% (N=5 repeat, 100-sentence gate set). |
| **Voice** | Single default voice. No voice cloning, no voice selection (yet). |
| **Language** | Cantonese (Hong Kong) + English code-switching only. No Mandarin. |
| **Training data** | Privately sourced — not released (copyright), regardless of weight status. |
| **Weights** | ✅ Published — [huggingface.co/typangaa/canto-tts-nano](https://huggingface.co/typangaa/canto-tts-nano). |

## Model & License

- **Base model**: [MOSS-TTS-Nano](https://github.com/OpenMOSS/MOSS-TTS) by OpenMOSS
- **Weights**: published at [huggingface.co/typangaa/canto-tts-nano](https://huggingface.co/typangaa/canto-tts-nano)
- **License**: Apache-2.0 (inherited from MOSS-TTS-Nano)

## Full Documentation

Full README, CLI docs, Docker self-hosting, and deployment guide:
**https://github.com/typangaa/canto-tts**
