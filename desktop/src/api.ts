// src/api.ts — canto-tts engine API client with X-Canto-Auth-Token IPC security support

export const DEFAULT_ENGINE_URL = "http://127.0.0.1:8000";

export interface HealthStatus {
  status: string;
  version: string;
  backend: string;
  model_loaded?: boolean;
  model_dir?: string | null;
}

export interface SynthesizeParams {
  text: string;
  quality: string | null;
  max_attempts: number;
  best_of_n: number;
  asr_backend: string;
}

export interface SynthesizeResult {
  audioBlob: Blob;
  phonemes: string;
  latencyMs: number;
  qualityMode: string;
}

function buildHeaders(authToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authToken) {
    headers["X-Canto-Auth-Token"] = authToken;
  }
  return headers;
}

export async function checkHealth(engineUrl = DEFAULT_ENGINE_URL): Promise<HealthStatus> {
  const res = await fetch(`${engineUrl}/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return await res.json();
}

export interface ModelVersionStatus {
  current_revision: string | null;
  latest_revision: string | null;
  update_available: boolean;
  error?: string;
}

export async function checkModelVersion(engineUrl = DEFAULT_ENGINE_URL): Promise<ModelVersionStatus> {
  const res = await fetch(`${engineUrl}/model-version`);
  if (!res.ok) throw new Error(`Model version check failed: ${res.status}`);
  return await res.json();
}

export async function phonemize(
  text: string,
  engineUrl = DEFAULT_ENGINE_URL,
  authToken?: string
): Promise<string> {
  if (!text.trim()) return "";
  const res = await fetch(`${engineUrl}/phonemize`, {
    method: "POST",
    headers: buildHeaders(authToken),
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error("Phonemize failed");
  const data = await res.json();
  return data.phonemes || "";
}

export async function synthesize(
  params: SynthesizeParams,
  engineUrl = DEFAULT_ENGINE_URL,
  authToken?: string
): Promise<SynthesizeResult> {
  const res = await fetch(`${engineUrl}/synthesize`, {
    method: "POST",
    headers: buildHeaders(authToken),
    body: JSON.stringify({
      text: params.text,
      quality: params.quality === "none" ? null : params.quality,
      max_attempts: params.max_attempts,
      best_of_n: params.best_of_n,
      asr_backend: params.asr_backend,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `Server error ${res.status}` }));
    throw new Error(err.detail || `Server returned ${res.status}`);
  }

  const audioBlob = await res.blob();

  let phonemes = "";
  const rawPhonemes = res.headers.get("X-Canto-Phonemes");
  if (rawPhonemes) {
    try {
      phonemes = decodeURIComponent(rawPhonemes);
    } catch {
      phonemes = rawPhonemes;
    }
  }

  const latencyMs = parseInt(res.headers.get("X-Canto-Latency-Ms") || "0", 10);
  const qualityMode = res.headers.get("X-Canto-Quality-Mode") || "none";

  return { audioBlob, phonemes, latencyMs, qualityMode };
}

export async function getHfToken(): Promise<string> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("get_hf_token");
  } catch {
    // Not running inside Tauri (e.g. web preview) — no token storage available.
    return "";
  }
}

export async function setHfToken(token: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_hf_token", { token });
}

export async function launchEngineServer(port: number = 8000): Promise<string> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("start_python_engine", { port });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Tauri invoke not available") || msg.includes("window.__TAURI__")) {
      throw new Error("網頁預覽環境中無 Tauri IPC 通訊，請於 Terminal 執行: .venv/bin/python3 -m canto_tts.api.app");
    }
    throw new Error(msg);
  }
}
