# canto-tts 部署指南（繁體中文 · 香港）

> ⚠️ **Weights 未公開發布**（淨係源碼 preview——見 repo README 嘅 Status 段落）。下面每一個
> `CantoTTS()` / CLI / demo 用法都要明確指定本地 checkpoint（`--checkpoint`、`checkpoint=`
> 或者 `CANTO_TTS_CHECKPOINT`），嚟自 [`scripts/export_onnx.py`](../scripts/export_onnx.py)
> 嘅 export 輸出。等 weights 公開咗之後,唔使再帶呢個參數,自動 download。

本指南介紹三種運行 canto-tts 嘅方式：本地 pip 安裝、Docker 自架伺服器，以及公開 hosted demo 嘅說明。

---

## 1. 本地安裝 — pip + CLI

### 系統要求

- Python ≥ 3.9
- 第一次運行需要互聯網連線（從 HuggingFace 下載模型 weights，約 400 MB）—— 呢個要等公開咗先得
- **唔需要** GPU（純 CPU 運行）

### 安裝

```bash
git clone https://github.com/typangaa/canto-tts.git && cd canto-tts && pip install -e .
```

（未上 PyPI——公開之後會係 `pip install canto-tts`。）

### 用 CLI 合成語音

```bash
canto-tts synthesize "多謝晒，今日天氣幾好。" -o hello.wav --checkpoint /path/to/onnx_weights
```

執行 `canto-tts --help` 查看所有選項。

### Python SDK 用法

```python
from canto_tts import CantoTTS

tts = CantoTTS(checkpoint="/path/to/onnx_weights")
tts.synthesize("多謝晒，今日天氣幾好。", "hello.wav")
```

### 自架 web demo

```bash
pip install -e ".[demo]"
CANTO_TTS_CHECKPOINT=/path/to/onnx_weights canto-tts-demo
# → 打開瀏覽器：http://localhost:8000
```

> **注意**：如果需要對外公開，請喺前面加 reverse proxy（例如 nginx、Traefik、Caddy）
> 處理 TLS、rate limiting 同埋認證。Demo app 本身冇內建 auth 或 rate limiting（v0.1.0 設計如此）。

---

## 2. Docker（自架伺服器）

### 前置條件

- Docker ≥ 24
- Docker Compose ≥ 2

### 啟動 demo 伺服器

```bash
git clone https://github.com/typangaa/canto-tts.git
cd canto-tts
docker compose -f docker/docker-compose.yml up
# → 打開瀏覽器：http://localhost:8000
```

⚠️ Weights 未公開發布——起之前要編輯 `docker/docker-compose.yml`，bind-mount 一個本地
`scripts/export_onnx.py` 嘅 export 輸出目錄，設定 `CANTO_TTS_CHECKPOINT`（見嗰個檔案入面
comment 咗嘅示範）。等 weights 公開咗之後,container 第一次啟動先會自動從 HuggingFace 下載,
並快取喺一個 Docker named volume（`huggingface_cache`）;之後重啟速度快好多。

### 環境變數

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `CANTO_TTS_CHECKPOINT` | *（冇——等公開咗先自動 download）* | Container 內部嘅本地 model 目錄（bind-mount 佢，見 compose 檔案） |
| `CANTO_TTS_PORT` | `8000` | Container 內部監聽嘅端口 |
| `HF_HOME` | `/root/.cache/huggingface` | Container 內部嘅 HuggingFace cache 路徑 |

### 停止

```bash
docker compose -f docker/docker-compose.yml down
```

如果想一併刪除 weights cache volume：

```bash
docker compose -f docker/docker-compose.yml down -v
```

---

## 3. 公開 hosted demo

<!-- TODO: add hosted demo URL once deployed -->

未來可能會有公開嘅 hosted demo，請留意以下項目頁面嘅更新：
**https://github.com/typangaa/canto-tts**

> ⚠️ 即使有公開 demo，都只係用作評估目的，不保證穩定性。
> 模型屬實驗性 beta 版（~26.7% CER），唔適合生產環境使用。

---

## 安全注意事項

- Demo API 本身冇任何認證或 API key（v0.1.0 設計，自架 OSS 用途）。
- 如果要對外公開，請喺 reverse proxy 層加 rate limiting（例如 nginx `limit_req`）。
- `/synthesize` endpoint 最多接受 500 個字符，超出嘅請求會被拒絕。

---

## 模型 weights 同授權

⚠️ 未公開發布——checkpoint quality 仲喺迭代緊（現時 ~26.7% CER,見 repo README Status 段落）。
公開咗之後,weights 會自動從
[huggingface.co/typangaa/canto-tts-nano](https://huggingface.co/typangaa/canto-tts-nano)
下載，適用 Apache-2.0 授權（由 OpenMOSS 嘅 MOSS-TTS-Nano 基礎模型繼承）。

訓練數據屬私人來源，基於版權原因唔公開；只有模型 weights 係公開發布。
