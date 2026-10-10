import type { FastifyInstance } from "fastify";
import { GREETING_MAX_S } from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { recordingAccountSid } from "../gateways/twilio.js";
import { getFeatures } from "../services/accounts.js";
import { activateGreeting } from "../services/greeting.js";
import { sayBilingual, sendTwiml, twilioParams, VoiceResponse } from "./twiml.js";

const AccountQuery = z.object({ a: z.uuid() });

/**
 * "Record your greeting by phone" (POST /v1/voicemail/greeting/call). Registered inside twilioWebhooks,
 * so the Twilio signature (which covers ?a=) is checked before these run.
 */
export async function twilioGreetingWebhooks(app: FastifyInstance, deps: AppDeps) {
  const { repo } = deps;
  const base = deps.config.PUBLIC_BASE_URL.replace(/\/$/, "");

  app.post("/webhooks/twilio/voice/greeting/record", async (req, reply) => {
    const q = AccountQuery.safeParse(req.query);
    const vr = new VoiceResponse();
    if (!q.success) {
      vr.hangup();
      return sendTwiml(reply, vr);
    }
    sayBilingual(
      vr,
      "Après le signal, enregistrez votre message d'accueil, puis appuyez sur le carré ou raccrochez.",
      "After the tone, record your greeting, then press pound or hang up.",
    );
    vr.record({
      maxLength: GREETING_MAX_S,
      finishOnKey: "#",
      playBeep: true,
      trim: "trim-silence",
      action: `${base}/webhooks/twilio/voice/greeting/saved`,
      method: "POST",
      recordingStatusCallback: `${base}/webhooks/twilio/voice/greeting/recording?a=${q.data.a}`,
      recordingStatusCallbackMethod: "POST",
      recordingStatusCallbackEvent: ["completed"],
    });
    return sendTwiml(reply, vr);
  });

  app.post("/webhooks/twilio/voice/greeting/saved", async (_req, reply) => {
    const vr = new VoiceResponse();
    sayBilingual(vr, "Merci. Votre message d'accueil est enregistré.", "Thank you. Your greeting has been saved.");
    vr.hangup();
    return sendTwiml(reply, vr);
  });

  app.post("/webhooks/twilio/voice/greeting/recording", async (req, reply) => {
    const p = twilioParams(req);
    const q = AccountQuery.safeParse(req.query);
    if (!q.success || !p.RecordingSid || (p.RecordingStatus && p.RecordingStatus !== "completed")) return reply.code(204).send();
    const accountId = q.data.a;
    const accountSid = recordingAccountSid(p.RecordingUrl);
    const ref = { recordingSid: p.RecordingSid, ...(accountSid ? { accountSid } : {}) };
    try {
      const account = await repo.getAccount(accountId);
      const { features } = account ? await getFeatures(repo, accountId) : { features: new Set() };
      if (account && features.has("vm_greeting") && deps.mediaFiles && deps.twilio) {
        const audio = await deps.twilio.fetchRecording(ref);
        const media = await repo.media.createMedia({
          telecomAccountId: accountId,
          kind: "greeting",
          status: "ready",
          path: null,
          twilioUrl: null,
          contentType: "audio/mpeg",
          sizeBytes: audio.body.length,
          messageId: null,
          expiresAt: null,
        });
        const path = `greetings/${accountId}/${media.id}.mp3`;
        await deps.mediaFiles.put(path, audio.body, "audio/mpeg");
        await repo.media.updateMedia(media.id, { path });
        await activateGreeting(deps, accountId, { ...media, path }, req.log);
        await repo.audit({ actorUserId: account.ownerUserId, action: "voicemail.greeting_set", targetType: "media", targetId: media.id, meta: { via: "call" } });
      }
    } catch (err) {
      req.log.error({ err, accountId }, "greeting recording could not be stored");
    }
    // Our copy is the only one kept (Law 25 minimisation).
    await deps.twilio?.deleteRecording(ref).catch((err: unknown) => req.log.warn({ err }, "Twilio greeting recording delete failed"));
    return reply.code(204).send();
  });
}
