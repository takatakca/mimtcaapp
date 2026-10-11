// Error messages for the AI features (docs/MIMT-AI.md §2). The API checks, in this order:
// 503 not_configured (no AI provider key on the server) → 403 ai_consent_required (Law 25) →
// 429 ai_budget_exhausted. Calls, texts and voicemail keep working in every case.
import { ApiClientError, toErrorKey } from "../api/errors";
import type { TKey } from "../i18n/core";

export function aiErrorKey(e: unknown): TKey {
  if (e instanceof ApiClientError) {
    if (e.status === 503 || e.code === "not_configured") return "ai.error.notConfigured";
    if (e.code === "plan_required" || e.code === "feature_required") return "ai.error.planRequired";
  }
  return toErrorKey(e);
}
