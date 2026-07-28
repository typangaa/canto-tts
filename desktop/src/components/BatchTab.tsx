// src/components/BatchTab.tsx — Full Batch Processing with Multi-Format Export Suite

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Layers,
  Upload,
  FileText,
  Play,
  CheckCircle2,
  AlertCircle,
  Download,
  RefreshCw,
  XCircle,
  RotateCcw,
  FileArchive,
  FileCode,
  Sliders,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import JSZip from "jszip";
import { synthesize, type SynthesizeParams } from "../api";

interface BatchTabProps {
  engineUrl: string;
}

export interface BatchItem {
  id: number;
  text: string;
  status: "pending" | "processing" | "done" | "error";
  error?: string;
  blob?: Blob;
  audioUrl?: string;
  latencyMs?: number;
}

const STORAGE_KEY_BATCH_CONFIG = "canto_tts_batch_config";
const STORAGE_KEY_STUDIO_CONFIG = "canto_tts_studio_config";

export interface BatchConfig {
  qualityMode: string;
  maxAttempts: number;
  bestOfN: number;
  asrBackend: string;
}

const DEFAULT_BATCH_CONFIG: BatchConfig = {
  qualityMode: "none",
  maxAttempts: 3,
  bestOfN: 4,
  asrBackend: "whisper",
};

function getInitialBatchConfig(): BatchConfig {
  let studioConfig: Partial<BatchConfig> = {};
  try {
    const studioRaw = localStorage.getItem(STORAGE_KEY_STUDIO_CONFIG);
    if (studioRaw) {
      studioConfig = JSON.parse(studioRaw);
    }
  } catch {
    // Ignore invalid JSON / storage errors
  }

  let batchConfig: Partial<BatchConfig> = {};
  try {
    const batchRaw = localStorage.getItem(STORAGE_KEY_BATCH_CONFIG);
    if (batchRaw) {
      batchConfig = JSON.parse(batchRaw);
    }
  } catch {
    // Ignore invalid JSON / storage errors
  }

  return {
    qualityMode:
      typeof batchConfig.qualityMode === "string"
        ? batchConfig.qualityMode
        : typeof studioConfig.qualityMode === "string"
        ? studioConfig.qualityMode
        : DEFAULT_BATCH_CONFIG.qualityMode,
    maxAttempts:
      typeof batchConfig.maxAttempts === "number" && !isNaN(batchConfig.maxAttempts)
        ? batchConfig.maxAttempts
        : typeof studioConfig.maxAttempts === "number" && !isNaN(studioConfig.maxAttempts)
        ? studioConfig.maxAttempts
        : DEFAULT_BATCH_CONFIG.maxAttempts,
    bestOfN:
      typeof batchConfig.bestOfN === "number" && !isNaN(batchConfig.bestOfN)
        ? batchConfig.bestOfN
        : typeof studioConfig.bestOfN === "number" && !isNaN(studioConfig.bestOfN)
        ? studioConfig.bestOfN
        : DEFAULT_BATCH_CONFIG.bestOfN,
    asrBackend:
      typeof batchConfig.asrBackend === "string"
        ? batchConfig.asrBackend
        : typeof studioConfig.asrBackend === "string"
        ? studioConfig.asrBackend
        : DEFAULT_BATCH_CONFIG.asrBackend,
  };
}

// Parse text or SRT/VTT file into line items
function parseFileToLines(content: string, isSrt: boolean): string[] {
  if (isSrt) {
    const rawLines = content.split(/\r?\n/);
    const cleaned: string[] = [];
    for (const line of rawLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^\d+$/.test(trimmed)) continue; // skip subtitle index
      if (/^\d{2}:\d{2}:\d{2}/.test(trimmed)) continue; // skip timestamp line
      if (trimmed.startsWith("WEBVTT")) continue;
      cleaned.push(trimmed);
    }
    return cleaned.filter((l) => l.length > 0);
  }

  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// Helper to locate subchunk offset and byte size inside a WAV RIFF buffer
function findWavSubchunk(buffer: ArrayBuffer, chunkId: string): { dataOffset: number; size: number } {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12) throw new Error("Buffer too short to be a valid WAV");

  const riffHeader = String.fromCharCode(
    view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)
  );
  if (riffHeader !== "RIFF") throw new Error("Invalid RIFF header in WAV file");

  let offset = 12;
  while (offset < buffer.byteLength - 8) {
    const id = String.fromCharCode(
      view.getUint8(offset), view.getUint8(offset + 1),
      view.getUint8(offset + 2), view.getUint8(offset + 3)
    );
    const chunkSize = view.getUint32(offset + 4, true);

    if (id === chunkId) {
      return { dataOffset: offset + 8, size: chunkSize };
    }
    offset += 8 + chunkSize;
  }
  throw new Error(`Subchunk '${chunkId}' not found in WAV buffer`);
}

