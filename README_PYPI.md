# canto-tts

**Cantonese Hong Kong Text-to-Speech · CPU-first · Apache-2.0**

[![PyPI](https://img.shields.io/pypi/v/canto-tts)](https://pypi.org/project/canto-tts/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/typangaa/canto-tts/blob/main/LICENSE)
[![Python](https://img.shields.io/pypi/pyversions/canto-tts)](https://pypi.org/project/canto-tts/)

An open-source Cantonese (Hong Kong) text-to-speech SDK.
Runs on CPU via ONNX Runtime — no GPU required.
Fine-tuned from [MOSS-TTS-Nano](https://github.com/OpenMOSS/MOSS-TTS)
(0.1 B params, GPT-2 backbone, Apache-2.0, by OpenMOSS).

> **⚠️ Experimental beta** — ~26.7% CER on held-out validation (N=3).
> Not suitable for production use.
> Single default voice only — no voice cloning, no voice selection.
> **Weights not published yet** — checkpoint quality is still in active iteration;
> see the [GitHub repo](https://github.com/typangaa/canto-tts) for current status.

---

## Install

```bash
git clone https://github.com/typangaa/canto-tts.git && cd canto-tts && pip install -e .
```

## Quickstart

```python
from canto_tts import CantoTTS

tts = CantoTTS(checkpoint="/path/to/your/exported/onnx_weights")  # weights not published yet
tts.synthesize("多謝晒，今日天氣幾好。", "hello.wav")
print("Saved to hello.wav")

# English code-switching works too
tts.synthesize("我哋一齊去 IFC food court 食飯。", "codeswitching.wav")
```

Once weights are published to HuggingFace, `CantoTTS()` with no arguments will
auto-download and cache them via the Hub (`~/.cache/huggingface/hub/`).

## Limitations

| | |
|--|--|
| **Quality** | ⚠️ ~26.7% CER on held-out validation (N=3). Experimental beta. |
| **Voice** | Single default voice. No voice cloning, no voice selection. |
| **Language** | Cantonese (Hong Kong) + English code-switching only. No Mandarin. |
| **Training data** | Privately sourced — not released (copyright), regardless of weight status. |
| **Weights** | ⚠️ Not published yet — source-code preview only. |

## Model & License

- **Base model**: [MOSS-TTS-Nano](https://github.com/OpenMOSS/MOSS-TTS) by OpenMOSS
- **Weights**: not published yet — planned at [huggingface.co/typangaa/canto-tts-nano](https://huggingface.co/typangaa/canto-tts-nano)
- **License**: Apache-2.0 (inherited from MOSS-TTS-Nano)

## Full Documentation

Full README, CLI docs, Docker self-hosting, and deployment guide:
**https://github.com/typangaa/canto-tts**
