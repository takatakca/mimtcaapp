import type { FastifyInstance } from "fastify";
import type { CreateMediaUploadResponse } from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser } from "../auth/guard.js";
import { forbidden, HttpError, notConfigured, notFound } from "../lib/errors.js";
import { isInlineSafe } from "../lib/sniff.js";
import { parse } from "../lib/validate.js";
import { getFeatures } from "../services/accounts.js";
import { createUpload, mediaResource } from "../services/media.js";
import { sendAudio } from "./voicemails.js";

const UploadBody = z.object({
  purpose: z.enum(["mms", "greeting"]),
  contentType: z.string().min(3).max(100),
  sizeBytes: z.number().int().positive(),
});
const IdParams = z.object({ id: z.uuid() });

export async function mediaRoutes(app: FastifyInstance, deps: AppDeps) {
  const auth = { preHandler: requireUser(deps) };

  // Signed upload URL into the private bucket. Sending MMS and custom greetings are plan-gated;
  // receiving MMS is not (see ingestInboundMedia).
  app.post("/v1/media/uploads", auth, async (req, reply) => {
    const body = parse(UploadBody, req.body);
    const { account } = await loadContext(deps, req);
    const { features } = await getFeatures(deps.repo, account.id);
    if (body.purpose === "mms" && !features.has("mms")) throw forbidden("mms_not_in_plan");
    if (body.purpose === "greeting" && !features.has("vm_greeting")) throw forbidden("vm_greeting_not_in_plan");
    if (!deps.mediaFiles?.createSignedUpload) throw notConfigured("Media storage");
    if (!(await deps.rateLimiter.take(`media-upload:${account.id}`, { capacity: 60, windowSeconds: 3600 }))) {
      throw new HttpError(429, "rate_limited");
    }
    const { media, signed, maxBytes } = await createUpload(deps, account.id, body.purpose, body.contentType, body.sizeBytes);
    const res: CreateMediaUploadResponse = {
      mediaId: media.id,
      uploadUrl: signed.url,
      uploadMethod: signed.method,
      uploadHeaders: signed.headers,
      uploadExpiresAt: signed.expiresAt.toISOString(),
      maxBytes,
    };
    return reply.code(201).send(res);
  });

  // Media bytes: a signed URL (?token=, from MessageDto.media or a greeting) or a Bearer token for the owner.
  // Twilio fetches outbound MMS and greetings through this route too.
  app.get("/v1/media/:id", async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const { token } = parse(z.object({ token: z.string().max(2048).optional() }), req.query);
    let media = await deps.repo.media.getMedia(id);
    if (token) {
      if (!(await deps.sessions.verifyMedia(token, mediaResource(id)))) throw new HttpError(403, "invalid_media_token", "Link expired or invalid");
    } else {
      await requireUser(deps)(req);
      const { account } = await loadContext(deps, req);
      if (media && media.telecomAccountId !== account.id) media = null;
    }
    if (!media || media.status !== "ready") throw notFound();

    let file: { contentType: string; body: Buffer } | null = null;
    if (media.path && deps.mediaFiles) {
      file = await deps.mediaFiles.get(media.path);
    } else if (media.twilioUrl && deps.twilio?.fetchMedia) {
      file = await deps.twilio.fetchMedia(media.twilioUrl).catch((err: unknown) => {
        req.log.error({ err, mediaId: media!.id }, "Twilio media proxy failed");
        return null;
      });
    } else if (!deps.mediaFiles) {
      throw notConfigured("Media storage");
    }
    if (!file) throw new HttpError(502, "media_unavailable", "The file could not be retrieved");

    // The type recorded at upload/ingest (checked by magic bytes for uploads), never the storage header.
    const inline = isInlineSafe(media.contentType);
    reply.header("content-disposition", inline ? "inline" : `attachment; filename="mimt-${media.id}"`);
    return sendAudio(req, reply, { contentType: inline ? media.contentType : "application/octet-stream", body: file.body });
  });
}
