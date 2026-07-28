// src/components/SettingsTab.tsx — Engine Settings & Status Component

import React, { useState } from "react";
import { Settings, RefreshCw, CheckCircle2, AlertCircle, RotateCcw, Play } from "lucide-react";
import type { HealthStatus } from "../api";
import { DEFAULT_ENGINE_URL, launchEngineServer } from "../api";
import type { EngineState } from "../hooks/useEngine";

interface SettingsTabProps {
  engineUrl: string;
  setEngineUrl: (url: string) => void;
  engineState: EngineState;
  health: HealthStatus | null;
  onCheckHealth: () => void;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  engineUrl,
  setEngineUrl,
  engineState,
  health,
  onCheckHealth,
}) => {
  const [isSpinningUp, setIsSpinningUp] = useState<boolean>(false);
  const [spinError, setSpinError] = useState<string | null>(null);

  const handleStartEngine = async () => {
    setIsSpinningUp(true);
    setSpinError(null);
    try {
      await launchEngineServer(8000);
      setTimeout(() => {
        onCheckHealth();
        setIsSpinningUp(false);
      }, 1500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSpinError(msg);
      setIsSpinningUp(false);
    }
  };

  return (
    <div className="settings-layout">
      <div className="workbench-card">
        <div className="card-header">
          <div className="card-title">
            <Settings size={18} /> 廣東話 TTS 引擎與模型設定
          </div>
        </div>

        <div className="setting-item">
          <label className="setting-label">本地 Engine Server 地址：</label>
          <div className="input-with-button">
            <input
              type="text"
              value={engineUrl}
              onChange={(e) => setEngineUrl(e.target.value)}
              className="text-input"
            />
            <button
              className="synthesize-btn"
              style={{ padding: "8px 16px", fontSize: "0.82rem", marginLeft: 0 }}
              onClick={handleStartEngine}
              disabled={isSpinningUp || engineState === "connected"}
              title="執行 .venv/bin/python3 -m canto_tts.api.app"
            >
              {isSpinningUp ? (
                <RefreshCw size={14} className="spin-icon" />
              ) : (
                <Play size={14} />
              )}
              {isSpinningUp ? "啟動中..." : "啟動 Python Engine"}
            </button>
            <button className="sample-btn" onClick={onCheckHealth}>
              <RefreshCw size={14} /> 測試連線
            </button>
            <button
              className="sample-btn"
              onClick={() => setEngineUrl(DEFAULT_ENGINE_URL)}
              title="重設為預設地址 (http://127.0.0.1:8000)"
            >
              <RotateCcw size={14} /> 重設預設
            </button>
          </div>
        </div>

        {spinError && (
          <div className="error-banner" style={{ marginTop: 10 }}>
            <AlertCircle size={16} /> {spinError}
          </div>
        )}

        {/* Engine Status Banner */}
        <div className="status-banner-box">
          {engineState === "connected" && (
            <div className="status-item success">
              <CheckCircle2 size={18} />
              <div>
                <b>引擎連線成功</b> — Version: {health?.version || "0.1.0"} | Backend: {health?.backend || "onnx"}
              </div>
            </div>
          )}
          {engineState === "connecting" && (
            <div className="status-item warning">
              <RefreshCw size={18} className="spin-icon" />
              <div>
                <b>正在與本地引擎通訊...</b> （按上方「啟動 Python Engine」或於 CLI 執行 <code>.venv/bin/python3 -m canto_tts.api.app</code>）
              </div>
            </div>
          )}
          {engineState === "disconnected" && (
            <div className="status-item danger">
              <AlertCircle size={18} />
              <div>
                <b>未偵測到本地引擎連線</b> — 按上方「啟動 Python Engine」按鈕開啟背景服務
              </div>
            </div>
          )}
        </div>

        {/* System & Hardware Specs */}
        <div className="info-grid">
          <div className="info-box">
            <span className="box-title">模型架構</span>
            <span className="box-value">MOSS-TTS-Nano (0.1B GPT-2)</span>
          </div>
          <div className="info-box">
            <span className="box-title">語音採樣率</span>
            <span className="box-value">48,000 Hz (Stereo WAV)</span>
          </div>
          <div className="info-box">
            <span className="box-title">Inference Runtime</span>
            <span className="box-value">ONNX Runtime (CPU-first)</span>
          </div>
          <div className="info-box">
            <span className="box-title">G2P Engine</span>
            <span className="box-value">canto-hk-g2p (Jyutping)</span>
          </div>
        </div>

        <div className="hardware-notice">
          <CheckCircle2 size={16} color="#00ff88" />
          <span>
            <b>硬體保護：</b> 系統已被鎖定為 <b>CPU ONNX 模式</b>，絕對不會調用或佔用 NVIDIA GPU 資源。
          </span>
        </div>
      </div>
    </div>
  );
};
