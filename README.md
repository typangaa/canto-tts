# canto-tts 🎙️

**Languages:** [English](README.en.md) · [繁體中文](README.zh-Hant.md) · 廣東話（依家呢版）

> 廣東話（香港）Text-to-Speech
> CPU-first,ONNX Runtime,Apache-2.0 —— 唔使 GPU。

[![PyPI](https://img.shields.io/pypi/v/canto-tts)](https://pypi.org/project/canto-tts/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Python](https://img.shields.io/pypi/pyversions/canto-tts)](https://pypi.org/project/canto-tts/)
[![HuggingFace](https://img.shields.io/badge/🤗%20Model-typangaa%2Fcanto--tts--nano-yellow)](https://huggingface.co/typangaa/canto-tts-nano)

---

## ✅ 狀態

> **已經 publish 咗**——`pip install canto-tts`([PyPI](https://pypi.org/project/canto-tts/)),weights
> 喺 HuggingFace([`typangaa/canto-tts-nano`](https://huggingface.co/typangaa/canto-tts-nano))。
> `canto-tts-nano-v1` 已經過晒全部 quality gate(CER 11.82% / tone accuracy 84.22% / code-switch
> CER 13.87%,N=5 repeat eval)。`CantoTTS()` 零參數就直接用得。
>
> 完整 gate 數字表見 [限制](#限制) / [Model--license](#model--license)。

---

## 簡介

`canto-tts` 係一個開源嘅廣東話(香港)text-to-speech Python SDK,用 ONNX Runtime 喺 CPU 度跑
(唔使 GPU),base model 係 fine-tune 自 [MOSS-TTS-Nano](https://github.com/OpenMOSS/MOSS-TTS)
(0.1B 參數,GPT-2 backbone,Apache-2.0,by OpenMOSS)。

要點:
- **Input**:jyutping-phoneme token(library 幫你用 `canto_hk_g2p` 將漢字全部轉晒)。
- **英文 code-switching**:句入面嘅英文字保留原文,讀出嚟自然。
- **CPU-first**:default backend 係 ONNX Runtime,PyTorch 淨係 optional。
- **單一 default voice**:unconditional generation —— ONNX 路線暫時未支援 voice cloning、冇 voice 揀。
- **Weights**:首次用會自動由 [typangaa/canto-tts-nano](https://huggingface.co/typangaa/canto-tts-nano) 落嚟(cache 喺 `~/.cache/huggingface`)。
- **訓練數據**:私有來源(因為 copyright 唔公開)——淨係 model weights 公開。

---

## Install

```bash
pip install canto-tts
```

Optional extras:

| Extra | 加咗咩 |
|-------|-------------|
| `canto-tts[demo]` | FastAPI demo server(`canto-tts-demo` 命令)|
| `canto-tts[torch]` | PyTorch backend |
| `canto-tts[quality]` | `quality="best_of_n"` 用 default ASR reranker(torch-free)—— 見 [Quality Modes](#quality-modes-opt-in-inference-time-reranking) |
| `canto-tts[quality-sensevoice]` | `quality="best_of_n"` 用快啲嘅 `asr_backend="sensevoice"` reranker(要裝 torch)|
| `canto-tts[dev]` | Dev / test 工具 |

由 source 裝(開發用,或者想跟 `main` 分支):

```bash
git clone https://github.com/typangaa/canto-tts.git
cd canto-tts
pip install -e .
```

---

## Quickstart(Python SDK)

```python
from canto_tts import CantoTTS

tts = CantoTTS()  # 首次用自動落 typangaa/canto-tts-nano
tts.synthesize("多謝晒，今日天氣幾好。", "hello.wav")
print("Saved to hello.wav")

# Code-switching:句入面嘅英文字讀得自然
tts.synthesize("我哋一齊去 IFC food court 食飯。", "codeswitching.wav")
```

想指去你自己本機 export 嘅 ONNX bundle(例如你自己 fine-tune 完,用
[`scripts/export_onnx.py`](scripts/export_onnx.py) export 出嚟嘅 checkpoint),傳 `checkpoint=` 就得:

```python
tts = CantoTTS(checkpoint="/path/to/your/exported/onnx_weights")
```

完整帶註解版本見 [`examples/quickstart.py`](examples/quickstart.py)。

---

## CLI

```bash
canto-tts synthesize "多謝晒，今日天氣幾好。" -o hello.wav   # 首次用自動落 weights

# 指去你自己本機 export
canto-tts synthesize "..." -o out.wav --backend onnx --checkpoint /path/to/onnx_weights
```

`canto-tts --help` 睇晒全部命令。

---

## Quality Modes(opt-in inference-time reranking)

`synthesize()` default 淨係跑一次 draw(最快)。兩種 opt-in `quality=` mode 都唔改 model 本身,
淨係揀邊個 draw 好過留低:

- `quality="duration_filter"`:最多跑 `max_attempts`(default 3)次,揀 duration 最貼近
  phoneme-length 預期嘅一個。捕捉最常見兩種 catastrophic AR-codec 失敗(過早截斷 / 無限循環)。
  唔使裝額外依賴,一撞到 in-range 嘅 draw 就即刻停,唔一定跑晒個 budget。
- `quality="best_of_n"`:跑 `best_of_n`(default 4)次,每次用本地 ASR model 轉錄,揀同輸入
  文字 character-error-rate(CER)最低嗰個。捕捉 duration 篩唔到嘅問題(錯調、發音錯、code-switch
  段落含糊)。要裝 `canto-tts[quality]`(`asr_backend="whisper"`,default)或者
  `canto-tts[quality-sensevoice]`(`asr_backend="sensevoice"`)。

```python
tts.synthesize(text, "out.wav", quality="duration_filter", max_attempts=3)
tts.synthesize(text, "out.wav", quality="best_of_n", best_of_n=4, asr_backend="whisper")
```

```bash
canto-tts synthesize "..." -o out.wav --quality best_of_n --best-of-n 4 --asr-backend whisper
```

`quality="best_of_n"` 嘅 `asr_backend` 選項(數字量度自呢個 project 自己嘅生成輸出——mean CER
係 ASR 自己嘅轉錄結果同已知文字嘅落差,即係話佢做 reranking signal 有幾準,唔係話呢個 ASR 本身
通用準確度):

| `asr_backend` | Extra | Mean CER | 速度 | Dependency |
|---|---|---|---|---|
| `"whisper"`(default) | `canto-tts[quality]` | 0.036(最準) | ~1.3s/candidate | torch-free(faster-whisper / CTranslate2,一個粵語 fine-tune 嘅 whisper-small) |
| `"sensevoice"` | `canto-tts[quality-sensevoice]` | 0.053 | ~0.18s/candidate(快 ~7x) | 要裝 torch + torchaudio;non-OSI ModelScope model license(容許商業用途) |

完整 trade-off 討論見 [`canto_tts/quality.py`](src/canto_tts/quality.py) module docstring。

---

## Web Demo(自己 host)

```bash
pip install "canto-tts[demo]"
canto-tts-demo   # 首次用自動落 weights;set CANTO_TTS_CHECKPOINT 可以 override
# → 開 http://localhost:8000
```

Demo 提供瀏覽器 UI,一個文字輸入 + 一個 audio player。冇 API key 要求——設計俾本機/自己
host 用。

---

## Docker

```bash
# weights 首次用自動落;想 bind-mount 你自己本機 export、set CANTO_TTS_CHECKPOINT
# 先至要改 docker/docker-compose.yml
docker compose -f docker/docker-compose.yml up
# → 開 http://localhost:8000
```

完整自己 host 教學見 [`docs/DEPLOY.zh-hk.md`](docs/DEPLOY.zh-hk.md)。

---

## 限制

| 項目 | Detail |
|------|--------|
| **Quality** | CER 11.82% / tone accuracy 84.22% / code-switch CER 13.87%,100 句 gate set(N=5 repeat eval,Qwen3-ASR 判官)。Pure-English CER 9.7%。Voice-clone(zero-shot)CER 10.2%。|
| **Voice** | 已 publish 嘅 ONNX bundle 淨係一個 baked default voice。ONNX backend 冇 runtime voice 揀或者 cloning;底層 checkpoint 支援 zero-shot voice cloning(見 torch backend / `--ref-audio`),ONNX 路線嘅 multi-voice picker 計劃緊。|
| **Language** | 淨係廣東話(香港)+ 英文 code-switching。**冇普通話支援**(刻意冇保留)。|
| **訓練數據** | 私有來源——唔公開(copyright),同 weight 有冇 release 冇關。|
| **Weights** | ✅ 已 publish —— [huggingface.co/typangaa/canto-tts-nano](https://huggingface.co/typangaa/canto-tts-nano)。|
| **Input** | 內部用 `canto_hk_g2p` 將漢字轉做 jyutping。同音字由 G2P model 消歧,有可能出錯。|
| **Audio** | 48,000 Hz stereo WAV output(codec 原生 rate——見 `MOSS-Audio-Tokenizer-Nano`)。|

---

## Model & License

| | |
|--|--|
| **Base model** | [MOSS-TTS-Nano](https://github.com/OpenMOSS/MOSS-TTS) by OpenMOSS —— 0.1B 參數,GPT-2 backbone |
| **Fine-tune** | 香港廣東話,私有來源訓練數據 |
| **Weights** | ✅ 已 publish 喺 [huggingface.co/typangaa/canto-tts-nano](https://huggingface.co/typangaa/canto-tts-nano) |
| **License** | [Apache-2.0](LICENSE)(繼承自 MOSS-TTS-Nano) |
| **GitHub** | [github.com/typangaa/canto-tts](https://github.com/typangaa/canto-tts) |

---

## Contributing

歡迎 Issues 同 PRs。有意做大改動之前請先開個 issue 傾下。Coding style / test 慣例見
`CONTRIBUTING.md`(未出)。

---

## Citation

如果你喺研究入面用到呢份工作,請 cite base model:

```bibtex
@misc{moss-tts-nano,
  author    = {OpenMOSS},
  title     = {MOSS-TTS-Nano},
  year      = {2024},
  url       = {https://github.com/OpenMOSS/MOSS-TTS}
}
```
