// src/components/Header.tsx — Application Header Component

import React from "react";
import { Volume2, Sparkles, Layers, Settings, Cpu } from "lucide-react";
import type { EngineState } from "../hooks/useEngine";
import type { HealthStatus } from "../api";

interface HeaderProps {
  activeTab: "studio" | "batch" | "settings";
  setActiveTab: (tab: "studio" | "batch" | "settings") => void;
  engineState: EngineState;
  health: HealthStatus | null;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  engineState,
  health,
}) => {
  const modelLoaded = health?.model_loaded !== false;

  return (
    <header className="app-header">
      <div className="brand">
        <div className="brand-logo">
          <Volume2 size={24} color="#00f2fe" />
        </div>
        <div>
          <h1 className="brand-title">CantoTTS 廣東話語音合成</h1>
          <span className="brand-badge">Desktop App (CPU ONNX)</span>
        </div>
      </div>

      <nav className="nav-tabs">
        <button
          className={`tab-btn ${activeTab === "studio" ? "active" : ""}`}
          onClick={() => setActiveTab("studio")}
        >
          <Sparkles size={16} /> TTS Studio
        </button>
        <button
          className={`tab-btn ${activeTab === "batch" ? "active" : ""}`}
          onClick={() => setActiveTab("batch")}
        >
          <Layers size={16} /> 檔案批處理
        </button>
        <button
          className={`tab-btn ${activeTab === "settings" ? "active" : ""}`}
          onClick={() => setActiveTab("settings")}
        >
          <Settings size={16} /> 引擎設定
        </button>
      </nav>

      <div className="status-badge">
        <Cpu size={14} className="icon-cpu" />
        <span className="cpu-label">CPU ONNX Engine</span>
        {engineState === "connecting" ? (
          <span className="status-dot yellow" title="連線中 / 啟動中..." />
        ) : engineState === "connected" && modelLoaded ? (
          <span className="status-dot green" title="引擎運作正常 (ONNX 已載入)" />
        ) : engineState === "connected" && !modelLoaded ? (
          <span className="status-dot yellow" title="引擎連線成功，等待下載模型權重" />
        ) : (
          <span className="status-dot red" title="無法連線至本地引擎" />
        )}
      </div>
    </header>
  );
};
