import React, { useState, useMemo, useEffect, useRef } from "react";
import { AlertCircle, RefreshCw, Terminal, Check, Copy, Play, CheckCircle2, XCircle, X } from "lucide-react";
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
  const [launchResult, setLaunchResult] = useState<{ success: boolean; message: string } | null>(null);
  // Accumulated (not overwritten) — a single "latest line" silently discards whatever crash
  // traceback or download progress printed right before it, which is exactly what made this
  // hard to diagnose. Capped so a crash-looping process can't grow this unboundedly.
  const [engineLogs, setEngineLogs] = useState<string[]>([]);
  const unlistenRef = useRef<(() => void) | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const MAX_LOG_LINES = 300;

  // Sidecar stdout/stderr (incl. HuggingFace Hub's first-run download progress) is forwarded
  // from Rust via the "engine-log" event. Not available outside a Tauri window (e.g. web
  // preview / `vite dev`), so this is best-effort and silently no-ops there.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const unlisten = await listen<string>("engine-log", (event) => {
          setEngineLogs((prev) => {
            const next = [...prev, event.payload];
            return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
          });
        });
        if (cancelled) {
          unlisten();
        } else {
          unlistenRef.current = unlisten;
        }
      } catch {
        // Not running inside Tauri — no engine-log events available.
      }
    })();
    return () => {
      cancelled = true;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [engineLogs]);

  const engineCrashed = engineLogs.some((line) => line.includes("sidecar terminated"));

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
    setLaunchResult(null);
    setEngineLogs([]);
    try {
      const msg = await launchEngineServer(8000);
      setLaunchResult({
        success: true,
        message: msg || "已成功送出啟動請求，正在初始化引擎與下載模型權重..."
      });
      setTimeout(() => {
        onRetry();
        setIsSpinningUp(false);
      }, 2500);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setLaunchResult({
        success: false,
        message: errorMsg
      });
      setIsSpinningUp(false);
    }
  };

  return (
    <div className="engine-banner-wrapper" style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
      {/* Launch Status Feedback Box */}
      {launchResult && (
        <div
          className={`launch-message-box ${launchResult.success ? "success" : "error"}`}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 14px",
            borderRadius: "8px",
            background: launchResult.success ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
            border: `1px solid ${launchResult.success ? "#10b981" : "#ef4444"}`,
            color: launchResult.success ? "#34d399" : "#f87171",
            fontSize: "0.88rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {launchResult.success ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
            <span>{launchResult.message}</span>
          </div>
          <button
            onClick={() => setLaunchResult(null)}
            style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 2 }}
            title="關閉訊息"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Main Connection Banner */}
      <div className={`engine-banner ${engineState}`}>
        <div className="banner-content">
          <div className="banner-title-row">
            {engineState === "connecting" ? (
              <>
                {engineCrashed ? (
                  <AlertCircle size={18} className="banner-icon danger" />
                ) : (
                  <RefreshCw size={18} className="spin-icon banner-icon" />
                )}
                <span>
                  {engineCrashed ? (
                    <b>本地引擎程序已終止 — 請撳下面「啟動 Engine」再試一次</b>
                  ) : (
                    <>
                      <b>正在與本地 TTS 引擎通訊中...</b> ({engineUrl})
                      <br />
                      <small style={{ opacity: 0.85, fontSize: "0.8rem", marginTop: 2, display: "block" }}>
                        ℹ️ 若為首次執行，系統將自動從 HuggingFace (typangaa/canto-tts-nano) 下載模型權重，請稍候。
                      </small>
                    </>
                  )}
                  {engineLogs.length > 0 && (
                    <pre
                      style={{
                        display: "block",
                        marginTop: 4,
                        maxHeight: 140,
                        overflowY: "auto",
                        fontSize: "0.75rem",
                        opacity: 0.8,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        background: "rgba(0, 0, 0, 0.2)",
                        borderRadius: 6,
                        padding: "6px 8px",
                        margin: 0,
                      }}
                    >
                      {engineLogs.map((line, i) => (
                        <div
                          key={i}
                          style={
                            line.includes("sidecar terminated") || line.includes("[error]")
                              ? { color: "#f87171" }
                              : undefined
                          }
                        >
                          {line}
                        </div>
                      ))}
                      <div ref={logEndRef} />
                    </pre>
                  )}
                </span>
              </>
            ) : (
              <>
                <AlertCircle size={18} className="banner-icon danger" />
                <span>
                  <b>未連線至語音引擎</b> — 請點擊「啟動 Engine」自動啟動服務（首次執行將自動下載模型權重）
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
    </div>
  );
};
