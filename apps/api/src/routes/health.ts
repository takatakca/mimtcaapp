import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.js";
import { pingHeartbeat } from "../monitoring/report.js";
import { MIGRATION_ORDER } from "../jobs/migrateStandalone.js";

export async function healthRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get("/healthz", { config: { rateLimit: false } }, async () => ({ ok: true }));
  app.get("/readyz", { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await deps.repo.ping();
      // Schema drift (a migration not applied) breaks features while the database still answers: report it.
      const applied = deps.repo.appliedMigrations ? new Set(await deps.repo.appliedMigrations()) : null;
      const missing = applied ? MIGRATION_ORDER.filter((m) => !applied.has(m)) : [];
      const body = { ok: missing.length === 0, db: "up", schema: missing.length ? "outdated" : "current", ...(missing.length ? { missingMigrations: missing } : {}), twilio: Boolean(deps.twilio), stripe: Boolean(deps.billing) };
      if (missing.length) return reply.code(503).send(body);
      void pingHeartbeat(deps.config.BETTER_STACK_HEARTBEAT_URL).catch(() => undefined);
      return body;
    } catch {
      return reply.code(503).send({ ok: false, db: "down" });
    }
  });
}
