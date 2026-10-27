import type { FastifyInstance } from "fastify";
import type { MissionsResponse } from "@mimt/shared";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser } from "../auth/guard.js";
import { missionsView } from "../services/missions.js";

/**
 * « Missions MIMT »: GET /v1/missions (read-only). There is deliberately no route to claim or complete a mission:
 * rewards are granted by the routes and webhooks that see the event (services/missions.ts).
 */
export async function missionRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get("/v1/missions", { preHandler: requireUser(deps) }, async (req, reply): Promise<MissionsResponse> => {
    const { user, account } = await loadContext(deps, req);
    void reply.header("cache-control", "no-store");
    return missionsView(deps, account, user, req.log);
  });
}
