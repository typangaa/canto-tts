// src/App.tsx — CantoTTS Desktop App Main Orchestrator

import { useState, useEffect, useRef } from "react";
import { Sparkles, X, DownloadCloud, RefreshCw } from "lucide-react";
import { Header } from "./components/Header";
import { EngineBanner } from "./components/EngineBanner";
import { StudioTab } from "./components/StudioTab";
import { BatchTab } from "./components/BatchTab";
import { SettingsTab } from "./components/SettingsTab";
import { useEngine } from "./hooks/useEngine";
import { DEFAULT_ENGINE_URL, checkModelVersion } from "./api";
import type { Update } from "@tauri-apps/plugin-updater";
import "./App.css";

const STORAGE_KEY_ENGINE_URL = "canto_tts_engine_url";
const STORAGE_KEY_ACTIVE_TAB = "canto_tts_active_tab";

export function App() {
  const [activeTab, setActiveTab] = useState<"studio" | "batch" | "settings">(() => {
    const saved = localStorage.getItem(STORAGE_KEY_ACTIVE_TAB);
    if (saved === "studio" || saved === "batch" || saved === "settings") {
      return saved;
    }
    return "studio";
  });
  const [engineUrl, setEngineUrlState] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY_ENGINE_URL) || DEFAULT_ENGINE_URL;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_ACTIVE_TAB, activeTab);
  }, [activeTab]);

  const { state: engineState, health, isRetrying, retry: checkEngineHealth } = useEngine(engineUrl);

  const setEngineUrl = (newUrl: string) => {
    setEngineUrlState(newUrl);
    localStorage.setItem(STORAGE_KEY_ENGINE_URL, newUrl);
  };

  // Lightweight (metadata-only, no download) check once per connect for a newer model-weight
  // revision on HuggingFace Hub — the actual delta-download happens automatically next time the
  // sidecar starts, this is purely an informational heads-up.
  const [modelUpdateAvailable, setModelUpdateAvailable] = useState(false);
  useEffect(() => {
    if (engineState !== "connected") return;
    let cancelled = false;
    checkModelVersion(engineUrl)
      .then((status) => {
        if (!cancelled && status.update_available) setModelUpdateAvailable(true);
      })
      .catch(() => {
        // Best-effort only — offline or engine doesn't support this endpoint yet.
      });
    return () => {
      cancelled = true;
    };
  }, [engineState, engineUrl]);

  // App-binary self-update check (tauri-plugin-updater) — runs once on mount, independent of
  // the engine/model checks above. Best-effort: silently no-ops in web preview or if offline.
  const appUpdateRef = useRef<Update | null>(null);
  const [appUpdateInfo, setAppUpdateInfo] = useState<{ version: string } | null>(null);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (update) {
          appUpdateRef.current = update;
          setAppUpdateInfo({ version: update.version });
        }
      } catch {
        // Not running inside Tauri, or the check itself failed — silently ignore.
      }
    })();
  }, []);

  const handleInstallAppUpdate = async () => {
    if (!appUpdateRef.current) return;
    setIsInstallingUpdate(true);
    setUpdateError(null);
    try {
      await appUpdateRef.current.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err: unknown) {
      setIsInstallingUpdate(false);
      setUpdateError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="app-container">
      {/* Chrome Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        engineState={engineState}
        health={health}
      />

      {/* App Body View Routing */}
      <main className="app-body">
        {appUpdateInfo && (
          <div
            className="app-update-banner"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              borderRadius: "8px",
              background: "rgba(16, 185, 129, 0.15)",
              border: "1px solid #10b981",
              color: "#34d399",
              fontSize: "0.85rem",
              marginBottom: 10,
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <DownloadCloud size={16} />
              <span>
                有新版本 CantoTTS Desktop（v{appUpdateInfo.version}）可用
                {updateError && <> — 更新失敗：{updateError}</>}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={handleInstallAppUpdate}
                disabled={isInstallingUpdate}
                style={{
                  background: "linear-gradient(135deg, #10b981, #34d399)",
                  color: "#0f172a",
                  border: "none",
                  borderRadius: 6,
                  padding: "6px 12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {isInstallingUpdate ? <RefreshCw size={14} className="spin-icon" /> : <DownloadCloud size={14} />}
                {isInstallingUpdate ? "更新中..." : "立即更新並重啟"}
              </button>
              <button
                onClick={() => setAppUpdateInfo(null)}
                style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 2 }}
                title="關閉訊息"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {modelUpdateAvailable && (
          <div
            className="model-update-banner"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              borderRadius: "8px",
              background: "rgba(79, 172, 254, 0.15)",
              border: "1px solid #4facfe",
              color: "#4facfe",
              fontSize: "0.85rem",
              marginBottom: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={16} />
              <span>偵測到新版本語音模型權重 — 下次啟動 Engine 時會自動下載更新（只下載有變動嘅檔案）。</span>
            </div>
            <button
              onClick={() => setModelUpdateAvailable(false)}
              style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 2 }}
              title="關閉訊息"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Inline Engine Notice Banner */}
        <EngineBanner
          engineState={engineState}
          engineUrl={engineUrl}
          onRetry={checkEngineHealth}
          isRetrying={isRetrying}
        />

        {activeTab === "studio" && <StudioTab engineUrl={engineUrl} />}

        {activeTab === "batch" && <BatchTab engineUrl={engineUrl} />}

        {activeTab === "settings" && (
          <SettingsTab
            engineUrl={engineUrl}
            setEngineUrl={setEngineUrl}
            engineState={engineState}
            health={health}
            onCheckHealth={checkEngineHealth}
          />
        )}
      </main>
    </div>
  );
}

export default App;
