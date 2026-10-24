// AI features with a fake gateway: no test ever calls the real Anthropic API.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_RECEPTIONIST_TERMS_VERSION, type PlanCode } from "@mimt/shared";
import type { AiGateway, ReceptionistStepInput, TokenUsage } from "../src/ai/gateway.js";
import { createAiServices, type AiServices } from "../src/ai/service.js";
import { scoreCall } from "../src/ai/spam.js";
import type { MemoryAiStore } from "../src/ai/store.js";
import { monthPeriod } from "../src/lib/time.js";
import { handleRelaySocket, parseHandoff, type RelaySocket } from "../src/routes/twilioAi.js";
import { summarizeBusinessCall } from "../src/ai/callSummary.js";
import { makeUser, setup, twilioPost, type Ctx } from "./helpers.js";
import { makeBusiness, subscribe } from "./pbxFixtures.js";

const NOW = new Date("2026-10-14T14:00:00Z");
const usage = (outputTokens = 50): TokenUsage => ({ model: "claude-opus-5-5", inputTokens: 400, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 });

function fakeGateway() {
  return {
    summarizeVoicemail: vi.fn<AiGateway["summarizeVoicemail"]>(async () => ({
      ok: true as const,
      value: { summary: "Marie veut déplacer son rendez-vous à jeudi.", callerIntent: "rendez-vous", urgency: "normal" as const, callbackSuggested: true, spamLikelihood: 0.05 },
      usage: usage(),
    })),
    suggestReplies: vi.fn<AiGateway["suggestReplies"]>(async () => ({
      ok: true as const,
      value: { language: "fr-CA", suggestions: ["Oui, jeudi me va.", "Je vous rappelle demain.", "Merci!"] },
      usage: usage(),
    })),
    classifySms: vi.fn<AiGateway["classifySms"]>(async () => ({ ok: true as const, value: { verdict: "scam" as const, reason: "fausse livraison" }, usage: usage() })),
    receptionistStep: vi.fn<AiGateway["receptionistStep"]>(),
    demoTurn: vi.fn<AiGateway["demoTurn"]>(async (input) => ({
      ok: true as const,
      value:
        input.messages.length === 0
          ? { reply: "Bonjour! Ici l'assistant IA du Casse-croûte Comète. Qu'est-ce que je vous sers?", done: false, ticket: null }
          : { reply: "Parfait, c'est noté. Bonne soirée!", done: true, ticket: { title: "Commande pour Alex", lines: ["1 poutine classique 11,50 $", "Total avant taxes : 11,50 $"] } },
      usage: usage(),
    })),
    summarizeCall: vi.fn<AiGateway["summarizeCall"]>(async () => ({
      ok: true as const,
      value: { summary: "Le client veut une soumission pour une thermopompe.", actionItems: ["Envoyer la soumission jeudi"] },
      usage: usage(),
    })),
    helpAnswer: vi.fn<AiGateway["helpAnswer"]>(async () => ({
      ok: true as const,
      value: { answer: "Essentiel coûte 12,99 $ par mois avant taxes.", needsHuman: false },
      usage: usage(),
    })),
  } satisfies AiGateway;
}

let ctx: Ctx;
let gw: ReturnType<typeof fakeGateway>;
let ai: AiServices;
const store = () => ai.store as MemoryAiStore;

async function withAi(gateway: AiGateway | null = gw) {
  ai = createAiServices({ config: ctx.deps.config, gateway, log: { error: (o, m) => console.error(m, o) } });
  ctx.deps.ai = ai;
}

beforeEach(async () => {
  ctx = await setup({ now: () => NOW });
  gw = fakeGateway();
  await withAi();
});
afterEach(() => ctx.app.close());

async function consent(token: string, granted = true) {
  const res = await ctx.app.inject({
    method: "POST",
    url: "/v1/consents",
    headers: { authorization: `Bearer ${token}` },
    payload: { kind: "ai_processing", granted, version: "2026-10" },
  });
  expect(res.statusCode).toBe(201);
}

