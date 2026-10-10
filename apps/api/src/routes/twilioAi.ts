// AI receptionist over Twilio ConversationRelay.
//   1. The PBX routes a call to { type: "ai_receptionist" } → <Redirect> to AI_RECEPTIONIST_PATH (signed webhook).
//   2. That webhook answers <Connect action=handoff><ConversationRelay url=wss://…/ws/ai/receptionist> with a
//      short-lived token in <Parameter>, or falls back to the PBX voicemail when AI is unavailable.
//   3. The WebSocket (/ws/ai/receptionist) checks the token from the "setup" message and runs ReceptionistSession.
//   4. When the session ends, Twilio calls the <Connect action> with HandoffData: transfer, voicemail or hang up.
// 9-1-1: the receptionist never dials anything itself; transfers go only to configured Canada/US targets
// or PBX objects, and the system prompt tells callers with an emergency to hang up and dial 9-1-1.

import type { FastifyInstance } from "fastify";
import { AI_LIMITS, type RouteTarget } from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { aiBudget, recordAiUsage } from "../ai/service.js";
import { ReceptionistSession, welcomeGreeting, type Handoff } from "../ai/receptionist.js";
import { loadSnapshot } from "../pbx/engine.js";
import * as router from "../pbx/router.js";
import type { BusinessRow } from "../repo/pbxTypes.js";
import { getFeatures } from "../services/accounts.js";
import { receptionistReady } from "./ai.js";
import { sendTwiml, twilioParams, VoiceResponse } from "./twiml.js";

export const AI_RECEPTIONIST_WS_PATH = "/ws/ai/receptionist";
/** The token only has to survive the time between our TwiML and Twilio opening the socket. */
const WS_TOKEN_TTL_S = 120;
const wsResource = (businessId: string, callSid: string) => `ai-receptionist:${businessId}:${callSid}`;

const Q = z.object({ b: z.uuid(), n: z.string().max(64).optional() });

export function receptionistWsUrl(deps: AppDeps): string {
  if (deps.config.AI_RECEPTIONIST_WS_URL) return deps.config.AI_RECEPTIONIST_WS_URL;
  return deps.config.PUBLIC_BASE_URL.replace(/\/$/, "").replace(/^http/, "ws") + AI_RECEPTIONIST_WS_PATH;
}

async function routeContext(deps: AppDeps, business: BusinessRow, numberId: string): Promise<router.RouteContext> {
  return { snap: await loadSnapshot(deps, business), now: deps.now(), base: deps.config.PUBLIC_BASE_URL.replace(/\/$/, ""), numberId };
}

/** Signed Twilio webhooks; registered inside twilioWebhooks (X-Twilio-Signature checked first). */
export async function twilioAiWebhooks(app: FastifyInstance, deps: AppDeps) {
  const { repo } = deps;
  const hangup = () => {
    const vr = new VoiceResponse();
    vr.hangup();
    return vr;
  };

  app.post(router.AI_RECEPTIONIST_PATH, async (req, reply) => {
    const q = Q.safeParse(req.query);
    const business = q.success ? await repo.pbx.getBusiness(q.data.b) : null;
    if (!q.success || !business) return sendTwiml(reply, hangup());
    const ctx = await routeContext(deps, business, q.data.n ?? "");
    const p = twilioParams(req);
    const ai = deps.ai;
    const cfg = ai ? await ai.store.getReceptionistConfig(business.id) : null;

    // Any reason the AI cannot answer → the business's general voicemail. The call is never dropped.
    let ok = Boolean(ai?.gateway && receptionistReady(cfg) && p.CallSid);
    if (ok) {
      const { features } = await getFeatures(repo, business.telecomAccountId);
      ok = features.has("ai_assist") && (await aiBudget(deps, ai!, business.telecomAccountId)).available;
    }
    if (!ok || !receptionistReady(cfg)) {
      req.log.warn({ businessId: business.id }, "AI receptionist unavailable: voicemail fallback");
      return sendTwiml(reply, router.voicemail(ctx, {}));
    }

    const token = await deps.sessions.signMedia(wsResource(business.id, p.CallSid!), WS_TOKEN_TTL_S);
    const base = deps.config.PUBLIC_BASE_URL.replace(/\/$/, "");
    const vr = new VoiceResponse();
    const connect = vr.connect({
      action: `${base}${router.AI_RECEPTIONIST_PATH}/handoff?${new URLSearchParams({ b: business.id, n: q.data.n ?? "" })}`,
      method: "POST",
    });
    const relay = connect.conversationRelay({
      url: receptionistWsUrl(deps),
      welcomeGreeting: welcomeGreeting(cfg),
      language: "fr-CA",
      interruptible: "any",
      dtmfDetection: true,
    });
    if (cfg.languages.some((l) => l.startsWith("en"))) relay.language({ code: "en-US" });
    relay.parameter({ name: "b", value: business.id });
    relay.parameter({ name: "token", value: token.token });
    return sendTwiml(reply, vr);
  });

  // <Connect action>: the ConversationRelay session ended.
  app.post(`${router.AI_RECEPTIONIST_PATH}/handoff`, async (req, reply) => {
    const q = Q.safeParse(req.query);
    const business = q.success ? await repo.pbx.getBusiness(q.data.b) : null;
    if (!q.success || !business) return sendTwiml(reply, hangup());
    const handoff = parseHandoff(twilioParams(req).HandoffData);
    // No handoff data: the caller hung up or the socket closed.
    if (!handoff) return sendTwiml(reply, hangup());
    const ctx = await routeContext(deps, business, q.data.n ?? "");
    if (handoff.action === "hangup") {
      const vr = new VoiceResponse();
      router.say(vr, router.PROMPTS.goodbye);
      vr.hangup();
      return sendTwiml(reply, vr);
    }
    if (handoff.action === "transfer") {
      const cfg = await deps.ai?.store.getReceptionistConfig(business.id);
      const target = cfg?.transferTargets.find((t) => t.key === handoff.target);
      const route = target ? transferRoute(ctx, target) : null;
      if (route) return sendTwiml(reply, router.route(ctx, route));
    }
    return sendTwiml(reply, router.voicemail(ctx, {}));
  });
}

