// src/hooks/useEngine.ts — Adaptive Engine connection manager hook

import { useState, useEffect, useCallback, useRef } from "react";
import { checkHealth, type HealthStatus } from "../api";

export type EngineState = "connecting" | "connected" | "disconnected";

const FAST_POLL_INTERVAL_MS = 1000;
const NORMAL_POLL_INTERVAL_MS = 4000;
const MAX_RETRIES = 60; // 4 min of retry polling

export function useEngine(engineUrl: string) {
  const [state, setState] = useState<EngineState>("connecting");
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const retriesRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const scheduleNextRef = useRef<(() => void) | null>(null);

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
      if (!active) return;

      const isHealthy = await poll();
      if (!active) return;

      // 1000ms fast polling when starting, connecting, or unhealthy/disconnected.
      // 4000ms background checks when healthy and connected.
      const delay = isHealthy ? NORMAL_POLL_INTERVAL_MS : FAST_POLL_INTERVAL_MS;
      timerRef.current = setTimeout(scheduleNext, delay);
    };

    scheduleNextRef.current = scheduleNext;
    scheduleNext();

    return () => {
      active = false;
      isMountedRef.current = false;
      scheduleNextRef.current = null;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [engineUrl, poll]);

  const retry = useCallback(() => {
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
