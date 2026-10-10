import type { FastifyInstance } from "fastify";
import type { RecordGreetingByCallResponse, VoicemailSettingsDto } from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser } from "../auth/guard.js";
import { conflict, forbidden, HttpError, notConfigured } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import type { TelecomAccount, User } from "../repo/types.js";
import { getFeatures, HELD_STATES } from "../services/accounts.js";
import { activateGreeting, clearGreeting } from "../services/greeting.js";
import { claimUpload, signedMediaUrl } from "../services/media.js";

const PatchBody = z.object({ emailEnabled: z.boolean().optional() }).strict();
const GreetingBody = z.object({ mediaId: z.uuid() });

/** Custom voicemail greeting and voicemail to email (paid plans: vm_greeting / vm_email). */
export async function voicemailSettingsRoutes(app: FastifyInstance, deps: AppDeps) {
  const { repo } = deps;
  const base = deps.config.PUBLIC_BASE_URL.replace(/\/$/, "");
  const auth = { preHandler: requireUser(deps) };

  async function dto(user: User, account: TelecomAccount): Promise<VoicemailSettingsDto> {
    const { features } = await getFeatures(repo, account.id);
    const settings = await repo.media.getVoicemailSettings(account.id);
    const greetingMedia = settings?.greetingMediaId ? await repo.media.getMedia(settings.greetingMediaId) : null;
    const signed = greetingMedia?.path && deps.mediaFiles ? await signedMediaUrl(deps, greetingMedia.id) : null;
    const emailAllowed = features.has("vm_email");
    return {
      available: { greeting: features.has("vm_greeting"), email: emailAllowed },
      greeting: greetingMedia
        ? {
            mediaId: greetingMedia.id,
            url: signed?.url ?? null,
            urlExpiresAt: signed?.expiresAt.toISOString() ?? null,
            updatedAt: settings!.updatedAt.toISOString(),
          }
        : null,
      emailEnabled: emailAllowed && Boolean(settings?.emailEnabled),
      email: user.email,
    };
  }

  app.get("/v1/voicemail/settings", auth, async (req): Promise<VoicemailSettingsDto> => {
    const { user, account } = await loadContext(deps, req);
    return dto(user, account);
  });

  app.patch("/v1/voicemail/settings", auth, async (req): Promise<VoicemailSettingsDto> => {
    const body = parse(PatchBody, req.body);
    const { user, account } = await loadContext(deps, req);
    if (body.emailEnabled !== undefined) {
      if (body.emailEnabled) {
        const { features } = await getFeatures(repo, account.id);
        if (!features.has("vm_email")) throw forbidden("vm_email_not_in_plan");
        if (!user.email) throw conflict("no_email", "Add an email address to your TAKATAK account first");
      }
      await repo.media.upsertVoicemailSettings(account.id, { emailEnabled: body.emailEnabled });
      await repo.audit({ actorUserId: user.id, action: body.emailEnabled ? "voicemail.email_on" : "voicemail.email_off", targetType: "telecom_account", targetId: account.id, ip: req.ip });
    }
    return dto(user, account);
  });

  // Activate an uploaded greeting (POST /v1/media/uploads purpose "greeting", then PUT the file).
  app.put("/v1/voicemail/greeting", auth, async (req): Promise<VoicemailSettingsDto> => {
    const { mediaId } = parse(GreetingBody, req.body);
    const { user, account } = await loadContext(deps, req);
    const { features } = await getFeatures(repo, account.id);
    if (!features.has("vm_greeting")) throw forbidden("vm_greeting_not_in_plan");
    if (!deps.mediaFiles) throw notConfigured("Media storage");
    const media = await claimUpload(deps, account.id, mediaId, "greeting");
    await activateGreeting(deps, account.id, media, req.log);
    await repo.audit({ actorUserId: user.id, action: "voicemail.greeting_set", targetType: "media", targetId: media.id, ip: req.ip });
    return dto(user, account);
  });

  // Back to the default French/English greeting. Allowed on every plan (also after a downgrade).
  app.delete("/v1/voicemail/greeting", auth, async (req): Promise<VoicemailSettingsDto> => {
    const { user, account } = await loadContext(deps, req);
    await clearGreeting(deps, account.id, req.log);
    await repo.audit({ actorUserId: user.id, action: "voicemail.greeting_reset", targetType: "telecom_account", targetId: account.id, ip: req.ip });
    return dto(user, account);
  });

  // Record by phone: Twilio rings the user's app and records the greeting (works on every device,
  // and Twilio produces a format <Play> accepts). The recording webhook stores it.
  app.post("/v1/voicemail/greeting/call", auth, async (req, reply) => {
    const { user, account } = await loadContext(deps, req);
    const { features } = await getFeatures(repo, account.id);
    if (!features.has("vm_greeting")) throw forbidden("vm_greeting_not_in_plan");
    if (!deps.mediaFiles) throw notConfigured("Media storage");
    if (!deps.twilio?.createCall) throw notConfigured("Voice");
    const number = (await repo.listNumbersByAccount(account.id)).find((n) => HELD_STATES.has(n.state));
    if (!number) throw conflict("no_number", "Choose a MIMT number first");
    if (!(await deps.rateLimiter.take(`greeting-call:${account.id}`, { capacity: 5, windowSeconds: 3600 }))) {
      throw new HttpError(429, "rate_limited");
    }
    await deps.twilio.createCall({
      to: `client:${user.id}`,
      from: number.e164,
      url: `${base}/webhooks/twilio/voice/greeting/record?a=${account.id}`,
    });
    const res: RecordGreetingByCallResponse = { status: "calling" };
    return reply.code(202).send(res);
  });
}
