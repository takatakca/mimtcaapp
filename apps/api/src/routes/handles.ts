import type { FastifyInstance } from "fastify";
import { MIMT_HANDLE, normalizeHandle, RESERVED_HANDLES, type HandleLookupResponse, type HandleResponse } from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser } from "../auth/guard.js";
import { badRequest, conflict, HttpError } from "../lib/errors.js";
import { parse } from "../lib/validate.js";

/** Looking up handles is rate limited so the directory cannot be scraped. */
const LOOKUP_RULE = { capacity: 30, windowSeconds: 600 };

/** MIMT handles (@nom): GET/PUT /v1/me/handle, GET /v1/handles/:handle. See packages/shared/src/handles.ts. */
export async function handleRoutes(app: FastifyInstance, deps: AppDeps) {
  const { repo } = deps;
  const auth = { preHandler: requireUser(deps) };

  app.get("/v1/me/handle", auth, async (req): Promise<HandleResponse> => {
    const { user } = await loadContext(deps, req);
    return { handle: (await repo.handles.forUser(user.id))?.handle ?? null };
  });

  app.put("/v1/me/handle", auth, async (req): Promise<HandleResponse> => {
    const { handle: raw } = parse(z.object({ handle: z.string().min(1).max(32) }), req.body);
    const { user, account } = await loadContext(deps, req);
    const handle = normalizeHandle(raw);
    if (!handle) throw badRequest("invalid_handle", "De 3 à 20 caractères : lettres minuscules, chiffres, point ou trait de soulignement.");
    if (RESERVED_HANDLES.has(handle)) throw conflict("handle_taken", "Cet identifiant n'est pas disponible.");
    const existing = await repo.handles.forUser(user.id);
    if (existing) {
      if (existing.handle === handle) return { handle };
      throw conflict("handle_already_set", "Votre identifiant MIMT est déjà choisi.");
    }
    const created = await repo.handles.create({ handle, userId: user.id, telecomAccountId: account.id });
    if (!created) throw conflict("handle_taken", "Cet identifiant n'est pas disponible.");
    await repo.audit({ actorUserId: user.id, action: "handle.created", targetType: "user", targetId: user.id, meta: {} });
    return { handle };
  });

  app.get("/v1/handles/:handle", auth, async (req): Promise<HandleLookupResponse> => {
    const { handle: raw } = parse(z.object({ handle: z.string().min(1).max(32) }), req.params);
    const { user } = await loadContext(deps, req);
    if (!(await deps.rateLimiter.take(`handle:lookup:${user.id}`, LOOKUP_RULE))) throw new HttpError(429, "rate_limited");
    const handle = normalizeHandle(raw);
    if (!handle || !MIMT_HANDLE.test(handle)) throw badRequest("invalid_handle");
    return { handle, exists: Boolean(await repo.handles.find(handle)) };
  });
}
