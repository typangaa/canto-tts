// src/components/StudioTab.tsx — Single Text Synthesis Studio Tab

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  FileText,
  Sparkles,
  RefreshCw,
  Music,
  Download,
  AlertCircle,
  Mic,
  Upload,
  X,
  ChevronDown,
  ChevronUp,
  Gauge,
} from "lucide-react";
import { synthesize, synthesizeWithClone, phonemize, type SynthesizeParams, type SynthesizeCloneParams } from "../api";
import { exportAudio, downloadBlob } from "../utils/audioExporter";
import { VoiceRecorder } from "./VoiceRecorder";

interface StudioTabProps {
  engineUrl: string;
}

const PRESET_SAMPLES = [
  { label: "日常用語", text: "多謝晒，今日天氣幾好。" },
  { label: "英粵混讀", text: "我哋一齊去 IFC food court 食飯。" },
  { label: "商業新聞", text: "香港作為國際金融中心，擁有獨特嘅優勢。" },
  { label: "生活問候", text: "早晨呀！最近忙緊啲乜嘢？得閒出嚟飲茶。" },
];

const STORAGE_KEY_STUDIO_CONFIG = "canto_tts_studio_config";

interface StudioConfig {
  qualityMode: string;
  maxAttempts: number;
  bestOfN: number;
  asrBackend: string;
}

const DEFAULT_STUDIO_CONFIG: StudioConfig = {
  qualityMode: "none",
  maxAttempts: 3,
  bestOfN: 4,
  asrBackend: "whisper",
};

function getInitialStudioConfig(): StudioConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_STUDIO_CONFIG);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        qualityMode: typeof parsed.qualityMode === "string" ? parsed.qualityMode : DEFAULT_STUDIO_CONFIG.qualityMode,
        maxAttempts: typeof parsed.maxAttempts === "number" && !isNaN(parsed.maxAttempts) ? parsed.maxAttempts : DEFAULT_STUDIO_CONFIG.maxAttempts,
        bestOfN: typeof parsed.bestOfN === "number" && !isNaN(parsed.bestOfN) ? parsed.bestOfN : DEFAULT_STUDIO_CONFIG.bestOfN,
        asrBackend: typeof parsed.asrBackend === "string" ? parsed.asrBackend : DEFAULT_STUDIO_CONFIG.asrBackend,
      };
    }
  } catch {
    // Ignore invalid JSON / storage errors
  }
  return DEFAULT_STUDIO_CONFIG;
}