async function premiumUser(plan: PlanCode = "premium") {
  const u = await makeUser(ctx, { number: "+15145550100" });
  await subscribe(ctx, u.account.id, plan, 1);
  return u;
}

async function inboundSms(to: string, from: string, body: string) {
  const res = await twilioPost(ctx, "/webhooks/twilio/sms/inbound", { MessageSid: `SM${Math.random().toString(16).slice(2)}`, From: from, To: to, Body: body });
  expect(res.statusCode).toBe(200);
  await ai.idle();
}

const suggestions = (auth: Record<string, string>, peer = "+14185550199") =>
  ctx.app.inject({ method: "GET", url: `/v1/conversations/${encodeURIComponent(peer)}/suggestions`, headers: auth });

describe("AI not configured", () => {
  it("answers 503 not_configured without ANTHROPIC_API_KEY (null gateway or no AI services)", async () => {
    const u = await premiumUser();
    await consent(u.token);
    for (const setAi of [() => withAi(null), async () => void (ctx.deps.ai = undefined)]) {
      await setAi();
      const res = await suggestions(u.auth);
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe("not_configured");
    }
    await withAi(null);
    const status = await ctx.app.inject({ method: "GET", url: "/v1/ai/status", headers: u.auth });
    expect(status.json()).toMatchObject({ configured: false, consent: true, plan: "premium", monthlyBudgetCadCents: 200 });
    expect(Object.values(gw).every((f) => f.mock.calls.length === 0)).toBe(true);
  });

  it("the default config keeps the model id and builds no gateway without a key", () => {
    expect(ctx.deps.config.ANTHROPIC_MODEL).toBe("claude-opus-5-5");
    expect(createAiServices({ config: ctx.deps.config }).gateway).toBeNull();
  });
});

describe("Law 25: the ai_processing consent", () => {
  it("without consent nothing is sent to the AI provider", async () => {
    const u = await premiumUser();
    await inboundSms("+15145550100", "+14185550199", "Votre colis attend: https://bit.ly/x1");
    const res = await suggestions(u.auth);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("ai_consent_required");

    // Voicemail transcript: stored, but no summary.
    const vm = await ctx.repo.createVoicemail({ telecomAccountId: u.account.id, phoneNumberId: u.number!.id, callSid: "CA1", recordingSid: "RE1", fromNumber: "+14185550199", audioUrl: null, durationS: 12 });
    await twilioPost(ctx, "/webhooks/twilio/voice/transcription", { RecordingSid: "RE1", TranscriptionStatus: "completed", TranscriptionText: "Bonjour, c'est Marie." });
    await ai.idle();
    const summary = await ctx.app.inject({ method: "POST", url: `/v1/voicemails/${vm.id}/summary`, headers: u.auth });
    expect(summary.statusCode).toBe(403);
    expect(summary.json().error).toBe("ai_consent_required");

    expect(gw.suggestReplies).not.toHaveBeenCalled();
    expect(gw.summarizeVoicemail).not.toHaveBeenCalled();
    expect(gw.classifySms).not.toHaveBeenCalled();
    expect(store().usage).toHaveLength(0);
  });

  it("a later withdrawal turns AI off again", async () => {
    const u = await premiumUser();
    await consent(u.token, true);
    await inboundSms("+15145550100", "+14185550199", "Salut, on se voit jeudi?");
    expect((await suggestions(u.auth)).statusCode).toBe(200);
    await consent(u.token, false);
    expect((await suggestions(u.auth)).statusCode).toBe(403);
    expect(gw.suggestReplies).toHaveBeenCalledTimes(1);
  });
});

