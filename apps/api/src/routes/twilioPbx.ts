import type { FastifyInstance, FastifyRequest } from "fastify";
import { summarizeBusinessCall } from "../ai/callSummary.js";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { addDays } from "../lib/time.js";
import { loadSnapshot } from "../pbx/engine.js";
import * as router from "../pbx/router.js";
import { sendTwiml, twilioParams, VoiceResponse } from "./twiml.js";

const Q = z.object({
  b: z.uuid(),
  n: z.string().max(64).optional(),
  m: z.uuid().optional(),
  a: z.coerce.number().int().min(0).max(10).default(0),
  k: z.enum(["ext", "rg"]).optional(),
  id: z.uuid().optional(),
  i: z.coerce.number().int().min(0).max(100).default(0),
  x: z.uuid().optional(),
  g: z.uuid().optional(),
  s: z.enum(["all", "on_demand"]).optional(),
  type: z.enum(["extension", "ring_group", "voicemail", "ivr", "directory"]).optional(),
});

/**
 * PBX webhooks (/webhooks/twilio/pbx/*), registered inside twilioWebhooks so X-Twilio-Signature is checked
 * first. Query parameters were written by us into TwiML and are covered by the signature.
 */
export async function twilioPbxWebhooks(app: FastifyInstance, deps: AppDeps) {
  const { repo } = deps;
  const base = deps.config.PUBLIC_BASE_URL.replace(/\/$/, "");
  const P = router.PBX_PATH;

  const hangup = () => {
    const vr = new VoiceResponse();
    vr.hangup();
    return vr;
  };

  async function context(req: FastifyRequest) {
    const q = Q.safeParse(req.query);
    if (!q.success) return null;
    const business = await repo.pbx.getBusiness(q.data.b);
    if (!business) return null;
    const snap = await loadSnapshot(deps, business);
    const ctx: router.RouteContext = { snap, now: deps.now(), base, numberId: q.data.n ?? "" };
    return { q: q.data, ctx, business };
  }

  app.post(`${P}/ivr-input`, async (req, reply) => {
    const c = await context(req);
    const menu = c?.q.m ? c.ctx.snap.ivrMenus.find((m) => m.id === c.q.m) : undefined;
    if (!c || !menu) return sendTwiml(reply, hangup());
    return sendTwiml(reply, router.ivrInput(c.ctx, menu, twilioParams(req).Digits, c.q.a));
  });

  app.post(`${P}/dial-result`, async (req, reply) => {
    const c = await context(req);
    if (!c?.q.k || !c.q.id) return sendTwiml(reply, hangup());
    return sendTwiml(reply, router.dialResult(c.ctx, c.q.k, c.q.id, c.q.i, twilioParams(req).DialCallStatus));
  });

  app.post(`${P}/directory-input`, async (req, reply) => {
    const c = await context(req);
    if (!c) return sendTwiml(reply, hangup());
    return sendTwiml(reply, router.directoryInput(c.ctx, twilioParams(req).Digits));
  });

  /** Re-enter the PBX at a given object (used by the AI receptionist to transfer a caller). */
  app.post(`${P}/route`, async (req, reply) => {
    const c = await context(req);
    if (!c?.q.type) return sendTwiml(reply, hangup());
    const { type, id } = c.q;
    const target: Parameters<typeof router.route>[1] | null =
      type === "directory"
        ? { type }
        : type === "voicemail"
          ? { type, ...(id ? { extensionId: id } : {}) }
          : !id
            ? null
            : type === "extension"
              ? { type, extensionId: id }
              : type === "ring_group"
                ? { type, ringGroupId: id }
                : { type, ivrMenuId: id };
    return sendTwiml(reply, target ? router.route(c.ctx, target) : hangup());
  });

  // Mobile leg of an extension: whisper + press 1.
  app.post(`${P}/whisper`, async (req, reply) => {
    const q = Q.safeParse(req.query);
    if (!q.success) return sendTwiml(reply, hangup());
    return sendTwiml(reply, router.whisper(base, q.data.b));
  });
  app.post(`${P}/whisper-input`, async (req, reply) => sendTwiml(reply, router.whisperInput(twilioParams(req).Digits)));

  // Called party of a business outbound call: recording notice before they are connected.
  app.post(`${P}/consent`, async (req, reply) => {
    const q = Q.safeParse(req.query);
    const business = q.success ? await repo.pbx.getBusiness(q.data.b) : null;
    const vr = new VoiceResponse();
    if (business) router.say(vr, business.recordingPolicy.consentPrompt);
    return sendTwiml(reply, vr);
  });

  // Voicemail left on an extension, a ring group or the general box.
  app.post(`${P}/voicemail-recorded`, async (req, reply) => {
    const p = twilioParams(req);
    const q = Q.safeParse(req.query);
    if (!q.success || (p.RecordingStatus && p.RecordingStatus !== "completed") || !p.RecordingSid || !p.CallSid) return reply.code(204).send();
    const business = await repo.pbx.getBusiness(q.data.b);
    const number = q.data.n ? await repo.getNumber(q.data.n) : null;
    if (!business || !number) return reply.code(204).send();
    // Extension box: filed with the extension user's own account, so it shows in their app. Others: the business account.
    const ext = q.data.x ? await repo.pbx.getExtension(q.data.x) : null;
    const owner = ext?.businessId === business.id && ext.userId ? await repo.getAccountByOwner(ext.userId) : null;
    const call = await repo.getCallBySid(p.CallSid);
    await repo.createVoicemail({
      telecomAccountId: owner?.id ?? business.telecomAccountId,
      phoneNumberId: number.id,
      callSid: p.CallSid,
      recordingSid: p.RecordingSid,
      fromNumber: call?.fromNumber ?? p.From ?? null,
      audioUrl: p.RecordingUrl ?? null,
      durationS: p.RecordingDuration ? Number(p.RecordingDuration) : null,
    });
    return reply.code(204).send();
  });

  // Call recording finished (policy "all" via <Dial record>, or on demand via the Calls API).
  app.post(`${P}/recording`, async (req, reply) => {
    const p = twilioParams(req);
    const q = Q.safeParse(req.query);
    if (!q.success || (p.RecordingStatus && p.RecordingStatus !== "completed") || !p.RecordingSid || !p.CallSid) return reply.code(204).send();
    const business = await repo.pbx.getBusiness(q.data.b);
    if (!business) return reply.code(204).send();
    const call = (await repo.getCallBySid(p.CallSid)) ?? (p.ParentCallSid ? await repo.getCallBySid(p.ParentCallSid) : null);
    const ext = q.data.x ? await repo.pbx.getExtension(q.data.x) : null;
    const now = deps.now();
    const retentionDays = business.recordingPolicy.retentionDays;
    const recording = await repo.pbx.createRecording({
      businessId: business.id,
      callSid: p.CallSid,
      recordingSid: p.RecordingSid,
      recordingUrl: p.RecordingUrl ?? null,
      extensionId: ext?.businessId === business.id ? ext.id : null,
      userId: call?.userId ?? (ext?.businessId === business.id ? ext.userId : null),
      source: q.data.s ?? "all",
      fromNumber: call?.fromNumber ?? null,
      toNumber: call?.toNumber ?? null,
      durationS: p.RecordingDuration ? Number(p.RecordingDuration) : null,
      retentionDays,
      deleteAfter: addDays(now, retentionDays),
    });
    // AI summary (Affaires Pro + owner's AI consent; checked inside). Transcription can take a minute or two.
    if (deps.ai?.gateway) deps.ai.background("call:summary", () => summarizeBusinessCall(deps, business, recording));
    return reply.code(204).send();
  });
}
