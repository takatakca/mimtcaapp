import type { FastifyInstance } from "fastify";
import { isEmergencyNumber, type RateResponse } from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser } from "../auth/guard.js";
import { quoteRate } from "../billing/rates.js";
import { badRequest } from "../lib/errors.js";
import { classifyDestination, normalizeDialed } from "../lib/phone.js";
import { parse } from "../lib/validate.js";
import { getFeatures } from "../services/accounts.js";

const RateQuery = z.object({ to: z.string().min(2).max(32) });

/** GET /v1/rates?to=+E164: the per-minute price and whether this account can call it, shown before dialling. */
export async function rateRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get("/v1/rates", { preHandler: requireUser(deps) }, async (req): Promise<RateResponse> => {
    const { to: raw } = parse(RateQuery, req.query);
    const { account } = await loadContext(deps, req);
    const trimmed = raw.trim();
    const to = isEmergencyNumber(trimmed) ? "911" : normalizeDialed(trimmed);
    if (!to || (to !== "911" && classifyDestination(to) === "invalid")) throw badRequest("invalid_number", "Le numéro composé n'est pas valide.");
    const { plan, features } = await getFeatures(deps.repo, account.id);
    return quoteRate({
      to,
      plan,
      intlEntitled: features.has("intl_calling"),
      creditCents: account.intlCreditCents,
      defaultCents: deps.config.INTL_ASSUMED_RATE_CENTS_PER_MIN,
    });
  });
}
