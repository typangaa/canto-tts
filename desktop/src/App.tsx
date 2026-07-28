// src/App.tsx — CantoTTS Desktop App Main Orchestrator

import { useState, useEffect } from "react";
import { Header } from "./components/Header";
import { EngineBanner } from "./components/EngineBanner";
import { StudioTab } from "./components/StudioTab";
import { BatchTab } from "./components/BatchTab";
import { SettingsTab } from "./components/SettingsTab";
import { useEngine } from "./hooks/useEngine";
import { DEFAULT_ENGINE_URL } from "./api";
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
