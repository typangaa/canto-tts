// src/components/StudioTab.tsx — Single Text Synthesis Studio Tab

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  FileText,
  Sparkles,
  RefreshCw,
  Music,
  Download,
  AlertCircle,
} from "lucide-react";
import { synthesize, phonemize, type SynthesizeParams } from "../api";

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

  // Ref to hold previous blob URL for proper revocation
  const prevAudioUrlRef = useRef<string | null>(null);

  // Clean up blob URL on unmount
  useEffect(() => {
    return () => {
      if (prevAudioUrlRef.current) {
        URL.revokeObjectURL(prevAudioUrlRef.current);
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

    const params: SynthesizeParams = {
      text: inputText.trim(),
      quality: qualityMode,
      max_attempts: maxAttempts,
      best_of_n: bestOfN,
      asr_backend: asrBackend,
    };

    try {
      const result = await synthesize(params, engineUrl);

      // Clean up previous blob URL to prevent browser memory leaks
      if (prevAudioUrlRef.current) {
        URL.revokeObjectURL(prevAudioUrlRef.current);
      }

      const newUrl = URL.createObjectURL(result.audioBlob);
      prevAudioUrlRef.current = newUrl;
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
  }, [inputText, qualityMode, maxAttempts, bestOfN, asrBackend, engineUrl]);

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
          >
            {isSynthesizing ? (
              <>
                <RefreshCw size={18} className="spin-icon" /> 合成中...
              </>
            ) : (
              <>
                <Sparkles size={18} /> 生成語音 (Synthesize)
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

          <div className="audio-player-wrapper">
            <audio controls src={audioUrl} autoPlay className="native-audio" />

            <a
              href={audioUrl}
              download={`canto_tts_${Date.now()}.wav`}
              className="download-btn"
            >
              <Download size={16} /> 下載 WAV 音檔
            </a>
          </div>
        </div>
      )}
    </div>
  );
};
