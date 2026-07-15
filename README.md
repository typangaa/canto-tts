# canto-tts 🎙️

> **廣東話（香港）文字轉語音 · Cantonese Hong Kong Text-to-Speech**
> CPU-first, ONNX Runtime, Apache-2.0 — no GPU required.

[![PyPI](https://img.shields.io/pypi/v/canto-tts)](https://pypi.org/project/canto-tts/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Python](https://img.shields.io/pypi/pyversions/canto-tts)](https://pypi.org/project/canto-tts/)
[![HuggingFace](https://img.shields.io/badge/🤗%20Model-typangaa%2Fcanto--tts--nano-yellow)](https://huggingface.co/typangaa/canto-tts-nano)

---

## ⚠️ 狀態 / Status

> **🚧 Source-only preview — weights + PyPI package not published yet.**
> 呢個 repo 而家淨係公開緊 SDK 源碼(ONNX/torch backend、CLI、demo、Docker),**未上 PyPI,亦都未上 HuggingFace 放 weights**——checkpoint quality 仲喺迭代緊(現時 CER ~26.7%,未達生產門檻),等質素穩定咗先會正式發佈 weights + 上 PyPI。
> 想試嘅話,可以用 `scripts/export_onnx.py` 自己 export 一份 checkpoint(見 [Install](#install)),或者留意呢個 repo 嘅 release 動態。
>
> **Experimental beta** — quality is still in active iteration.
> Current CER on held-out validation set: **~26.7%** (N=3 repeat eval). Not suitable for production use yet.

See the [Limitations](#limitations--已知限制) section for full details.

---

## 廣東話簡介

`canto-tts` 係一個開源嘅廣東話（香港）文字轉語音 Python SDK，底層用 ONNX Runtime，唔需要 GPU。模型係由 [MOSS-TTS-Nano](https://github.com/OpenMOSS/MOSS-TTS) (OpenMOSS, Apache-2.0) fine-tune 而成，支援廣東話拼音輸入（jyutping phoneme tokens），以及英文 code-switching（英文字保留原文，唔需要另外做音素轉換）。

---

## English Description

`canto-tts` is an open-source Cantonese (Hong Kong) text-to-speech Python SDK.
It runs on CPU via ONNX Runtime (no GPU needed) and is fine-tuned from
[MOSS-TTS-Nano](https://github.com/OpenMOSS/MOSS-TTS) (0.1 B parameters, GPT-2 backbone, Apache-2.0).

Key facts:
- **Input**: jyutping-phoneme tokens (the library converts raw Hanzi for you via `canto_hk_g2p`).
- **English code-switching**: English words inside a Cantonese sentence are kept as orthography and pronounced naturally.
- **CPU-first**: default backend is ONNX Runtime; PyTorch is optional.
- **Single default voice**: unconditional generation — no voice cloning, no voice selection.
- **Weights**: will auto-download from [typangaa/canto-tts-nano](https://huggingface.co/typangaa/canto-tts-nano) once published (⚠️ **not published yet** — see [Status](#-狀態--status) above; for now you need your own local export, see below).
- **Training data**: privately sourced (not released for copyright reasons) — only the model weights will be public (once quality gates are met).

---

## Install

⚠️ **Not on PyPI yet.** Install from source for now:

```bash
git clone https://github.com/typangaa/canto-tts.git
cd canto-tts
pip install -e .
```

Once published, this will be `pip install canto-tts`.

Optional extras:

| Extra | What it adds |
|-------|-------------|
| `canto-tts[demo]` | FastAPI demo server (`canto-tts-demo` command) |
| `canto-tts[torch]` | PyTorch backend |
| `canto-tts[quality]` | `quality="best_of_n"` with the default ASR reranker (torch-free) — see [Quality Modes](#quality-modes-opt-in-inference-time-reranking) |
| `canto-tts[quality-sensevoice]` | `quality="best_of_n"` with the faster `asr_backend="sensevoice"` reranker (adds torch) |
| `canto-tts[dev]`  | Dev / test tools |

---

## Quickstart (Python SDK)

⚠️ Weights aren't published yet (see [Status](#-狀態--status)), so `CantoTTS()` with no arguments
will fail on the auto-download step for now. Point it at your own locally-exported ONNX
bundle (see [`scripts/export_onnx.py`](scripts/export_onnx.py)) via `checkpoint=`:

```python
from canto_tts import CantoTTS

tts = CantoTTS(checkpoint="/path/to/your/exported/onnx_weights")  # local dir from scripts/export_onnx.py
tts.synthesize("多謝晒，今日天氣幾好。", "hello.wav")
print("Saved to hello.wav")

# Code-switching: English words inside Cantonese are read naturally
tts.synthesize("我哋一齊去 IFC food court 食飯。", "codeswitching.wav")
```

Once weights are published, `CantoTTS()` with no arguments will auto-download them.

See [`examples/quickstart.py`](examples/quickstart.py) for the full annotated version.

---

## CLI

```bash
# ⚠️ weights not published yet — point at your own local export for now:
canto-tts synthesize "多謝晒，今日天氣幾好。" -o hello.wav --checkpoint /path/to/onnx_weights

# Specify backend explicitly
canto-tts synthesize "..." -o out.wav --backend onnx --checkpoint /path/to/onnx_weights
```

Once weights are published, `--checkpoint` becomes optional (defaults to the official repo).
Run `canto-tts --help` for all commands.

---

## Quality Modes (opt-in inference-time reranking)

`synthesize()` 預設淨係跑一次 draw(最快)。兩種 opt-in `quality=` mode 都唔改 model 本身,淨係揀邊個 draw 好過留低:

- `quality="duration_filter"`:最多跑 `max_attempts`(default 3)次,揀 duration 最貼近 phoneme-length 預期嘅一個。捕捉最常見嘅兩種 catastrophic AR-codec 失敗(過早截斷 / 無限循環)。**唔使裝額外依賴**,一停到 in-range 嘅 draw 就即刻停,唔一定跑晒個 budget。
- `quality="best_of_n"`:跑 `best_of_n`(default 4)次,每次用本地 ASR model 轉錄,揀同輸入文字 character-error-rate(CER)最低嘅一個。捕捉 duration 篩唔到嘅問題(錯調、發音錯、code-switch 段落含糊)。需要 `canto-tts[quality]`(`asr_backend="whisper"`,default)或 `canto-tts[quality-sensevoice]`(`asr_backend="sensevoice"`)。

```python
tts.synthesize(text, "out.wav", quality="duration_filter", max_attempts=3)
tts.synthesize(text, "out.wav", quality="best_of_n", best_of_n=4, asr_backend="whisper")
```

```bash
canto-tts synthesize "..." -o out.wav --quality best_of_n --best-of-n 4 --asr-backend whisper
```

`asr_backend` options for `quality="best_of_n"` (measured on this project's own generation output — mean CER = the ASR's own transcription error vs. known text, i.e. how sharp a reranking signal it gives, not a general-purpose ASR quality claim):

| `asr_backend` | Extra | Mean CER | Speed | Dependency footprint |
|---|---|---|---|---|
| `"whisper"` (default) | `canto-tts[quality]` | 0.036 (most accurate) | ~1.3s/candidate | torch-free (faster-whisper / CTranslate2, a Cantonese fine-tune of whisper-small) |
| `"sensevoice"` | `canto-tts[quality-sensevoice]` | 0.053 | ~0.18s/candidate (~7x faster) | pulls in torch + torchaudio; non-OSI ModelScope model license (commercial use permitted) |

See [`canto_tts/quality.py`](src/canto_tts/quality.py)'s module docstring for the full tradeoff writeup.

---

## Web Demo (self-hosted)

```bash
pip install -e ".[demo]"
CANTO_TTS_CHECKPOINT=/path/to/onnx_weights canto-tts-demo   # weights not published yet, see Status
# → open http://localhost:8000
```

The demo provides a browser-based UI with a text input and an audio player.
No API key required — designed for local / self-hosted use.

---

## Docker

```bash
# edit docker/docker-compose.yml to bind-mount your local export dir and set
# CANTO_TTS_CHECKPOINT (weights not published yet, see Status above)
docker compose -f docker/docker-compose.yml up
# → open http://localhost:8000
```

See [`docs/DEPLOY.md`](docs/DEPLOY.md) for full self-hosting instructions.

---

## Limitations / 已知限制

| Item | Detail |
|------|--------|
| **Quality** | ⚠️ ~26.7% CER on held-out validation (N=3). Experimental beta — not production quality. |
| **Voice** | Single default voice only. No voice cloning, no voice selection, no multi-speaker. |
| **Language** | Cantonese (Hong Kong) + English code-switching only. **No Mandarin support.** |
| **Training data** | Privately sourced — not released (copyright), regardless of weight-release status. |
| **Weights** | ⚠️ Not published yet (source-code preview only) — see [Status](#-狀態--status). |
| **Input** | Converts Hanzi → jyutping internally via `canto_hk_g2p`. Homophones are disambiguated by the G2P model; errors are possible. |
| **Audio** | 48 000 Hz stereo WAV output (native codec rate — see `MOSS-Audio-Tokenizer-Nano`). |

---

## Model & License

| | |
|--|--|
| **Base model** | [MOSS-TTS-Nano](https://github.com/OpenMOSS/MOSS-TTS) by OpenMOSS — 0.1 B params, GPT-2 backbone |
| **Fine-tune** | Hong Kong Cantonese, privately sourced training data |
| **Weights** | ⚠️ Not published yet — planned at [huggingface.co/typangaa/canto-tts-nano](https://huggingface.co/typangaa/canto-tts-nano) once quality gates are met |
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
