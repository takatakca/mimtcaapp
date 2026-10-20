import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppDeps } from "../deps.js";
import { requireUser } from "../auth/guard.js";
import { forbidden } from "../lib/errors.js";
import { freeTierCosts, type FreeTierCosts } from "../services/freeTier.js";

/** Free-tier cost guard visibility for MIMT staff (same allowlist as the catalog admin: CATALOG_ADMIN_USER_IDS). */
export async function adminCostRoutes(app: FastifyInstance, deps: AppDeps) {
  const admin = {
    preHandler: [
      requireUser(deps),
      async (req: FastifyRequest) => {
        if (!deps.config.CATALOG_ADMIN_USER_IDS.includes(req.userId)) throw forbidden("admin_only", "Réservé aux administrateurs MIMT.");
      },
    ],
  };

  app.get("/v1/admin/costs", admin, async (_req, reply): Promise<FreeTierCosts> => {
    void reply.header("cache-control", "no-store");
    return freeTierCosts(deps);
  });
}
