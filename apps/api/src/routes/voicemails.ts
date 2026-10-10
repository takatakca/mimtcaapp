import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { VoicemailDto, VoicemailsResponse } from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser } from "../auth/guard.js";
import { recordingAccountSid } from "../gateways/twilio.js";
import { HttpError, notConfigured, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import type { Voicemail } from "../repo/types.js";

/** Lifetime of the signed audio URLs returned by GET /v1/voicemails. */
export const AUDIO_URL_TTL_S = 15 * 60;

const IdParams = z.object({ id: z.uuid() });
const resource = (id: string) => `voicemail:${id}`;
const hasAudio = (v: Voicemail) => Boolean(v.audioPath ?? v.audioUrl);

export async function voicemailRoutes(app: FastifyInstance, deps: AppDeps) {
  const { repo, sessions } = deps;
  const base = deps.config.PUBLIC_BASE_URL.replace(/\/$/, "");
  const auth = { preHandler: requireUser(deps) };

  async function dto(v: Voicemail): Promise<VoicemailDto> {
    // The URL points at this API (never at Twilio) and carries a capability token scoped to this one
    // voicemail, so audio players that cannot send headers can stream it. No Twilio credentials leave the server.
    const signed = hasAudio(v) ? await sessions.signMedia(resource(v.id), AUDIO_URL_TTL_S) : null;
    return {
      id: v.id,
      from: v.fromNumber,
      durationS: v.durationS,
      transcript: v.transcript,
      createdAt: v.createdAt.toISOString(),
      listened: Boolean(v.listenedAt),
      audioUrl: signed ? `${base}/v1/voicemails/${v.id}/audio?token=${encodeURIComponent(signed.token)}` : null,
      audioUrlExpiresAt: signed ? signed.expiresAt.toISOString() : null,
    };
  }

  /** The voicemail if it belongs to the signed-in user's account; 404 otherwise (no existence leak). */
  async function ownVoicemail(req: FastifyRequest): Promise<Voicemail> {
    const { id } = parse(IdParams, req.params);
    const { account } = await loadContext(deps, req);
    const vm = await repo.getVoicemail(id);
    if (!vm || vm.telecomAccountId !== account.id) throw notFound();
    return vm;
  }

  app.get("/v1/voicemails", auth, async (req): Promise<VoicemailsResponse> => {
    const { account } = await loadContext(deps, req);
    const list = await repo.listVoicemails(account.id);
    return { voicemails: await Promise.all(list.map(dto)) };
  });

  app.delete("/v1/voicemails/:id", auth, async (req, reply) => {
    const vm = await ownVoicemail(req);
    await repo.deleteVoicemail(vm.id);
    // Best effort: also remove the audio from Twilio (Law 25 minimisation). The row is already gone.
    if (deps.media && vm.audioPath) {
      await deps.media.delete(vm.audioPath).catch((err: unknown) => req.log.warn({ err, voicemailId: vm.id }, "private voicemail delete failed"));
    }
    if (deps.twilio && vm.recordingSid && !vm.audioPath) {
      const accountSid = recordingAccountSid(vm.audioUrl);
      await deps.twilio
        .deleteRecording({ recordingSid: vm.recordingSid, ...(accountSid ? { accountSid } : {}) })
        .catch((err: unknown) => req.log.warn({ err, voicemailId: vm.id }, "Twilio recording delete failed"));
    }
    await repo.audit({ actorUserId: req.userId, action: "voicemail.deleted", targetType: "voicemail", targetId: vm.id, ip: req.ip });
    return reply.code(204).send();
  });

  // Audio: either a valid signed URL (?token=, from the list) or a normal Bearer token for the owner.
  app.get("/v1/voicemails/:id/audio", async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const { token } = parse(z.object({ token: z.string().max(2048).optional() }), req.query);
    let vm: Voicemail | null;
    if (token) {
      if (!(await sessions.verifyMedia(token, resource(id)))) throw new HttpError(403, "invalid_media_token", "Audio link expired or invalid");
      vm = await repo.getVoicemail(id);
      if (!vm) throw notFound();
    } else {
      await requireUser(deps)(req);
      vm = await ownVoicemail(req);
    }
    if (!hasAudio(vm)) throw notFound("no_audio");
    if (vm.audioPath && deps.media) {
      const stored = await deps.media.get(vm.audioPath);
      if (!stored) throw new HttpError(502, "audio_unavailable", "The recording could not be retrieved");
      await repo.markVoicemailListened(vm.id, deps.now());
      return sendAudio(req, reply, stored);
    }
    if (!deps.twilio) throw notConfigured("Voicemail audio");

    let audio: { contentType: string; body: Buffer };
    try {
      const accountSid = recordingAccountSid(vm.audioUrl);
      audio = await deps.twilio.fetchRecording({ recordingSid: vm.recordingSid, ...(accountSid ? { accountSid } : {}) });
    } catch (err) {
      req.log.error({ err, voicemailId: vm.id }, "voicemail audio fetch failed");
      throw new HttpError(502, "audio_unavailable", "The recording could not be retrieved");
    }
    await repo.markVoicemailListened(vm.id, deps.now());
    return sendAudio(req, reply, audio);
  });
}

/** Sends a buffer with single-range support (iOS AVPlayer asks for byte ranges). */
export function sendAudio(req: FastifyRequest, reply: FastifyReply, audio: { contentType: string; body: Buffer }) {
  const size = audio.body.length;
  reply
    .header("content-type", audio.contentType)
    .header("accept-ranges", "bytes")
    .header("cache-control", "private, no-store")
    .header("x-content-type-options", "nosniff");
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range && size > 0 && (range[1] || range[2])) {
    let start: number;
    let end: number;
    if (range[1]) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    } else {
      start = Math.max(0, size - Number(range[2]));
      end = size - 1;
    }
    if (start > end || start >= size) return reply.code(416).header("content-range", `bytes */${size}`).send();
    return reply
      .code(206)
      .header("content-range", `bytes ${start}-${end}/${size}`)
      .header("content-length", end - start + 1)
      .send(audio.body.subarray(start, end + 1));
  }
  return reply.code(200).header("content-length", size).send(audio.body);
}