describe("AI monthly budget", () => {
  it("stops AI when the plan's monthly cap is used up (calls and SMS keep working)", async () => {
    const u = await premiumUser();
    await consent(u.token);
    await inboundSms("+15145550100", "+14185550199", "Salut, on se voit jeudi?");
    // 2,00 $ premium budget = 2 000 000 micro-CAD.
    await ai.store.addUsage({
      telecomAccountId: u.account.id,
      period: monthPeriod(NOW),
      feature: "sms_suggestions",
      model: "claude-opus-5-5",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costMicroCad: 2_000_000,
    });
    const res = await suggestions(u.auth);
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe("ai_budget_exhausted");
    expect(gw.suggestReplies).not.toHaveBeenCalled();
    const status = (await ctx.app.inject({ method: "GET", url: "/v1/ai/status", headers: u.auth })).json();
    expect(status).toMatchObject({ configured: true, usedCadCents: 200, monthlyBudgetCadCents: 200, period: "2026-10" });
  });

  it("the free plan has no AI budget", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    await consent(u.token);
    await inboundSms("+15145550100", "+14185550199", "Salut");
    expect((await suggestions(u.auth)).statusCode).toBe(429);
    expect(gw.suggestReplies).not.toHaveBeenCalled();
  });
});

describe("AI happy paths (fake gateway)", () => {
  it("smart replies: recent messages oldest first, usage recorded, never sent", async () => {
    const u = await premiumUser();
    await consent(u.token);
    await inboundSms("+15145550100", "+14185550199", "Bonjour!");
    // created_at has millisecond precision (Postgres run): keep the second text strictly later.
    await new Promise((r) => setTimeout(r, 5));
    await inboundSms("+15145550100", "+14185550199", "On peut se voir jeudi?");
    const res = await suggestions(u.auth);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ language: "fr-CA", suggestions: ["Oui, jeudi me va.", "Je vous rappelle demain.", "Merci!"] });
    expect(gw.suggestReplies.mock.calls[0]![0].messages.map((m) => m.text)).toEqual(["Bonjour!", "On peut se voir jeudi?"]);
    expect(store().usage).toEqual([expect.objectContaining({ telecomAccountId: u.account.id, feature: "sms_suggestions", period: "2026-10" })]);
    expect(store().usage[0]!.costMicroCad).toBeGreaterThan(0);
    expect(ctx.twilio!.sendMessage).not.toHaveBeenCalled();
  });

  it("a model refusal returns no suggestions with a reason", async () => {
    const u = await premiumUser();
    await consent(u.token);
    await inboundSms("+15145550100", "+14185550199", "Bonjour!");
    gw.suggestReplies.mockResolvedValueOnce({ ok: false, reason: "refusal", usage: usage(0) });
    expect((await suggestions(u.auth)).json()).toEqual({ suggestions: [], language: "fr-CA", reason: "refused" });
  });

  it("voicemail: the transcript webhook produces a summary shown in the list", async () => {
    const u = await premiumUser();
    await consent(u.token);
    const vm = await ctx.repo.createVoicemail({ telecomAccountId: u.account.id, phoneNumberId: u.number!.id, callSid: "CA1", recordingSid: "RE1", fromNumber: "+14185550199", audioUrl: null, durationS: 12 });
    await twilioPost(ctx, "/webhooks/twilio/voice/transcription", { RecordingSid: "RE1", TranscriptionStatus: "completed", TranscriptionText: "Bonjour, c'est Marie, je voudrais déplacer mon rendez-vous." });
    await ai.idle();
    expect(gw.summarizeVoicemail).toHaveBeenCalledWith(expect.objectContaining({ locale: "fr-CA", callerNumber: "+14185550199" }));
    const list = (await ctx.app.inject({ method: "GET", url: "/v1/voicemails", headers: u.auth })).json().voicemails;
    expect(list[0]).toMatchObject({ id: vm.id, ai: { summary: "Marie veut déplacer son rendez-vous à jeudi.", urgency: "normal", locale: "fr-CA" } });
    expect(ctx.notifier.sent).toContainEqual([u.user.id, "voicemail_received", expect.objectContaining({ voicemailId: vm.id })]);

    // On demand (e.g. re-run): same checks, returns the voicemail with its summary.
    const again = await ctx.app.inject({ method: "POST", url: `/v1/voicemails/${vm.id}/summary`, headers: u.auth });
    expect(again.statusCode).toBe(200);
    expect(again.json().ai.callerIntent).toBe("rendez-vous");
    // Another user's voicemail: 404.
    const other = await makeUser(ctx);
    expect((await ctx.app.inject({ method: "POST", url: `/v1/voicemails/${vm.id}/summary`, headers: other.auth })).statusCode).toBe(404);
  });

  it("spam: an ambiguous SMS goes to Claude only with consent; the label shows in the thread", async () => {
    const u = await premiumUser();
    await consent(u.token);
    await inboundSms("+15145550100", "+14185550199", "Votre colis est en attente, confirmez ici: www.colis-ca.info");
    expect(gw.classifySms).toHaveBeenCalledTimes(1);
    const msgs = (await ctx.app.inject({ method: "GET", url: "/v1/conversations/%2B14185550199/messages", headers: u.auth })).json().messages;
    expect(msgs[0].spamLabel).toBe("scam");
    // An OTP code is never sent to the AI.
    await inboundSms("+15145550100", "+14185550188", "Votre code de vérification est 123456");
    expect(gw.classifySms).toHaveBeenCalledTimes(1);
  });

  it("spam: inbound calls get a local « Spam probable » label; emergency callbacks never do", async () => {
    const u = await premiumUser();
    await twilioPost(ctx, "/webhooks/twilio/voice/inbound", { CallSid: "CAspam", From: "+18765550123", To: "+15145550100", StirVerstat: "TN-Validation-Failed" });
    await twilioPost(ctx, "/webhooks/twilio/voice/inbound", { CallSid: "CAok", From: "+14185550199", To: "+15145550100", StirVerstat: "TN-Validation-Passed-A" });
    await ai.idle();
    const calls = (await ctx.app.inject({ method: "GET", url: "/v1/calls", headers: u.auth })).json().calls;
    expect(calls.find((c: { peer: string }) => c.peer === "+18765550123").spamLabel).toBe("scam");
    expect(calls.find((c: { peer: string }) => c.peer === "+14185550199").spamLabel).toBeUndefined();
    expect(scoreCall({ from: "911", velocityExceeded: true, emergencyWindow: false }).verdict).toBe("ok");
    expect(scoreCall({ from: "anonymous", stirVerstat: "TN-Validation-Failed", velocityExceeded: true, emergencyWindow: true }).verdict).toBe("ok");
    expect(gw.classifySms).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------------------- receptionist

describe("AI receptionist", () => {
  async function readyBusiness() {
    const fx = await makeBusiness(ctx);
    const b = `/v1/business/${fx.business.id}/ai-receptionist`;
    const put = await ctx.app.inject({
      method: "PUT",
      url: b,
      headers: fx.owner.auth,
      payload: {
        accept: true,
        enabled: true,
        languages: ["fr-CA", "en-US"],
        hoursText: "Lundi au vendredi, 9 h à 17 h",
        transferTargets: [{ key: "reception", label: "Réception", extension: fx.ext.id }],
      },
    });
    expect(put.statusCode).toBe(200);
    await ctx.repo.pbx.upsertDidRoute({ businessId: fx.business.id, phoneNumberId: fx.didNumber.id, e164: fx.didNumber.e164, target: { type: "ai_receptionist" } });
    return { ...fx, put: put.json() };
  }

  it("config: the owner accepts the terms; enabling without them is refused; members cannot administer", async () => {
    const fx = await makeBusiness(ctx);
    const b = `/v1/business/${fx.business.id}/ai-receptionist`;
    const def = (await ctx.app.inject({ method: "GET", url: b, headers: fx.owner.auth })).json();
    expect(def).toMatchObject({ enabled: false, languages: ["fr-CA"], acceptedAt: null, businessName: "Café Test" });
    const noTerms = await ctx.app.inject({ method: "PUT", url: b, headers: fx.owner.auth, payload: { enabled: true } });
    expect(noTerms.statusCode).toBe(409);
    expect(noTerms.json().error).toBe("terms_not_accepted");
    expect((await ctx.app.inject({ method: "PUT", url: b, headers: fx.owner.auth, payload: { languages: ["en-US"] } })).statusCode).toBe(400);
    expect((await ctx.app.inject({ method: "GET", url: b, headers: fx.staff.auth })).statusCode).toBe(403);
    const bad = await ctx.app.inject({ method: "PUT", url: b, headers: fx.owner.auth, payload: { transferTargets: [{ key: "x", label: "X", number: "+19005550100" }] } });
    expect(bad.json().error).toBe("external_number_not_allowed");
    const ok = await ctx.app.inject({ method: "PUT", url: b, headers: fx.owner.auth, payload: { accept: true, enabled: true } });
    expect(ok.json()).toMatchObject({ enabled: true, acceptedVersion: AI_RECEPTIONIST_TERMS_VERSION });
  });

  it("a call to the DID connects ConversationRelay with a per-call token (AI disclosure first, in French)", async () => {
    const fx = await readyBusiness();
    const res = await twilioPost(ctx, "/webhooks/twilio/voice/inbound", { CallSid: "CArecept1", From: "+14185550199", To: fx.didNumber.e164 });
    expect(res.body).toContain("/webhooks/twilio/ai/receptionist?b=");
    const path = /<Redirect[^>]*>([^<]+)<\/Redirect>/.exec(res.body)![1]!.replace(/&amp;/g, "&").replace("https://api.test.mimt.ca", "");
    const twiml = await twilioPost(ctx, path, { CallSid: "CArecept1", From: "+14185550199" });
    expect(twiml.body).toContain("<ConversationRelay");
    expect(twiml.body).toContain('url="wss://api.test.mimt.ca/ws/ai/receptionist"');
    expect(twiml.body).toContain("un agent d'intelligence artificielle");
    expect(twiml.body).toContain('name="token"');
    expect(twiml.body).toContain("/webhooks/twilio/ai/receptionist/handoff");
    expect(gw.receptionistStep).not.toHaveBeenCalled();
  });

  it("falls back to the business voicemail when AI is not configured or the budget is used up", async () => {
    const fx = await readyBusiness();
    const path = `/webhooks/twilio/ai/receptionist?b=${fx.business.id}&n=${fx.didNumber.id}`;
    await withAi(null);
    const noKey = await twilioPost(ctx, path, { CallSid: "CA2" });
    expect(noKey.body).toContain("<Record");
    expect(noKey.body).not.toContain("ConversationRelay");

    await withAi();
    await ai.store.addUsage({ telecomAccountId: fx.business.telecomAccountId, period: "2026-10", feature: "receptionist", model: "m", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroCad: 10_000_000 });
    const broke = await twilioPost(ctx, path, { CallSid: "CA3" });
    expect(broke.body).toContain("<Record");
  });

  function fakeSocket() {
    const sent: Array<Record<string, unknown>> = [];
    const handlers: Record<string, (d?: unknown) => void> = {};
    const socket: RelaySocket & { closed: number | null } = {
      closed: null,
      send: (d) => void sent.push(JSON.parse(d) as Record<string, unknown>),
      close: (code) => void (socket.closed = code ?? 1000),
      on: (event: string, cb: (d?: unknown) => void) => void (handlers[event] = cb),
    };
    return { socket, sent, emit: (msg: object) => handlers.message!(JSON.stringify(msg)), close: () => handlers.close!() };
  }
  const log = { warn: () => {}, error: () => {} };

  async function relayToken(businessId: string, callSid: string) {
    const res = await twilioPost(ctx, `/webhooks/twilio/ai/receptionist?b=${businessId}&n=x`, { CallSid: callSid });
    return /name="token" value="([^"]+)"/.exec(res.body)![1]!;
  }

  it("socket: a bad or missing token ends the session without calling the AI", async () => {
    const fx = await readyBusiness();
    const { socket, sent, emit } = fakeSocket();
    const h = handleRelaySocket(ctx.deps, socket, log);
    const other = await relayToken(fx.business.id, "CAother");
    emit({ type: "setup", callSid: "CAmine", from: "+14185550199", customParameters: { b: fx.business.id, token: other } });
    await h.idle();
    emit({ type: "prompt", voicePrompt: "Bonjour", last: true });
    expect(sent[0]).toMatchObject({ type: "end" });
    expect(parseHandoff(sent[0]!.handoffData as string)).toEqual({ action: "voicemail", reason: "unauthorized" });
    expect(socket.closed).toBe(1008);
    expect(gw.receptionistStep).not.toHaveBeenCalled();
  });

  it("socket → handoff: the receptionist transfers to the reception extension", async () => {
    const fx = await readyBusiness();
    gw.receptionistStep.mockImplementationOnce(async (_input: ReceptionistStepInput, onText) => {
      onText("Je vous transfère à la réception.");
      return {
        stopReason: "tool_use",
        content: [
          { type: "text", text: "Je vous transfère à la réception.", citations: null },
          { type: "tool_use", id: "toolu_1", name: "transfer_call", input: { target: "reception", reason: "veut parler à quelqu'un" } },
        ] as never,
        usage: usage(30),
      };
    });
    const { socket, sent, emit } = fakeSocket();
    const h = handleRelaySocket(ctx.deps, socket, log);
    const token = await relayToken(fx.business.id, "CArecept2");
    emit({ type: "setup", callSid: "CArecept2", from: "+14185550199", customParameters: { b: fx.business.id, token } });
    await h.idle();
    await h.session()!.handle(JSON.stringify({ type: "prompt", voicePrompt: "Je voudrais parler à quelqu'un.", last: true, lang: "fr-CA" }));

    expect(gw.receptionistStep).toHaveBeenCalledTimes(1);
    expect(sent).toContainEqual({ type: "text", token: "Je vous transfère à la réception.", last: false });
    const end = sent.find((m) => m.type === "end")!;
    const handoff = parseHandoff(end.handoffData as string);
    expect(handoff).toMatchObject({ action: "transfer", target: "reception" });
    expect(store().usage).toEqual([expect.objectContaining({ feature: "receptionist", telecomAccountId: fx.business.telecomAccountId })]);

    // Twilio then calls the <Connect action> with HandoffData: the extension rings.
    const res = await twilioPost(ctx, `/webhooks/twilio/ai/receptionist/handoff?b=${fx.business.id}&n=${fx.didNumber.id}`, {
      CallSid: "CArecept2",
      HandoffData: end.handoffData as string,
    });
    expect(res.body).toContain(`<Client>${fx.staff.user.id}</Client>`);
    // Unknown key or caller hang-up: voicemail / hang up, never an arbitrary number.
    const unknown = await twilioPost(ctx, `/webhooks/twilio/ai/receptionist/handoff?b=${fx.business.id}&n=x`, { HandoffData: JSON.stringify({ action: "transfer", target: "+19005550100", reason: "" }) });
    expect(unknown.body).toContain("<Record");
    const hungUp = await twilioPost(ctx, `/webhooks/twilio/ai/receptionist/handoff?b=${fx.business.id}&n=x`, { CallSid: "CArecept2" });
    expect(hungUp.body).toContain("<Hangup/>");
  });

  it("socket: take_message stores the message and notifies admins with ids only", async () => {
    const fx = await readyBusiness();
    gw.receptionistStep
      .mockImplementationOnce(async () => ({
        stopReason: "tool_use",
        content: [{ type: "tool_use", id: "toolu_2", name: "take_message", input: { name: "Marie", callback_number: "418 555 0199", reason: "Rendez-vous" } }] as never,
        usage: usage(20),
      }))
      .mockImplementationOnce(async (_i, onText) => {
        onText("Merci, on vous rappelle.");
        return { stopReason: "end_turn", content: [{ type: "text", text: "Merci, on vous rappelle.", citations: null }] as never, usage: usage(10) };
      });
    const { socket, emit } = fakeSocket();
    const h = handleRelaySocket(ctx.deps, socket, log);
    const token = await relayToken(fx.business.id, "CArecept3");
    emit({ type: "setup", callSid: "CArecept3", from: "+14185550199", customParameters: { b: fx.business.id, token } });
    await h.idle();
    await h.session()!.handle(JSON.stringify({ type: "prompt", voicePrompt: "Je veux laisser un message, Marie, 418 555 0199, pour un rendez-vous.", last: true }));
    expect(store().messages).toEqual([expect.objectContaining({ businessId: fx.business.id, name: "Marie", callbackNumber: "+14185550199", callSid: "CArecept3" })]);
    expect(ctx.notifier.sent).toContainEqual([fx.owner.user.id, "ai_receptionist_message", { businessId: fx.business.id, messageId: store().messages[0]!.id }]);
    expect(ctx.notifier.sent.some((n) => (n as unknown[])[0] === fx.staff.user.id)).toBe(false);
    h.session()!.close();
  });

  it("the WebSocket route is mounted and refuses an unauthenticated setup", async () => {
    await readyBusiness();
    await ctx.app.ready();
    const ws = await ctx.app.injectWS("/ws/ai/receptionist");
    const first = new Promise<string>((resolve) => ws.on("message", (d: Buffer) => resolve(d.toString())));
    ws.send(JSON.stringify({ type: "setup", callSid: "CAx", customParameters: { b: "00000000-0000-4000-8000-000000000000", token: "nope" } }));
    expect(JSON.parse(await first)).toMatchObject({ type: "end" });
    ws.terminate();
    expect(gw.receptionistStep).not.toHaveBeenCalled();
  });
});

