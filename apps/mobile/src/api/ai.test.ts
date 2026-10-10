import type { AiStatusResponse } from "@mimt/shared";
import { describe, expect, it } from "vitest";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import { AI_CONSENT_VERSION, aiErrorKey, aiFailure, aiUi, makeAiApi, makeBusinessApi, spamKey, type Requester } from "./ai";
import { ApiClientError, errorKeyFor } from "./errors";

/** Records calls and answers with `reply`. */
function fakeRequest(reply: unknown = {}) {
  const calls: Array<{ method: string; path: string; opts?: { body?: unknown; query?: Record<string, string | undefined> } }> = [];
  const request: Requester = async <T,>(method: string, path: string, opts?: { body?: unknown }) => {
    calls.push({ method, path, opts });
    return reply as T;
  };
  return { request, calls };
}

const apiError = (status: number, code: string | null) => new ApiClientError(status, code, errorKeyFor(status, code), "x");

describe("AI API client", () => {
  it("calls the documented routes", async () => {
    const { request, calls } = fakeRequest();
    const ai = makeAiApi(request);
    await ai.status();
    await ai.summarizeVoicemail("vm 1");
    await ai.suggestions("+15145550123");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /v1/ai/status",
      "POST /v1/voicemails/vm%201/summary",
      "GET /v1/conversations/%2B15145550123/suggestions",
    ]);
  });

  it("records the separate Law 25 consent kind ai_processing, grant and withdrawal", async () => {
    const { request, calls } = fakeRequest();
    const ai = makeAiApi(request);
    await ai.setConsent(true);
    await ai.setConsent(false);
    expect(calls[0]).toEqual({
      method: "POST",
      path: "/v1/consents",
      opts: { body: { kind: "ai_processing", granted: true, version: AI_CONSENT_VERSION, source: "mobile" } },
    });
    expect((calls[1]!.opts!.body as { granted: boolean }).granted).toBe(false);
  });
});

describe("Business API client", () => {
  it("lists businesses and extensions, and claims invites", async () => {
    const { request, calls } = fakeRequest();
    const biz = makeBusinessApi(request);
    await biz.list();
    await biz.extensions("b/1");
    await biz.claimInvites();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /v1/business",
      "GET /v1/business/b%2F1/extensions",
      "POST /v1/business/invites/claim",
    ]);
  });
});

describe("AI error handling", () => {
  it("maps 503 / 403 / 429 to clear French messages", () => {
    expect(aiErrorKey(apiError(503, "not_configured"))).toBe("ai.error.notConfigured");
    expect(aiErrorKey(apiError(403, "ai_consent_required"))).toBe("ai.error.consentRequired");
    expect(aiErrorKey(apiError(429, "ai_budget_exhausted"))).toBe("ai.error.budgetExhausted");
    expect(aiErrorKey(apiError(422, "ai_unavailable"))).toBe("ai.error.unavailable");
    expect(aiErrorKey(apiError(409, "no_transcript"))).toBe("ai.error.noTranscript");
    expect(aiErrorKey(apiError(403, "plan_required"))).toBe("ai.error.planRequired");
    expect(fr["ai.error.notConfigured"]).toMatch(/pas offertes/);
    expect(fr["ai.error.consentRequired"]).toMatch(/Activez le traitement par l'IA/);
    expect(fr["ai.error.budgetExhausted"]).toMatch(/budget IA de ce mois est épuisé/);
    expect(en["ai.error.budgetExhausted"]).toBeTruthy();
  });

  it("falls back to the generic mapping for other errors", () => {
    expect(aiErrorKey(apiError(503, null))).toBe("ai.error.notConfigured");
    expect(aiErrorKey(apiError(401, "unauthorized"))).toBe("error.session");
    expect(aiErrorKey(apiError(429, "rate_limited"))).toBe("error.rateLimited");
    expect(aiErrorKey(new Error("boom"))).toBe("error.generic");
    // The generic mapping used by non-AI screens is unchanged.
    expect(errorKeyFor(503, "not_configured")).toBe("error.server");
  });

  it("decides what the screen does after a failure", () => {
    expect(aiFailure(apiError(503, "not_configured"))).toBe("hide");
    expect(aiFailure(apiError(403, "ai_consent_required"))).toBe("needs_consent");
    expect(aiFailure(apiError(429, "ai_budget_exhausted"))).toBe("message");
    expect(aiFailure(new Error("network"))).toBe("message");
  });
});

describe("aiUi (GET /v1/ai/status → what to show)", () => {
  const base: AiStatusResponse = { configured: true, consent: true, plan: "premium", monthlyBudgetCadCents: 200, usedCadCents: 10, period: "2026-10" };

  it("hides every AI control when the server is not configured or the status is unknown", () => {
    expect(aiUi({ ...base, configured: false }).visible).toBe(false);
    expect(aiUi(null).visible).toBe(false);
    expect(aiUi(undefined).usable).toBe(false);
  });

  it("is usable with consent and budget", () => {
    expect(aiUi(base)).toEqual({ visible: true, usable: true, needsConsent: false, planHasAi: true, budgetExhausted: false });
  });

  it("asks for consent before anything is sent", () => {
    const ui = aiUi({ ...base, consent: false });
    expect(ui.usable).toBe(false);
    expect(ui.needsConsent).toBe(true);
  });

  it("stops when the monthly budget is used up, and hides for plans without AI", () => {
    expect(aiUi({ ...base, usedCadCents: 200 })).toMatchObject({ usable: false, budgetExhausted: true });
    expect(aiUi({ ...base, plan: "free", monthlyBudgetCadCents: 0, usedCadCents: 0 })).toMatchObject({ visible: false, planHasAi: false });
  });
});

describe("spam labels", () => {
  it("shows « Spam probable » and never a label for ok", () => {
    expect(fr[spamKey("spam")!]).toBe("Spam probable");
    expect(fr[spamKey("scam")!]).toBe("Fraude probable");
    expect(spamKey(undefined)).toBeNull();
    expect(spamKey(null)).toBeNull();
  });
});