// Robust WAV concatenation using RIFF chunk discovery
async function concatenateWavBlobs(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 0) return new Blob([], { type: "audio/wav" });

  try {
    const buffers = await Promise.all(blobs.map((b) => b.arrayBuffer()));
    const firstBuf = buffers[0];
    const dataChunkInfo = findWavSubchunk(firstBuf, "data");

    const headerBytes = new Uint8Array(firstBuf.slice(0, dataChunkInfo.dataOffset));
    const dataSlices: Uint8Array[] = [];
    let totalDataLength = 0;

    for (const buf of buffers) {
      const { dataOffset, size } = findWavSubchunk(buf, "data");
      const slice = new Uint8Array(buf, dataOffset, size);
      dataSlices.push(slice);
      totalDataLength += size;
    }

    const combined = new Uint8Array(headerBytes.length + totalDataLength);
    combined.set(headerBytes, 0);

    const view = new DataView(combined.buffer);
    view.setUint32(4, combined.length - 8, true);

    const dataSizeOffset = dataChunkInfo.dataOffset - 4;
    view.setUint32(dataSizeOffset, totalDataLength, true);

    let currentOffset = headerBytes.length;
    for (const slice of dataSlices) {
      combined.set(slice, currentOffset);
      currentOffset += slice.length;
    }

    return new Blob([combined], { type: "audio/wav" });
  } catch (err) {
    console.error("WAV Concatenation Error:", err);
    throw new Error("WAV audio concatenation failed.");
  }
}

