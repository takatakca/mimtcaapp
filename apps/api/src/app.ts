import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import type { AppDeps } from "./deps.js";
import { HttpError } from "./lib/errors.js";
import { loggerOptions } from "./logger.js";
import { setActivePlans } from "./plansConfig.js";
import { adminCostRoutes } from "./routes/adminCosts.js";
import { aiRoutes } from "./routes/ai.js";
import { authRoutes } from "./routes/auth.js";
import { billingRoutes } from "./routes/billing.js";
import { businessRoutes } from "./routes/business.js";
import { blockRoutes } from "./routes/blocks.js";
import { callRoutes } from "./routes/calls.js";
import { catalogRoutes } from "./routes/catalog.js";
import { captureException } from "./monitoring/report.js";
import { deviceRoutes } from "./routes/devices.js";
import { e911Routes } from "./routes/e911.js";
import { handoffRoutes } from "./routes/handoff.js";
import { healthRoutes } from "./routes/health.js";
import { meRoutes } from "./routes/me.js";
import { messageRoutes } from "./routes/messages.js";
import { numberRoutes } from "./routes/numbers.js";
import { portInRoutes } from "./routes/portIns.js";
import { pushRoutes } from "./routes/push.js";
import { rateRoutes } from "./routes/rates.js";
import { referralRoutes } from "./routes/referrals.js";
import { rewardRoutes } from "./routes/rewards.js";
import { aiReceptionistSocket } from "./routes/twilioAi.js";
import { twilioWebhooks } from "./routes/twilioWebhooks.js";
import { voiceRoutes } from "./routes/voice.js";
import { voicemailRoutes } from "./routes/voicemails.js";
import { mediaRoutes } from "./routes/media.js";
import { meetingRoutes } from "./routes/meetings.js";
import { voicemailSettingsRoutes } from "./routes/voicemailSettings.js";

type Routes = (app: import("fastify").FastifyInstance, deps: AppDeps) => Promise<void>;

export async function buildApp(deps: AppDeps) {
  // Prices and quotas validated at config load (plansConfig.ts); every cap check reads them through planOf().
  if (deps.config.plans) setActivePlans(deps.config.plans);
  const app = Fastify({
    logger: loggerOptions(deps.config),
    trustProxy: true,
    bodyLimit: 256 * 1024,
  });

  await app.register(helmet);
  await app.register(cors, { origin: deps.config.CORS_ORIGINS, credentials: false, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] });
  await app.register(formbody);
  // AI receptionist (Twilio ConversationRelay). Small frames only.
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    // Twilio and Stripe retry on errors; their webhooks are authenticated by signature instead.
    allowList: (req) => req.url.startsWith("/webhooks/"),
  });

  app.setErrorHandler((err: FastifyError | HttpError, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    if (err.validation) return reply.code(400).send({ error: "invalid_request", message: err.message });
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err }, "request failed");
      if (deps.config.SENTRY_DSN) {
        void captureException(deps.config.SENTRY_DSN, { name: err.name, message: err.message }).catch(() => undefined);
      }
      return reply.code(500).send({ error: "internal_error", message: "Internal error" });
    }
    return reply.code(status).send({ error: err.code ?? "error", message: err.message });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "not_found", message: "Route not found" }));

  const routes: Routes[] = [
    healthRoutes,
    authRoutes,
    deviceRoutes,
    handoffRoutes,
    e911Routes,
    numberRoutes,
    voiceRoutes,
    callRoutes,
    voicemailRoutes,
    voicemailSettingsRoutes,
    mediaRoutes,
    messageRoutes,
    billingRoutes,
    meRoutes,
    blockRoutes,
    pushRoutes,
    rewardRoutes,
    catalogRoutes,
    referralRoutes,
    rateRoutes,
    twilioWebhooks,
    businessRoutes,
    aiRoutes,
    aiReceptionistSocket,
    portInRoutes,
    meetingRoutes,
    adminCostRoutes,
  ];
  for (const r of routes) await app.register(async (scope) => r(scope, deps));
  return app;
}