describe("in-app help assistant", () => {
  const ask = (auth: Record<string, string>, text: string) => ctx.app.inject({ method: "POST", url: "/v1/ai/help", headers: auth, payload: { messages: [{ role: "user", text }] } });

  it("needs the AI consent like every AI feature", async () => {
    const u = await makeUser(ctx);
    expect((await ask(u.auth, "Combien coûte Essentiel?")).json().error).toBe("ai_consent_required");
    expect(gw.helpAnswer).not.toHaveBeenCalled();
  });

  it("answers from the MIMT facts with the real prices, and meters the usage", async () => {
    const u = await makeUser(ctx);
    await consent(u.token);
    const res = await ask(u.auth, "Combien coûte Essentiel?");
    expect(res.json()).toEqual({ answer: "Essentiel coûte 12,99 $ par mois avant taxes.", needsHuman: false });
    const input = gw.helpAnswer.mock.calls[0]![0];
    expect(input.knowledge).toContain("12,99");
    expect(input.knowledge).toContain("info@mimt.ca");
    expect(input.messages).toEqual([{ role: "user", text: "Combien coûte Essentiel?" }]);
    expect(JSON.stringify(input)).not.toContain(u.user.id);
  });

  it("hands over to a person when the model refuses", async () => {
    const u = await makeUser(ctx);
    await consent(u.token);
    gw.helpAnswer.mockResolvedValueOnce({ ok: false, reason: "refusal", usage: usage() });
    expect((await ask(u.auth, "?")).json()).toMatchObject({ needsHuman: true });
  });

  it("works on the free plan (own quota, not the plan's AI budget) and stops after the monthly quota", async () => {
    const u = await makeUser(ctx);
    await consent(u.token);
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await ask(u.auth, `Question ${i}`)).statusCode;
    expect(last).toBe(429);
  });

  it("refuses a conversation that does not end with the user's question", async () => {
    const u = await makeUser(ctx);
    const res = await ctx.app.inject({ method: "POST", url: "/v1/ai/help", headers: u.auth, payload: { messages: [{ role: "assistant", text: "Bonjour" }] } });
    expect(res.statusCode).toBe(400);
  });
});