// Format seconds into SRT timestamp string (00:00:00,000)
function formatSrtTime(totalSec: number): string {
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = Math.floor(totalSec % 60);
  const millis = Math.round((totalSec % 1) * 1000);
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export const BatchTab: React.FC<BatchTabProps> = ({ engineUrl }) => {
  const [fileName, setFileName] = useState<string | null>(null);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [combinedAudioUrl, setCombinedAudioUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isZipping, setIsZipping] = useState<boolean>(false);

  const [qualityMode, setQualityMode] = useState<string>(() => getInitialBatchConfig().qualityMode);
  const [maxAttempts, setMaxAttempts] = useState<number>(() => getInitialBatchConfig().maxAttempts);
  const [bestOfN, setBestOfN] = useState<number>(() => getInitialBatchConfig().bestOfN);
  const [asrBackend, setAsrBackend] = useState<string>(() => getInitialBatchConfig().asrBackend);
  const [isQualityCollapsed, setIsQualityCollapsed] = useState<boolean>(true);

  // Sync batch configuration updates to localStorage
  useEffect(() => {
    const config: BatchConfig = {
      qualityMode,
      maxAttempts,
      bestOfN,
      asrBackend,
    };
    localStorage.setItem(STORAGE_KEY_BATCH_CONFIG, JSON.stringify(config));
  }, [qualityMode, maxAttempts, bestOfN, asrBackend]);

  const cancelRef = useRef<boolean>(false);
  const objectUrlsRef = useRef<Set<string>>(new Set());

  // Clean up blob URLs on unmount
  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      objectUrlsRef.current.clear();
    };
  }, []);

  // Helper to process uploaded or dropped file
  const processUploadedFile = useCallback((file: File) => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current.clear();

    setFileName(file.name);
    setCombinedAudioUrl(null);
    cancelRef.current = false;

    const isSrt = file.name.endsWith(".srt") || file.name.endsWith(".vtt");
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = (evt.target?.result as string) || "";
      const rawLines = parseFileToLines(text, isSrt);
      const parsedItems: BatchItem[] = rawLines.map((t, idx) => ({
        id: idx,
        text: t,
        status: "pending",
      }));
      setItems(parsedItems);
    };
    reader.readAsText(file);
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processUploadedFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processUploadedFile(file);
  };

  // Synthesize single item
  const synthesizeSingleItem = useCallback(
    async (item: BatchItem): Promise<BatchItem> => {
      const params: SynthesizeParams = {
        text: item.text,
        quality: qualityMode,
        max_attempts: maxAttempts,
        best_of_n: bestOfN,
        asr_backend: asrBackend,
      };

      try {
        const result = await synthesize(params, engineUrl);
        const url = URL.createObjectURL(result.audioBlob);
        objectUrlsRef.current.add(url);
        return {
          ...item,
          status: "done",
          blob: result.audioBlob,
          audioUrl: url,
          latencyMs: result.latencyMs,
          error: undefined,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ...item,
          status: "error",
          error: msg,
        };
      }
    },
    [engineUrl, qualityMode, maxAttempts, bestOfN, asrBackend]
  );

  // Single Item Manual Retry
  const handleRetryItem = async (index: number) => {
    setItems((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, status: "processing" } : item))
    );

    const targetItem = items[index];
    const updated = await synthesizeSingleItem(targetItem);

    setItems((prev) => prev.map((item, idx) => (idx === index ? updated : item)));
  };

  // Start Batch Processing Loop
  const startBatchProcessing = async () => {
    if (items.length === 0 || isProcessing) return;
    setIsProcessing(true);
    cancelRef.current = false;
    setCombinedAudioUrl(null);

    const completedBlobs: Blob[] = [];

    for (let i = 0; i < items.length; i++) {
      if (cancelRef.current) break;

      setCurrentIndex(i);

      setItems((prev) =>
        prev.map((item, idx) => (idx === i ? { ...item, status: "processing" } : item))
      );

      const currentItem = items[i];
      const updatedItem = await synthesizeSingleItem(currentItem);

      if (updatedItem.status === "done" && updatedItem.blob) {
        completedBlobs.push(updatedItem.blob);
      }

      setItems((prev) =>
        prev.map((item, idx) => (idx === i ? updatedItem : item))
      );
    }

    if (completedBlobs.length > 0) {
      try {
        const mergedBlob = await concatenateWavBlobs(completedBlobs);
        const mergedUrl = URL.createObjectURL(mergedBlob);
        objectUrlsRef.current.add(mergedUrl);
        setCombinedAudioUrl(mergedUrl);
      } catch {
        // Concatenation error handled silently
      }
    }

    setIsProcessing(false);
  };

  // Cancel Batch Processing
  const cancelBatchProcessing = () => {
    cancelRef.current = true;
    setIsProcessing(false);
  };

  // Export 1: ZIP of Split Sentence WAVs
  const handleDownloadZip = async () => {
    const doneItems = items.filter((i) => i.status === "done" && i.blob);
    if (doneItems.length === 0 || isZipping) return;

    setIsZipping(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder("canto_tts_sentences");

      let metaText = "CantoTTS Batch Generation Metadata\n===================================\n\n";

      doneItems.forEach((item, idx) => {
        const num = String(idx + 1).padStart(3, "0");
        const filename = `${num}_sentence.wav`;
        if (item.blob) {
          folder?.file(filename, item.blob);
          metaText += `[${filename}] ${item.text}\n`;
        }
      });

      folder?.file("index.txt", metaText);

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `canto_tts_sentences_${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("ZIP Generation Error:", err);
    } finally {
      setIsZipping(false);
    }
  };

  // Export 2: Synchronized SRT Subtitle Export
  const handleDownloadSrtSync = async () => {
    const doneItems = items.filter((i) => i.status === "done" && i.blob);
    if (doneItems.length === 0) return;

    let currentTime = 0;
    const srtBlocks: string[] = [];

    for (let i = 0; i < doneItems.length; i++) {
      const item = doneItems[i];
      if (!item.blob) continue;

      try {
        const buf = await item.blob.arrayBuffer();
        const dataInfo = findWavSubchunk(buf, "data");
        // 48000 Hz, 2 channels (stereo), 16-bit (2 bytes per sample)
        const durationSec = dataInfo.size / (48000 * 2 * 2);

        const startTimeStr = formatSrtTime(currentTime);
        const endTimeStr = formatSrtTime(currentTime + durationSec);

        srtBlocks.push(`${i + 1}\n${startTimeStr} --> ${endTimeStr}\n${item.text}\n`);
        currentTime += durationSec + 0.35; // 350ms pause between subtitles
      } catch {
        // Skip timestamp calculation if buffer unreadable
      }
    }

    const srtContent = srtBlocks.join("\n");
    const blob = new Blob([srtContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `synced_${fileName || "subtitles"}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doneCount = items.filter((i) => i.status === "done").length;
  const progressPercent = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;

  const SAMPLE_TXT = `多謝晒，今日天氣幾好。
我哋一齊去 IFC food court 食飯。
香港作為國際金融中心，擁有獨特嘅優勢。
早晨呀！最近忙緊啲乜嘢？得閒出嚟飲茶。`;

  const SAMPLE_SRT = `1
00:00:01,000 --> 00:00:03,500
多謝晒，今日天氣幾好。

2
00:00:04,000 --> 00:00:07,000
我哋一齊去 IFC food court 食飯。

3
00:00:08,000 --> 00:00:11,500
香港作為國際金融中心，擁有獨特嘅優勢。`;

  const handleLoadSample = (type: "txt" | "srt") => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current.clear();

    const content = type === "txt" ? SAMPLE_TXT : SAMPLE_SRT;
    const isSrt = type === "srt";
    const name = type === "txt" ? "sample_cantonese.txt" : "sample_subtitles.srt";

    setFileName(name);
    setCombinedAudioUrl(null);
    cancelRef.current = false;

    const rawLines = parseFileToLines(content, isSrt);
    const parsedItems: BatchItem[] = rawLines.map((t, idx) => ({
      id: idx,
      text: t,
      status: "pending",
    }));
    setItems(parsedItems);
  };

  return (
    <div className="batch-layout">
      <div className="workbench-card">
        <div className="card-header">
          <div className="card-title">
            <Layers size={18} /> 文字 / SRT 字幕批次處理
          </div>
          {items.length > 0 && (
            <span className="char-count">
              共 {items.length} 段句子 ({doneCount} / {items.length} 已完成)
            </span>
          )}
        </div>

        {/* Upload Container */}
        <div
          className={`file-dropzone ${isDragging ? "dragging" : ""}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <Upload size={36} color="#00f2fe" />
          <p className="dropzone-text">點擊上傳或拖放 .txt / .srt / .vtt 檔案至此處</p>
          <input
            type="file"
            accept=".txt,.srt,.vtt"
            onChange={handleFileInputChange}
            className="file-input-hidden"
          />
        </div>

        {/* Format Examples & Sample File Buttons */}
        {!fileName && (
          <div className="format-guide-ribbon">
            <div className="guide-header">
              <FileText size={14} />
              <span><b>支援檔案格式參考範例：</b></span>
            </div>
            <div className="guide-examples">
              <div className="example-box">
                <div className="example-title">
                  <span>📄 純文字檔 (.txt)</span>
                  <button className="mini-sample-btn" onClick={() => handleLoadSample("txt")}>
                    載入 TXT 範本
                  </button>
                </div>
                <pre className="example-code">{`每行獨立為一段廣東話句子：\n多謝晒，今日天氣幾好。\n我哋一齊去 IFC food court 食飯。`}</pre>
              </div>
              <div className="example-box">
                <div className="example-title">
                  <span>🎬 字幕檔 (.srt / .vtt)</span>
                  <button className="mini-sample-btn" onClick={() => handleLoadSample("srt")}>
                    載入 SRT 範本
                  </button>
                </div>
                <pre className="example-code">{`標準 SRT 時間軸字幕格式：\n1\n00:00:01,000 --> 00:00:03,500\n多謝晒，今日天氣幾好。`}</pre>
              </div>
            </div>
          </div>
        )}

        {fileName && (
          <div className="file-info-bar">
            <FileText size={16} /> <b>已載入檔案：</b> {fileName} （共 {items.length} 行）
          </div>
        )}

        {/* Collapsible Quality Mode Controls */}
        {items.length > 0 && (
          <div className="batch-quality-panel" style={{ marginBottom: "16px" }}>
            <button
              type="button"
              className="sample-btn"
              onClick={() => setIsQualityCollapsed(!isQualityCollapsed)}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" }}
            >
              <Sliders size={14} />
              <span>品質與 ASR 重排設定</span>
              {qualityMode !== "none" && (
                <span className="badge processing" style={{ marginLeft: "4px", fontSize: "0.75rem" }}>
                  {qualityMode}
                </span>
              )}
              {isQualityCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>

            {!isQualityCollapsed && (
              <div
                className="controls-row"
                style={{
                  marginTop: "10px",
                  padding: "12px",
                  background: "rgba(15, 23, 42, 0.6)",
                  borderRadius: "8px",
                  border: "1px solid var(--card-border, #1e293b)",
                }}
              >
                <div className="control-group">
                  <label className="control-label">Quality 模式：</label>
                  <select
                    value={qualityMode}
                    onChange={(e) => setQualityMode(e.target.value)}
                    className="select-input"
                  >
                    <option value="none">預設 Single Draw (最快)</option>
                    <option value="duration_filter">Duration Filter (防截斷/防循環)</option>
                    <option value="best_of_n">Best-of-N (ASR 重新排序)</option>
                  </select>
                </div>

                {qualityMode === "duration_filter" && (
                  <div className="control-group">
                    <label className="control-label">Max Attempts：</label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={maxAttempts}
                      onChange={(e) => setMaxAttempts(Number(e.target.value))}
                      className="number-input"
                    />
                  </div>
                )}

                {qualityMode === "best_of_n" && (
                  <>
                    <div className="control-group">
                      <label className="control-label">Candidate N：</label>
                      <input
                        type="number"
                        min={2}
                        max={8}
                        value={bestOfN}
                        onChange={(e) => setBestOfN(Number(e.target.value))}
                        className="number-input"
                      />
                    </div>
                    <div className="control-group">
                      <label className="control-label">ASR Backend：</label>
                      <select
                        value={asrBackend}
                        onChange={(e) => setAsrBackend(e.target.value)}
                        className="select-input"
                      >
                        <option value="whisper">Whisper Small (Torch-free, 準確)</option>
                        <option value="sensevoice">SenseVoice (快速)</option>
                      </select>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Actions & Progress */}
        {items.length > 0 && (
          <div className="batch-actions-bar">
            <div className="progress-container">
              <div className="progress-bar-bg">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="progress-text">{progressPercent}%</span>
            </div>

            <div className="batch-btn-group">
              {isProcessing ? (
                <button
                  className="sample-btn danger-btn"
                  onClick={cancelBatchProcessing}
                >
                  <XCircle size={16} /> 停止批次處理
                </button>
              ) : (
                <button
                  className="synthesize-btn"
                  onClick={startBatchProcessing}
                  disabled={items.length === 0}
                >
                  <Play size={16} /> 開始全自動批次生成
                </button>
              )}

              {/* Full Export Suite */}
              {doneCount > 0 && (
                <>
                  {combinedAudioUrl && (
                    <a
                      href={combinedAudioUrl}
                      download={`combined_${fileName || "audio"}.wav`}
                      className="download-btn"
                      title="下載整份文件合併語音"
                    >
                      <Download size={16} /> 合併 WAV
                    </a>
                  )}

                  <button
                    className="download-btn"
                    onClick={handleDownloadZip}
                    disabled={isZipping}
                    title="將所有分句打包下載為 ZIP"
                  >
                    {isZipping ? <RefreshCw size={16} className="spin-icon" /> : <FileArchive size={16} />}
                    分句 ZIP
                  </button>

                  <button
                    className="download-btn"
                    onClick={handleDownloadSrtSync}
                    title="根據語音長度自動生成同步 SRT"
                  >
                    <FileCode size={16} /> 同步 SRT
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Line Items Table */}
        {items.length > 0 && (
          <div className="batch-items-list">
            <div className="items-header">
              <span>#</span>
              <span>句子文字</span>
              <span>狀態</span>
              <span>試聽 / 動作</span>
            </div>

            {items.map((item, idx) => (
              <div
                key={item.id}
                className={`item-row ${idx === currentIndex && isProcessing ? "active-row" : ""}`}
              >
                <span className="item-idx">{idx + 1}</span>
                <span className="item-text">{item.text}</span>
                <span className="item-status">
                  {item.status === "pending" && (
                    <span className="badge pending">等待中</span>
                  )}
                  {item.status === "processing" && (
                    <span className="badge processing">
                      <RefreshCw size={12} className="spin-icon" /> 合成中...
                    </span>
                  )}
                  {item.status === "done" && (
                    <span className="badge done">
                      <CheckCircle2 size={12} /> 完成 ({item.latencyMs}ms)
                    </span>
                  )}
                  {item.status === "error" && (
                    <span className="badge error" title={item.error}>
                      <AlertCircle size={12} /> 失敗
                    </span>
                  )}
                </span>
                <span className="item-action">
                  {item.audioUrl ? (
                    <audio controls src={item.audioUrl} className="mini-audio" />
                  ) : item.status === "error" ? (
                    <button
                      className="retry-btn"
                      onClick={() => handleRetryItem(idx)}
                      disabled={isProcessing}
                    >
                      <RotateCcw size={12} /> 重試
                    </button>
                  ) : (
                    <span className="placeholder-dash">-</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
