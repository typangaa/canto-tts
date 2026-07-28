// src/components/SettingsTab.tsx — Engine Settings & Status Component

import React, { useState, useEffect } from "react";
import { Settings, RefreshCw, CheckCircle2, AlertCircle, RotateCcw, Play, KeyRound, ExternalLink } from "lucide-react";
import type { HealthStatus } from "../api";
import { DEFAULT_ENGINE_URL, launchEngineServer, getHfToken, setHfToken } from "../api";
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
  const [hfToken, setHfTokenState] = useState<string>("");
  const [hfTokenSaved, setHfTokenSaved] = useState<string | null>(null);
  const [hfTokenSaving, setHfTokenSaving] = useState<boolean>(false);

  useEffect(() => {
    getHfToken().then(setHfTokenState);
  }, []);

  const handleOpenHfTokenPage = async () => {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl("https://huggingface.co/settings/tokens");
    } catch {
      // Web preview / no opener plugin available — user can copy the URL manually.
    }
  };

  const handleSaveHfToken = async () => {
    setHfTokenSaving(true);
    setHfTokenSaved(null);
    try {
      await setHfToken(hfToken);
      setHfTokenSaved(
        hfToken.trim()
          ? "已儲存。下次啟動 Engine 時生效 — 如引擎已在運行，請重新啟動。"
          : "已清除已儲存嘅 token。"
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setHfTokenSaved(`儲存失敗：${msg}`);
    } finally {
      setHfTokenSaving(false);
    }
  };

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

        {/* HuggingFace Hub Access Token */}
        <div className="setting-item" style={{ marginTop: 16 }}>
          <label className="setting-label">
            <KeyRound size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
            HuggingFace 個人 Access Token（選填，加快模型權重下載）：
          </label>
          <div className="input-with-button">
            <input
              type="password"
              value={hfToken}
              onChange={(e) => setHfTokenState(e.target.value)}
              placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="text-input"
            />
            <button
              className="synthesize-btn"
              style={{ padding: "8px 16px", fontSize: "0.82rem", marginLeft: 0 }}
              onClick={handleSaveHfToken}
              disabled={hfTokenSaving}
            >
              {hfTokenSaving ? <RefreshCw size={14} className="spin-icon" /> : <CheckCircle2 size={14} />}
              {hfTokenSaving ? "儲存中..." : "儲存"}
            </button>
            <button className="sample-btn" onClick={handleOpenHfTokenPage} title="開啟 huggingface.co/settings/tokens">
              <ExternalLink size={14} /> 免費申請 Token
            </button>
          </div>
          <small style={{ opacity: 0.75, fontSize: "0.78rem", marginTop: 4, display: "block" }}>
            首次啟動需下載約 730MB 模型權重。HuggingFace Hub 對「匿名（未登入）」請求有速度限制，經常需要排隊等候；
            填上免費 HF 帳戶嘅 Read token 之後，下載會用返你自己嘅配額，通常快好多。此設定純粹存喺你本機，唔會上傳去第三方。
          </small>
          {hfTokenSaved && (
            <div className="status-item success" style={{ marginTop: 8 }}>
              <CheckCircle2 size={16} /> <span>{hfTokenSaved}</span>
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