describe("Affaires: AI call summaries", () => {
  async function recordedCall(plan: PlanCode = "business_pro") {
    const b = await makeBusiness(ctx, { plan });
    const recording = await ctx.repo.pbx.createRecording({
      businessId: b.business.id, callSid: "CA9", recordingSid: "RE9", recordingUrl: null, extensionId: null, userId: null,
      source: "all", fromNumber: "+14185550199", toNumber: b.didNumber.e164, durationS: 120, retentionDays: 90, deleteAfter: new Date(NOW.getTime() + 90 * 86_400_000),
    });
    const transcriber = {
      start: vi.fn(async () => "GT9"),
      result: vi.fn(async () => ({ status: "completed" as const, text: "Bonjour, je voudrais une soumission pour une thermopompe." })),
      remove: vi.fn(async () => {}),
    };
    ctx.deps.twilio = Object.assign(ctx.deps.twilio!, { intelligence: transcriber });
    return { ...b, recording, transcriber };
  }
  const noSleep = async () => {};

  it("stores an encrypted French summary with action items and lists it with the recording", async () => {
    const b = await recordedCall();
    await consent(b.owner.token);
    expect(await summarizeBusinessCall(ctx.deps, b.business, b.recording, noSleep)).toBe("done");
    expect(b.transcriber.start).toHaveBeenCalledWith({ language: "fr", recordingSid: "RE9", customerKey: "RE9" });
    expect(b.transcriber.remove).toHaveBeenCalledWith("GT9");
    const stored = (ctx.repo.pbx as unknown as { callSummaries: Map<string, { summaryEncrypted: string }> }).callSummaries.get(b.recording.id)!;
    expect(stored.summaryEncrypted).not.toContain("thermopompe");
    const res = await ctx.app.inject({ method: "GET", url: `/v1/business/${b.business.id}/recordings`, headers: b.owner.auth });
    expect(res.json().recordings[0].summary).toEqual({
      text: "Le client veut une soumission pour une thermopompe.",
      actionItems: ["Envoyer la soumission jeudi"],
      locale: "fr-CA",
    });
  });

  it("sends nothing to the AI without the owner's consent or without Affaires Pro", async () => {
    const b = await recordedCall();
    expect(await summarizeBusinessCall(ctx.deps, b.business, b.recording, noSleep)).toBe("no_consent");
    const basic = await recordedCall("business");
    await consent(basic.owner.token);
    expect(await summarizeBusinessCall(ctx.deps, basic.business, basic.recording, noSleep)).toBe("not_entitled");
    expect(gw.summarizeCall).not.toHaveBeenCalled();
    expect(b.transcriber.start).not.toHaveBeenCalled();
  });
});

