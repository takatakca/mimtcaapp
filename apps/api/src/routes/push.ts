import type { FastifyInstance } from "fastify";
import type { PushRegisterRequest } from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser } from "../auth/guard.js";
import { parse } from "../lib/validate.js";
import { vapidKeys } from "../services/webPush.js";

const WebSubscribeBody = z.object({
  endpoint: z.string().url().startsWith("https://").max(2048),
  keys: z.object({ p256dh: z.string().min(16).max(256), auth: z.string().min(8).max(128) }),
});

const RegisterBody = z.object({
  // APNs tokens are 64 hex chars, FCM tokens ~160+ chars; keep a generous upper bound.
  token: z.string().trim().min(8).max(4096).regex(/^[\x21-\x7e]+$/, "token must be printable ASCII"),
  platform: z.enum(["ios", "android"]),
  kind: z.literal("messages").default("messages"),
}) satisfies z.ZodType<PushRegisterRequest, unknown>;

export async function pushRoutes(app: FastifyInstance, deps: AppDeps) {
  // Message-notification device token (incoming calls use Twilio's VoIP push, not this).
  app.post("/v1/push/register", { preHandler: requireUser(deps), config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = parse(RegisterBody, req.body);
    const { user } = await loadContext(deps, req);
    await deps.repo.upsertPushToken({ userId: user.id, platform: body.platform, kind: body.kind, token: body.token });
    return reply.code(204).send();
  });

  // Web Push (app.mimt.ca): the browser subscribes with the server's public VAPID key.
  app.get("/v1/push/web/key", async () => ({ publicKey: (await vapidKeys(deps.repo, deps.cipher)).publicKey }));

  app.post("/v1/push/web/subscribe", { preHandler: requireUser(deps), config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = parse(WebSubscribeBody, req.body);
    const { user } = await loadContext(deps, req);
    await deps.repo.webPush.upsert({ userId: user.id, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth });
    return reply.code(204).send();
  });

  app.post("/v1/push/web/unsubscribe", { preHandler: requireUser(deps) }, async (req, reply) => {
    const { endpoint } = parse(z.object({ endpoint: z.string().url().max(2048) }), req.body);
    const { user } = await loadContext(deps, req);
    const mine = await deps.repo.webPush.listForUser(user.id);
    if (mine.some((s) => s.endpoint === endpoint)) await deps.repo.webPush.deleteByEndpoint(endpoint);
    return reply.code(204).send();
  });
}
