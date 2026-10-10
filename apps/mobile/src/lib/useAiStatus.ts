// Shared GET /v1/ai/status for every screen that shows AI controls. One request per app session
// (refreshed on demand), so screens can hide AI UI when the server has no AI configured.
import type { AiStatusResponse } from "@mimt/shared";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { aiUi, type AiUi } from "../api/ai";
import { aiApi } from "../api/features";

let status: AiStatusResponse | null = null;
let inflight: Promise<void> | null = null;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function refreshAiStatus(): Promise<void> {
  if (!inflight) {
    inflight = aiApi
      .status()
      .then((s) => {
        status = s;
      })
      .catch(() => {
        // Unknown: keep AI UI hidden rather than show controls that may fail.
        status = null;
      })
      .finally(() => {
        loaded = true;
        inflight = null;
        emit();
      });
  }
  return inflight;
}

/** Local update after the user changed consent, or after a 503 not_configured. */
export function patchAiStatus(patch: Partial<AiStatusResponse>): void {
  if (!status) return;
  status = { ...status, ...patch };
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const snapshot = () => status;

export function useAiStatus(): { status: AiStatusResponse | null; ui: AiUi; loaded: boolean; refresh: () => Promise<void> } {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (!loaded) void refreshAiStatus();
  }, []);
  const refresh = useCallback(() => refreshAiStatus(), []);
  return { status: current, ui: aiUi(current), loaded, refresh };
}
