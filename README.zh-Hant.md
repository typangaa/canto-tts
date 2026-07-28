# canto-tts 🎙️

**Languages:** [English](README.en.md) · 繁體中文（本頁） · [廣東話](README.md)

> 廣東話（香港）語音合成（Text-to-Speech）
> CPU 優先，採用 ONNX Runtime，Apache-2.0 授權——無需 GPU。

[![PyPI](https://img.shields.io/pypi/v/canto-tts)](https://pypi.org/project/canto-tts/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Python](https://img.shields.io/pypi/pyversions/canto-tts)](https://pypi.org/project/canto-tts/)
[![HuggingFace](https://img.shields.io/badge/🤗%20Model-typangaa%2Fcanto--tts--nano-yellow)](https://huggingface.co/typangaa/canto-tts-nano)

---

## ✅ 現況

> **已正式發佈**——`pip install canto-tts`([PyPI](https://pypi.org/project/canto-tts/)），模型權重已上傳
> HuggingFace（[`typangaa/canto-tts-nano`](https://huggingface.co/typangaa/canto-tts-nano)）。
> `canto-tts-nano-v1` 已通過全部品質門檻（CER 11.82%、聲調準確率 84.22%、code-switch CER 13.87%，
> N=5 次重複評測）。`CantoTTS()` 無需任何參數即可直接使用。
>
> 完整評測數據表請見[限制](#限制)及[模型與授權](#模型與授權)章節。

---

## 簡介

`canto-tts` 是一個開源嘅廣東話（香港）語音合成 Python SDK，採用 ONNX Runtime 於 CPU 上運行
（無需 GPU），基於 [MOSS-TTS-Nano](https://github.com/OpenMOSS/MOSS-TTS)（0.1B 參數，GPT-2
架構，Apache-2.0 授權，由 OpenMOSS 開發）微調而成。

主要特點：
- **輸入方式**：粵拼（jyutping）音素標記——本函式庫會透過 `canto_hk_g2p` 自動將漢字轉換為音素。
- **英文語碼轉換（code-switching）**：句子中嘅英文單詞會保留原文拼寫，並自然發音。
- **CPU 優先**：預設後端為 ONNX Runtime，PyTorch 屬選用項目。
- **單一預設語音**：無條件生成模式——ONNX 路徑暫未支援語音克隆或語音選擇。
- **模型權重**：首次使用時會自動從 [typangaa/canto-tts-nano](https://huggingface.co/typangaa/canto-tts-nano) 下載（快取於 `~/.cache/huggingface`）。
- **訓練數據**：來自私有數據源（基於版權考量不予公開）——僅公開模型權重。

---

## 安裝

```bash
pip install canto-tts
```

可選擴充套件：

| Extra | 內容 |
|-------|-------------|
| `canto-tts[demo]` | FastAPI 示範伺服器（`canto-tts-demo` 指令） |
| `canto-tts[torch]` | PyTorch 後端 |
| `canto-tts[quality]` | `quality="best_of_n"` 配合預設 ASR 重排序器（不需 torch）——詳見[品質模式](#品質模式opt-in-inference-time-reranking) |
| `canto-tts[quality-sensevoice]` | `quality="best_of_n"` 配合較快嘅 `asr_backend="sensevoice"` 重排序器（需要 torch） |
| `canto-tts[dev]` | 開發/測試工具 |

從原始碼安裝（適用於開發或追蹤 `main` 分支）：

```bash
git clone https://github.com/typangaa/canto-tts.git
cd canto-tts
pip install -e .
```

---

## 快速開始（Python SDK）

```python
from canto_tts import CantoTTS

tts = CantoTTS()  # 首次使用會自動下載 typangaa/canto-tts-nano
tts.synthesize("多謝晒，今日天氣幾好。", "hello.wav")
print("Saved to hello.wav")

# 語碼轉換：句子中嘅英文字會自然發音
tts.synthesize("我哋一齊去 IFC food court 食飯。", "codeswitching.wav")
```

如欲改用自行匯出嘅本機 ONNX 模型（例如透過 [`scripts/export_onnx.py`](scripts/export_onnx.py)
匯出嘅自訂微調 checkpoint），請傳入 `checkpoint=` 參數：

```python
tts = CantoTTS(checkpoint="/path/to/your/exported/onnx_weights")
```

完整帶註解範例見 [`examples/quickstart.py`](examples/quickstart.py)。

---

## 命令列介面（CLI）

```bash
canto-tts synthesize "多謝晒，今日天氣幾好。" -o hello.wav   # 首次使用自動下載權重

# 改用自行匯出嘅本機模型
canto-tts synthesize "..." -o out.wav --backend onnx --checkpoint /path/to/onnx_weights
```

執行 `canto-tts --help` 查看全部指令。

---

## 品質模式（opt-in inference-time reranking）

`synthesize()` 預設只執行一次生成（速度最快）。兩種選用嘅 `quality=` 模式均不會改變模型本身，
只是從多次生成結果中挑選較佳者：

- `quality="duration_filter"`：最多執行 `max_attempts`（預設 3）次生成，並挑選音訊長度最接近
  音素長度預期嘅一次。可攔截兩種最常見嘅 AR-codec 嚴重失敗（過早截斷／無限循環）。無需額外
  依賴套件，一旦出現長度合理嘅結果即會停止，未必用盡整個預算。
- `quality="best_of_n"`：執行 `best_of_n`（預設 4）次生成，每次以本機 ASR 模型轉錄，並挑選
  與輸入文字字元錯誤率（CER）最低嘅一次。可攔截音訊長度篩選攔截唔到嘅問題（聲調錯誤、發音
  錯誤、語碼轉換段落含糊不清）。需要安裝 `canto-tts[quality]`（`asr_backend="whisper"`，預設）
  或 `canto-tts[quality-sensevoice]`（`asr_backend="sensevoice"`）。

```python
tts.synthesize(text, "out.wav", quality="duration_filter", max_attempts=3)
tts.synthesize(text, "out.wav", quality="best_of_n", best_of_n=4, asr_backend="whisper")
```

```bash
canto-tts synthesize "..." -o out.wav --quality best_of_n --best-of-n 4 --asr-backend whisper
```

`quality="best_of_n"` 嘅 `asr_backend` 選項（數據量度自本項目自身嘅生成輸出——平均 CER 指
ASR 本身嘅轉錄結果與已知文字之間嘅落差，即反映其作為重排序訊號嘅準確程度，並非該 ASR 嘅
通用準確度）：

| `asr_backend` | Extra | 平均 CER | 速度 | 依賴套件 |
|---|---|---|---|---|
| `"whisper"`（預設） | `canto-tts[quality]` | 0.036（最準確） | 約 1.3 秒/候選 | 不需 torch（faster-whisper／CTranslate2，一個粵語微調版 whisper-small） |
| `"sensevoice"` | `canto-tts[quality-sensevoice]` | 0.053 | 約 0.18 秒/候選（快約 7 倍） | 需要 torch + torchaudio；非 OSI 認證嘅 ModelScope 模型授權（允許商業用途） |

完整取捨討論見 [`canto_tts/quality.py`](src/canto_tts/quality.py) 模組文件字串。

---

## 網頁示範（自行架設）

```bash
pip install "canto-tts[demo]"
canto-tts-demo   # 首次使用自動下載權重；可設定 CANTO_TTS_CHECKPOINT 覆寫
# → 開啟 http://localhost:8000
```

示範程式提供瀏覽器介面，包含文字輸入框及音訊播放器。無需 API 金鑰——專為本機／自行架設使用而設計。

---

## Docker

```bash
# 權重會於首次使用時自動下載；如欲改用 bind-mount 嘅本機匯出模型，
# 才需要修改 docker/docker-compose.yml 並設定 CANTO_TTS_CHECKPOINT
docker compose -f docker/docker-compose.yml up
# → 開啟 http://localhost:8000
```

完整自行架設教學請見 [`docs/DEPLOY.zh-hk.md`](docs/DEPLOY.zh-hk.md)。

---

## 限制

| 項目 | 詳情 |
|------|--------|
| **品質** | CER 11.82% / 聲調準確率 84.22% / code-switch CER 13.87%，基於 100 句評測集（N=5 次重複評測，Qwen3-ASR 判官）。純英文 CER 9.7%。語音克隆（zero-shot）CER 10.2%。 |
| **語音** | 已發佈嘅 ONNX 模型包只內建單一預設語音。ONNX 後端不支援 runtime 語音選擇或克隆；底層 checkpoint 本身支援 zero-shot 語音克隆（見 torch 後端／`--ref-audio`），ONNX 路徑嘅多語音選擇器仍在規劃中。 |
| **語言** | 僅支援廣東話（香港）及英文語碼轉換。**不支援普通話**（刻意不予保留）。 |
| **訓練數據** | 私有來源——不予公開（版權考量），與模型權重是否發佈無關。 |
| **模型權重** | ✅ 已發佈——[huggingface.co/typangaa/canto-tts-nano](https://huggingface.co/typangaa/canto-tts-nano)。 |
| **輸入** | 內部透過 `canto_hk_g2p` 將漢字轉換為粵拼。同音字由 G2P 模型作消歧處理，仍有可能出現錯誤。 |
| **音訊** | 48,000 Hz 立體聲 WAV 輸出（編碼器原生取樣率——詳見 `MOSS-Audio-Tokenizer-Nano`）。 |

---

## 模型與授權

| | |
|--|--|
| **基礎模型** | [MOSS-TTS-Nano](https://github.com/OpenMOSS/MOSS-TTS)，由 OpenMOSS 開發——0.1B 參數，GPT-2 架構 |
| **微調內容** | 香港廣東話，私有來源訓練數據 |
| **模型權重** | ✅ 已發佈於 [huggingface.co/typangaa/canto-tts-nano](https://huggingface.co/typangaa/canto-tts-nano) |
| **授權條款** | [Apache-2.0](LICENSE)（繼承自 MOSS-TTS-Nano） |
| **GitHub** | [github.com/typangaa/canto-tts](https://github.com/typangaa/canto-tts) |

---

## 貢獻方式

歡迎提交 Issue 及 PR。進行重大改動前請先開 Issue 討論。程式風格及測試慣例請參閱
`CONTRIBUTING.md`（即將推出）。

---

## 引用

如在研究中使用本項目，請引用基礎模型：

```bibtex
@misc{moss-tts-nano,
  author    = {OpenMOSS},
  title     = {MOSS-TTS-Nano},
  year      = {2024},
  url       = {https://github.com/OpenMOSS/MOSS-TTS}
}
```
