// src/components/EngineBanner.tsx — Inline Engine Status & Startup Instructions Banner

import React, { useState, useMemo } from "react";
import { AlertCircle, RefreshCw, Terminal, Check, Copy, Play } from "lucide-react";
import type { EngineState } from "../hooks/useEngine";
import { launchEngineServer } from "../api";

interface EngineBannerProps {
  engineState: EngineState;
  engineUrl: string;
  onRetry: () => void;
  isRetrying?: boolean;
}

export const EngineBanner: React.FC<EngineBannerProps> = ({
  engineState,
  engineUrl,
  onRetry,
  isRetrying = false,
}) => {
  const [copied, setCopied] = useState(false);
  const [isSpinningUp, setIsSpinningUp] = useState(false);

  const startupCmd = useMemo(() => {
    if (typeof window !== "undefined" && window.navigator) {
      const platform = (window.navigator.platform || "").toLowerCase();
      const userAgent = (window.navigator.userAgent || "").toLowerCase();
      if (platform.includes("win") || userAgent.includes("windows")) {
        return ".venv\\Scripts\\python.exe -m canto_tts.api.app";
      }
    }
    return ".venv/bin/python3 -m canto_tts.api.app";
  }, []);

  if (engineState === "connected") {
    return null;
  }

  const handleCopyCmd = () => {
    navigator.clipboard.writeText(startupCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStartEngine = async () => {
    setIsSpinningUp(true);
    try {
      await launchEngineServer(8000);
      setTimeout(() => {
        onRetry();
        setIsSpinningUp(false);
      }, 1500);
    } catch {
      setIsSpinningUp(false);
    }
  };

  return (
    <div className={`engine-banner ${engineState}`}>
      <div className="banner-content">
        <div className="banner-title-row">
          {engineState === "connecting" ? (
            <>
              <RefreshCw size={18} className="spin-icon banner-icon" />
              <span>
                <b>正在與本地 TTS 引擎通訊中...</b> ({engineUrl})
              </span>
            </>
          ) : (
            <>
              <AlertCircle size={18} className="banner-icon danger" />
              <span>
                <b>未連線至語音引擎</b> — 請點擊右側按鈕啟動，或於 Terminal 執行指令
              </span>
            </>
          )}
        </div>

        <div className="banner-cmd-row">
          <Terminal size={14} className="cmd-icon" />
          <code className="cmd-code">{startupCmd}</code>
          <button className="copy-cmd-btn" onClick={handleCopyCmd} title="複製啟動指令">
            {copied ? <Check size={14} color="#00ff88" /> : <Copy size={14} />}
            {copied ? "已複製" : "複製"}
          </button>
        </div>
      </div>

      <div className="banner-actions" style={{ gap: 8 }}>
        <button
          className="retry-banner-btn"
          style={{ background: "linear-gradient(135deg, #00f2fe, #4facfe)", color: "#0f172a", border: "none", fontWeight: 600 }}
          onClick={handleStartEngine}
          disabled={isSpinningUp}
          title={`執行 ${startupCmd}`}
        >
          {isSpinningUp ? <RefreshCw size={14} className="spin-icon" /> : <Play size={14} />}
          {isSpinningUp ? "啟動中..." : "啟動 Engine"}
        </button>

        <button
          className="retry-banner-btn"
          onClick={onRetry}
          disabled={isRetrying}
          title="立即重新測試連線"
        >
          <RefreshCw size={14} className={isRetrying ? "spin-icon" : ""} />
          {isRetrying ? "測試中..." : "測試連線"}
        </button>
      </div>
    </div>
  );
};