describe("public AI phone demo", () => {
  const demo = (payload: object, ip = "203.0.113.7") =>
    ctx.app.inject({ method: "POST", url: "/v1/public/ai-demo", payload, remoteAddress: ip });

  it("answers the greeting, then closes with the ticket the business would receive, without sign-in", async () => {
    const hello = await demo({ scenario: "restaurant", locale: "fr-CA", messages: [] });
    expect(hello.statusCode).toBe(200);
    expect(hello.json()).toMatchObject({ done: false, ticket: null });
    const end = await demo({
      scenario: "restaurant",
      locale: "fr-CA",
      messages: [
        { role: "agent", text: hello.json().reply },
        { role: "caller", text: "Une poutine classique pour emporter, au nom d'Alex. Merci!" },
      ],
    });
    expect(end.json()).toMatchObject({ done: true, ticket: { title: "Commande pour Alex" } });
    expect(gw.demoTurn.mock.calls[0]![0].system).toContain("Casse-croûte Comète");
  });

  it("uses the prompt of the chosen business and rejects unknown scenarios and long messages", async () => {
    await demo({ scenario: "booking", messages: [] });
    expect(gw.demoTurn.mock.calls[0]![0].system).toContain("Salon Aurore");
    expect((await demo({ scenario: "casino", messages: [] })).statusCode).toBe(400);
    const long = await demo({ scenario: "support", messages: [{ role: "caller", text: "x".repeat(500) }] });
    expect(long.json().error).toBe("message_too_long");
  });

  it("limits calls per visitor and can be switched off", async () => {
    let last = 200;
    for (let i = 0; i < 13; i++) last = (await demo({ scenario: "support", messages: [] }, "198.51.100.9")).statusCode;
    expect(last).toBe(429);
    ctx.deps.config.AI_DEMO = "off";
    expect((await demo({ scenario: "support", messages: [] })).statusCode).toBe(503);
  });

  it("answers 503 without an AI key", async () => {
    await withAi(null);
    expect((await demo({ scenario: "restaurant", messages: [] })).statusCode).toBe(503);
  });
});