export const StudioTab: React.FC<StudioTabProps> = ({ engineUrl }) => {
  const [inputText, setInputText] = useState<string>("多謝晒，今日天氣幾好。");
  const [qualityMode, setQualityMode] = useState<string>(() => getInitialStudioConfig().qualityMode);
  const [maxAttempts, setMaxAttempts] = useState<number>(() => getInitialStudioConfig().maxAttempts);
  const [bestOfN, setBestOfN] = useState<number>(() => getInitialStudioConfig().bestOfN);
  const [asrBackend, setAsrBackend] = useState<string>(() => getInitialStudioConfig().asrBackend);

  // Sync studio configuration updates to localStorage
  useEffect(() => {
    const config: StudioConfig = {
      qualityMode,
      maxAttempts,
      bestOfN,
      asrBackend,
    };
    localStorage.setItem(STORAGE_KEY_STUDIO_CONFIG, JSON.stringify(config));
  }, [qualityMode, maxAttempts, bestOfN, asrBackend]);

  const [isSynthesizing, setIsSynthesizing] = useState<boolean>(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [phonemes, setPhonemes] = useState<string>("");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Voice Cloning State
  const [refAudioFile, setRefAudioFile] = useState<File | null>(null);
  const [refAudioUrl, setRefAudioUrl] = useState<string | null>(null);
  const [isClonePanelOpen, setIsClonePanelOpen] = useState<boolean>(false);
  const [cloneInputMode, setCloneInputMode] = useState<"upload" | "record">("upload");
  const prevRefAudioUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleRecordedAudioComplete = (file: File, url: string) => {
    if (prevRefAudioUrlRef.current) {
      URL.revokeObjectURL(prevRefAudioUrlRef.current);
    }
    prevRefAudioUrlRef.current = url;
    setRefAudioFile(file);
    setRefAudioUrl(url);
    setErrorMessage(null);
  };

  const handleRefAudioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        setErrorMessage("參考音訊檔案大小不可以超過 10MB。");
        if (e.target) e.target.value = "";
        return;
      }
      if (prevRefAudioUrlRef.current) {
        URL.revokeObjectURL(prevRefAudioUrlRef.current);
      }
      const url = URL.createObjectURL(file);
      prevRefAudioUrlRef.current = url;
      setRefAudioFile(file);
      setRefAudioUrl(url);
      setErrorMessage(null);
    }
  };

  const handleClearRefAudio = () => {
    if (prevRefAudioUrlRef.current) {
      URL.revokeObjectURL(prevRefAudioUrlRef.current);
      prevRefAudioUrlRef.current = null;
    }
    setRefAudioFile(null);
    setRefAudioUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Playback speed and audio export state
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const rawAudioBlobRef = useRef<Blob | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleSpeedSelect = (speed: number) => {
    setPlaybackSpeed(speed);
    if (audioRef.current) {
      // preservesPitch defaults to TRUE on <audio>, but the exporter resamples
      // (AudioBufferSourceNode.playbackRate has no pitch preservation and a
      // phase vocoder is not worth pulling in here). Left at the default, the
      // preview would sound pitch-corrected while the downloaded file came out
      // pitch-shifted. Force it off so preview == export, WYSIWYG.
      audioRef.current.preservesPitch = false;
      audioRef.current.playbackRate = speed;
    }
  };

  const handleExportDownload = async () => {
    if (!rawAudioBlobRef.current || isExporting) return;
    setIsExporting(true);
    try {
      const { blob, ext } = await exportAudio(rawAudioBlobRef.current, playbackSpeed);
      const suffix = playbackSpeed !== 1.0 ? `_${playbackSpeed}x` : "";
      downloadBlob(blob, `canto_tts${suffix}_${Date.now()}.${ext}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`音檔匯出失敗: ${msg}`);
    } finally {
      setIsExporting(false);
    }
  };

  // Ref to hold previous blob URL for proper revocation
  const prevAudioUrlRef = useRef<string | null>(null);

  // Clean up blob URL on unmount
  useEffect(() => {
    return () => {
      if (prevAudioUrlRef.current) {
        URL.revokeObjectURL(prevAudioUrlRef.current);
      }
      if (prevRefAudioUrlRef.current) {
        URL.revokeObjectURL(prevRefAudioUrlRef.current);
      }
    };
  }, []);

  // Debounced Phonemize
  useEffect(() => {
    if (!inputText.trim()) {
      setPhonemes("");
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await phonemize(inputText, engineUrl);
        setPhonemes(res);
      } catch {
        // Silent catch for live phonemize preview
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [inputText, engineUrl]);

  const isSynthesizingRef = useRef(false);

  // Synthesize Handler
  const handleSynthesize = useCallback(async () => {
    if (!inputText.trim() || isSynthesizingRef.current) return;
    isSynthesizingRef.current = true;
    setIsSynthesizing(true);
    setErrorMessage(null);

    try {
      let result;
      if (refAudioFile) {
        const cloneParams: SynthesizeCloneParams = {
          text: inputText.trim(),
          refAudioFile,
          quality: qualityMode,
          max_attempts: maxAttempts,
          best_of_n: bestOfN,
          asr_backend: asrBackend,
        };
        result = await synthesizeWithClone(cloneParams, engineUrl);
      } else {
        const params: SynthesizeParams = {
          text: inputText.trim(),
          quality: qualityMode,
          max_attempts: maxAttempts,
          best_of_n: bestOfN,
          asr_backend: asrBackend,
        };
        result = await synthesize(params, engineUrl);
      }

      // Clean up previous blob URL to prevent browser memory leaks
      if (prevAudioUrlRef.current) {
        URL.revokeObjectURL(prevAudioUrlRef.current);
      }

      const newUrl = URL.createObjectURL(result.audioBlob);
      prevAudioUrlRef.current = newUrl;
      rawAudioBlobRef.current = result.audioBlob;
      setPlaybackSpeed(1.0);
      setAudioUrl(newUrl);

      if (result.phonemes) setPhonemes(result.phonemes);
      setLatencyMs(result.latencyMs);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg || "語音生成失敗，請檢查引擎連線。");
    } finally {
      isSynthesizingRef.current = false;
      setIsSynthesizing(false);
    }
  }, [inputText, refAudioFile, qualityMode, maxAttempts, bestOfN, asrBackend, engineUrl]);

  // Keyboard shortcut Ctrl+Enter or Cmd+Enter to synthesize
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleSynthesize();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSynthesize]);

  return (
    <div className="studio-layout">
      <div className="workbench-card">
        <div className="card-header">
          <div className="card-title">
            <FileText size={18} /> 輸入廣東話文字
          </div>
          <span className="char-count">
            {inputText.length} / 500 字 （按 Ctrl+Enter 快捷生成）
          </span>
        </div>

        <textarea
          className="cantonese-textarea"
          placeholder="請輸入廣東話或英粵混讀文字，例如：多謝晒，今日天氣幾好。"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          maxLength={500}
          rows={4}
        />

        {/* Preset Sample Prompts */}
        <div className="sample-prompts">
          <span className="prompt-label">快捷範本：</span>
          {PRESET_SAMPLES.map((sample, idx) => (
            <button
              key={idx}
              className="sample-btn"
              onClick={() => setInputText(sample.text)}
            >
              {sample.label}
            </button>
          ))}
        </div>

        {/* Jyutping Live Breakdown Ribbon */}
        {phonemes && (
          <div className="jyutping-ribbon">
            <span className="ribbon-title">Jyutping 音素分解：</span>
            <div className="phoneme-tags">
              {phonemes.split(" ").map((p, i) => (
                <span key={i} className="jyutping-tag">
                  {p}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Voice Cloning Panel */}
        <div className="voice-clone-panel" style={{
          marginTop: 12,
          marginBottom: 12,
          padding: "10px 14px",
          borderRadius: 8,
          background: "rgba(255, 255, 255, 0.03)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
        }}>
          <div
            onClick={() => setIsClonePanelOpen((prev) => !prev)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.9rem", fontWeight: 600 }}>
              <Mic size={16} color="#00f2fe" />
              <span>聲音克隆 (Voice Cloning)</span>
              {refAudioFile ? (
                <span style={{ fontSize: "0.75rem", background: "rgba(0, 242, 254, 0.15)", color: "#00f2fe", padding: "2px 8px", borderRadius: 12, border: "1px solid rgba(0, 242, 254, 0.3)" }}>
                  已選用自訂聲音: {refAudioFile.name}
                </span>
              ) : (
                <span style={{ fontSize: "0.75rem", opacity: 0.6 }}>（可選：上傳 3–15 秒參考音訊克隆聲音）</span>
              )}
            </div>
            {isClonePanelOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>

          {(isClonePanelOpen || refAudioFile) && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              {!refAudioFile ? (
                <>
                  {/* Input Mode Selector Tabs */}
                  <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                    <button
                      type="button"
                      onClick={() => setCloneInputMode("upload")}
                      style={{
                        flex: 1,
                        padding: "6px 12px",
                        borderRadius: 6,
                        fontSize: "0.8rem",
                        fontWeight: 600,
                        cursor: "pointer",
                        border: cloneInputMode === "upload" ? "1px solid #00f2fe" : "1px solid rgba(255, 255, 255, 0.12)",
                        background: cloneInputMode === "upload" ? "rgba(0, 242, 254, 0.15)" : "rgba(255, 255, 255, 0.04)",
                        color: cloneInputMode === "upload" ? "#00f2fe" : "#ccc",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        transition: "all 0.15s ease",
                      }}
                    >
                      <Upload size={14} /> 上傳檔案 (Upload File)
                    </button>
                    <button
                      type="button"
                      onClick={() => setCloneInputMode("record")}
                      style={{
                        flex: 1,
                        padding: "6px 12px",
                        borderRadius: 6,
                        fontSize: "0.8rem",
                        fontWeight: 600,
                        cursor: "pointer",
                        border: cloneInputMode === "record" ? "1px solid #00f2fe" : "1px solid rgba(255, 255, 255, 0.12)",
                        background: cloneInputMode === "record" ? "rgba(0, 242, 254, 0.15)" : "rgba(255, 255, 255, 0.04)",
                        color: cloneInputMode === "record" ? "#00f2fe" : "#ccc",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        transition: "all 0.15s ease",
                      }}
                    >
                      <Mic size={14} /> 現場錄音 (Record Voice)
                    </button>
                  </div>

                  {cloneInputMode === "upload" ? (
                    <label style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "16px",
                      border: "2px dashed rgba(255, 255, 255, 0.15)",
                      borderRadius: 8,
                      cursor: "pointer",
                      background: "rgba(0, 0, 0, 0.2)",
                      transition: "all 0.2s ease",
                    }}>
                      <Upload size={20} color="#00f2fe" style={{ marginBottom: 6 }} />
                      <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>點擊上傳或拖拽參考音訊 (.wav, .mp3, .flac)</span>
                      <span style={{ fontSize: "0.75rem", opacity: 0.5, marginTop: 2 }}>建議長度 3–15 秒，檔案大小 ≤ 10MB</span>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".wav,.mp3,.flac,.ogg,audio/wav,audio/mpeg,audio/flac,audio/ogg"
                        onChange={handleRefAudioChange}
                        style={{ display: "none" }}
                      />
                    </label>
                  ) : (
                    <VoiceRecorder onRecordingComplete={handleRecordedAudioComplete} />
                  )}
                </>
              ) : (
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: "rgba(0, 242, 254, 0.08)",
                  border: "1px solid rgba(0, 242, 254, 0.2)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                    {refAudioUrl && (
                      <audio controls src={refAudioUrl} style={{ height: 32, maxWidth: 220 }} />
                    )}
                    <span style={{ fontSize: "0.85rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {refAudioFile.name} ({(refAudioFile.size / 1024).toFixed(1)} KB)
                    </span>
                  </div>
                  <button
                    onClick={handleClearRefAudio}
                    style={{
                      background: "rgba(255, 255, 255, 0.1)",
                      border: "none",
                      color: "#fff",
                      borderRadius: 4,
                      padding: "4px 8px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: "0.8rem",
                    }}
                    title="移除參考音訊，恢復預設聲音"
                  >
                    <X size={14} /> 清除
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Generation Controls */}
        <div className="controls-row">
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

          <button
            className="synthesize-btn"
            onClick={handleSynthesize}
            disabled={isSynthesizing || !inputText.trim()}
            style={refAudioFile ? {
              background: "linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)",
              color: "#000",
              fontWeight: 700,
              boxShadow: "0 0 16px rgba(0, 242, 254, 0.4)",
            } : undefined}
          >
            {isSynthesizing ? (
              <>
                <RefreshCw size={18} className="spin-icon" /> {refAudioFile ? "克隆語音合成中..." : "合成中..."}
              </>
            ) : (
              <>
                <Sparkles size={18} /> {refAudioFile ? "🎙️ 克隆自訂語音 (Synthesize Clone)" : "生成語音 (Synthesize)"}
              </>
            )}
          </button>
        </div>

        {errorMessage && (
          <div className="error-banner">
            <AlertCircle size={16} /> {errorMessage}
          </div>
        )}
      </div>

      {/* Audio Player Card */}
      {audioUrl && (
        <div className="audio-card">
          <div className="card-header">
            <div className="card-title">
              <Music size={18} color="#00f2fe" /> 語音播放與下載
            </div>
            {latencyMs !== null && (
              <span className="latency-tag">耗時: {latencyMs} ms</span>
            )}
          </div>

          <div className="audio-player-wrapper" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <audio
              ref={audioRef}
              controls
              src={audioUrl}
              autoPlay
              className="native-audio"
              onLoadedMetadata={(e) => {
                // A fresh src resets the element's rate — re-apply both, and keep
                // preservesPitch off so the preview matches the exported file.
                e.currentTarget.preservesPitch = false;
                e.currentTarget.playbackRate = playbackSpeed;
              }}
            />

            {/* Speed Control Selector */}
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 12px",
              borderRadius: 6,
              background: "rgba(255, 255, 255, 0.03)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", fontWeight: 500 }}>
                <Gauge size={16} color="#00f2fe" /> 播放速度 (Speed)：
                <span style={{ fontSize: "0.7rem", opacity: 0.5, fontWeight: 400 }}>
                  （非 1x 會同時改變音調，下載檔案同試聽一致）
                </span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {[0.75, 1.0, 1.25, 1.5, 2.0].map((rate) => (
                  <button
                    key={rate}
                    onClick={() => handleSpeedSelect(rate)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 4,
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      cursor: "pointer",
                      border: rate === playbackSpeed ? "1px solid #00f2fe" : "1px solid rgba(255, 255, 255, 0.15)",
                      background: rate === playbackSpeed ? "rgba(0, 242, 254, 0.2)" : "rgba(255, 255, 255, 0.05)",
                      color: rate === playbackSpeed ? "#00f2fe" : "#ccc",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            </div>

            {/* Export — WAV only. An "MP3" button used to sit here, but it merely
                relabelled the WAV bytes as audio/mp3 without ever encoding MP3;
                shipping a real encoder (lamejs) is not worth a dependency for a
                few seconds of speech. */}
            <button
              onClick={handleExportDownload}
              disabled={isExporting}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "10px 14px",
                borderRadius: 6,
                background: "linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)",
                color: "#000",
                fontWeight: 600,
                fontSize: "0.85rem",
                border: "none",
                cursor: isExporting ? "not-allowed" : "pointer",
                opacity: isExporting ? 0.7 : 1,
              }}
            >
              {isExporting ? <RefreshCw size={16} className="spin-icon" /> : <Download size={16} />}
              下載 WAV (無損 PCM{playbackSpeed !== 1.0 ? `，${playbackSpeed}x` : ""})
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