export function parseHandoff(raw: string | undefined): Handoff | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Handoff>;
    if (v.action === "transfer" && typeof v.target === "string") return { action: "transfer", target: v.target, reason: String(v.reason ?? "") };
    if (v.action === "hangup" || v.action === "voicemail") return { action: v.action, reason: String(v.reason ?? "") };
  } catch {
    // fall through
  }
  return null;
}

/** Transfer target → PBX route: an extension or ring group of this business, else a Canada/US number. */
function transferRoute(ctx: router.RouteContext, t: { extension?: string; number?: string }): RouteTarget | null {
  if (t.extension) {
    if (ctx.snap.extensions.some((e) => e.id === t.extension)) return { type: "extension", extensionId: t.extension };
    if (ctx.snap.ringGroups.some((g) => g.id === t.extension)) return { type: "ring_group", ringGroupId: t.extension };
  }
  if (t.number && router.externalAllowed(t.number)) return { type: "external", number: t.number };
  return null;
}

/** Minimal socket surface (the ws WebSocket), so tests can drive the handler without a network. */
export interface RelaySocket {
  send(data: string): void;
  close(code?: number): void;
  on(event: "message", cb: (data: unknown) => void): unknown;
  on(event: "close", cb: () => void): unknown;
}

/**
 * One ConversationRelay connection. Nothing is sent to the AI provider until the "setup" message carries
 * a valid token for this business and call SID.
 */
export function handleRelaySocket(deps: AppDeps, socket: RelaySocket, log: { warn: (o: object, m: string) => void; error: (o: object, m: string) => void }) {
  let session: ReceptionistSession | null = null;
  let setup: Promise<void> | null = null;
  const pending: string[] = [];
  const send = (msg: Record<string, unknown>) => socket.send(JSON.stringify(msg));

  async function start(raw: Record<string, unknown>) {
    const params = (raw.customParameters ?? {}) as Record<string, unknown>;
    const callSid = typeof raw.callSid === "string" ? raw.callSid : "";
    const businessId = typeof params.b === "string" ? params.b : "";
    const token = typeof params.token === "string" ? params.token : "";
    const ai = deps.ai;
    const valid = Boolean(callSid && businessId && token) && (await deps.sessions.verifyMedia(token, wsResource(businessId, callSid)));
    const business = valid ? await deps.repo.pbx.getBusiness(businessId) : null;
    const cfg = business && ai ? await ai.store.getReceptionistConfig(business.id) : null;
    if (!valid || !business || !ai?.gateway || !receptionistReady(cfg)) {
      log.warn({ callSid, valid }, "AI receptionist socket refused");
      send({ type: "end", handoffData: JSON.stringify({ action: "voicemail", reason: "unauthorized" } satisfies Handoff) });
      socket.close(1008);
      return;
    }
    const accountId = business.telecomAccountId;
    const from = typeof raw.from === "string" ? raw.from : null;
    session = new ReceptionistSession({
      gateway: ai.gateway,
      config: cfg,
      callSid,
      callerNumber: from,
      send,
      onUsage: (u) => recordAiUsage(deps, ai, accountId, "receptionist", u),
      budgetAvailable: async () => (await aiBudget(deps, ai, accountId)).available,
      saveMessage: async (m) => {
        const saved = await ai.store.createReceptionistMessage({
          businessId: business.id,
          telecomAccountId: accountId,
          callSid,
          callerNumber: from,
          ...m,
        });
        // Owner and admins are told; only ids go to the notifier (it may log).
        const members = await deps.repo.pbx.listMembers(business.id);
        for (const mem of members) {
          if (mem.userId && mem.status === "active" && mem.role !== "member") {
            await deps.notifier.notify(mem.userId, "ai_receptionist_message", { businessId: business.id, messageId: saved.id });
          }
        }
      },
      log,
      limits: { maxSeconds: AI_LIMITS.receptionistMaxSeconds },
    });
    session.start();
    for (const m of pending.splice(0)) void session.handle(m);
  }

  socket.on("message", (data) => {
    const raw = typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    if (session) return void session.handle(raw);
    let msg: Record<string, unknown> | null = null;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (msg.type === "setup" && !setup) {
      setup = start(msg).catch((err: unknown) => {
        log.error({ err }, "AI receptionist setup failed");
        socket.close(1011);
      });
    } else if (setup && pending.length < 20) {
      pending.push(raw);
    }
  });
  socket.on("close", () => session?.close());
  return { idle: () => setup ?? Promise.resolve(), session: () => session };
}

/** WebSocket route. Needs @fastify/websocket registered on the app. */
export async function aiReceptionistSocket(app: FastifyInstance, deps: AppDeps) {
  app.get(AI_RECEPTIONIST_WS_PATH, { websocket: true }, (socket, req) => {
    handleRelaySocket(deps, socket as unknown as RelaySocket, req.log);
  });
}
