// src/hooks/useEngine.ts — Adaptive Engine connection manager hook

import { useState, useEffect, useCallback, useRef } from "react";
import { checkHealth, type HealthStatus } from "../api";

export type EngineState = "connecting" | "connected" | "disconnected";

const FAST_POLL_INTERVAL_MS = 1000;
const NORMAL_POLL_INTERVAL_MS = 4000;
// Unhealthy polls retry at FAST_POLL_INTERVAL_MS (1s), so this is ~10 min before giving up.
// Needs to comfortably outlast a first-run model weight download over a slow connection —
// the listen port isn't even bound until that download + model load finishes (see
// desktop/src-tauri/src/lib.rs spawn_sidecar), so every poll fails until then regardless of
// download progress.
const MAX_RETRIES = 600;

export function useEngine(engineUrl: string) {
  const [state, setState] = useState<EngineState>("connecting");
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const retriesRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const scheduleNextRef = useRef<(() => void) | null>(null);
  const isPollingRef = useRef(false);

  const poll = useCallback(async (): Promise<boolean> => {
    setIsRetrying(true);
    try {
      const h = await checkHealth(engineUrl);
      if (isMountedRef.current) {
        setHealth(h);
        setState("connected");
      }
      retriesRef.current = 0;
      return true;
    } catch {
      if (isMountedRef.current) {
        setHealth(null);
        retriesRef.current += 1;
        setState(retriesRef.current > MAX_RETRIES ? "disconnected" : "connecting");
      }
      return false;
    } finally {
      if (isMountedRef.current) {
        setIsRetrying(false);
      }
    }
  }, [engineUrl]);

  useEffect(() => {
    isMountedRef.current = true;
    let active = true;
    retriesRef.current = 0;
    setState("connecting");

    const scheduleNext = async () => {
      if (!active || isPollingRef.current) return;

      isPollingRef.current = true;
      try {
        const isHealthy = await poll();
        if (!active) return;

        // 1000ms fast polling when starting, connecting, or unhealthy/disconnected.
        // 4000ms background checks when healthy and connected.
        const delay = isHealthy ? NORMAL_POLL_INTERVAL_MS : FAST_POLL_INTERVAL_MS;
        timerRef.current = setTimeout(scheduleNext, delay);
      } finally {
        isPollingRef.current = false;
      }
    };

    scheduleNextRef.current = scheduleNext;
    scheduleNext();

    return () => {
      active = false;
      isMountedRef.current = false;
      isPollingRef.current = false;
      scheduleNextRef.current = null;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [engineUrl, poll]);

  const retry = useCallback(() => {
    if (isPollingRef.current) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (scheduleNextRef.current) {
      scheduleNextRef.current();
    } else {
      poll();
    }
  }, [poll]);

  return { state, health, isRetrying, retry };
}
