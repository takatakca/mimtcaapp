import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.js";
import { HELD_STATES } from "../services/accounts.js";
import { ingestInboundMedia } from "../services/media.js";
import { MessagingResponse, NOT_IN_SERVICE, sendTwiml, twilioParams } from "./twiml.js";

const OPT_OUT = new Set(["STOP", "STOPALL", "ARRET", "ARRETER", "UNSUBSCRIBE", "DESABONNER", "DESINSCRIRE", "CANCEL", "END", "QUIT"]);
const OPT_IN = new Set(["START", "UNSTOP", "YES", "OUI", "DEMARRER", "REPRENDRE"]);

/** "Arrêt !" → "ARRET". */
export const normalizeKeyword = (body: string) =>
  body
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}]/gu, "")
    .toUpperCase();

export async function twilioSmsWebhooks(app: FastifyInstance, deps: AppDeps) {
  const { repo } = deps;

  app.post("/webhooks/twilio/sms/inbound", async (req, reply) => {
    const p = twilioParams(req);
    const empty = new MessagingResponse();
    const number = p.To ? await repo.getNumberByE164(p.To) : null;
    if (!number || !p.From) return sendTwiml(reply, empty);
    if (number.state === "quarantine") {
      const r = new MessagingResponse();
      r.message(`${NOT_IN_SERVICE.fr} / ${NOT_IN_SERVICE.en}`);
      return sendTwiml(reply, r);
    }
    if (!number.telecomAccountId || !HELD_STATES.has(number.state)) return sendTwiml(reply, empty);

    const body = p.Body ?? "";
    const keyword = normalizeKeyword(body);
    if (OPT_OUT.has(keyword)) {
      await repo.setOptOut(number.e164, p.From, true);
      await repo.audit({ actorUserId: null, action: "sms.opt_out", targetType: "phone_number", targetId: number.id });
    } else if (OPT_IN.has(keyword)) {
      await repo.setOptOut(number.e164, p.From, false);
    }

    const message = await repo.createMessage({
      twilioSid: p.MessageSid ?? null,
      telecomAccountId: number.telecomAccountId,
      direction: "inbound",
      ourNumber: number.e164,
      peer: p.From,
      bodyEncrypted: deps.cipher.encrypt(body),
      bodyFingerprint: deps.cipher.fingerprint(body),
      status: "received",
      segments: Number(p.NumSegments ?? 1) || 1,
      numMedia: Number(p.NumMedia ?? 0) || 0,
    });
    // MMS: copy media into private storage (every plan can receive pictures). Never fails the webhook.
    if (message.numMedia > 0) {
      await ingestInboundMedia(deps, req.log, message, p).catch((err: unknown) => req.log.error({ err }, "inbound MMS ingest failed"));
    }
    // TODO: push notification to the owner's devices.
    return sendTwiml(reply, empty);
  });

  app.post("/webhooks/twilio/sms/status", async (req, reply) => {
    const p = twilioParams(req);
    if (p.MessageSid && p.MessageStatus) {
      const price = p.Price ? Math.abs(Number(p.Price)) : undefined;
      await repo.updateMessageBySid(p.MessageSid, {
        status: p.MessageStatus,
        ...(p.ErrorCode ? { errorCode: p.ErrorCode } : {}),
        ...(price !== undefined && !Number.isNaN(price) ? { price, priceUnit: p.PriceUnit ?? null } : {}),
      });
    }
    return reply.code(204).send();
  });
}
