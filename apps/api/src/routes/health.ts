import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.js";
import { pingHeartbeat } from "../monitoring/report.js";

export async function healthRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get("/healthz", { config: { rateLimit: false } }, async () => ({ ok: true }));
  app.get("/readyz", { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await deps.repo.ping();
      void pingHeartbeat(deps.config.BETTER_STACK_HEARTBEAT_URL).catch(() => undefined);
      return { ok: true, db: "up", twilio: Boolean(deps.twilio), stripe: Boolean(deps.billing) };
    } catch {
      return reply.code(503).send({ ok: false, db: "down" });
    }
  });
}
