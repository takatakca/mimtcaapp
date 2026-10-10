import type { FastifyInstance } from "fastify";
import type { RedeemReferralResponse, ReferralsResponse } from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser } from "../auth/guard.js";
import { parse } from "../lib/validate.js";
import { ensureReferralCode, REFERRAL_REWARD, redeemReferral, referralDto } from "../services/referrals.js";

const SHARE_BASE = "https://mimt.ca/invitation/";
const DEVICE_KEY = /^[A-Za-z0-9_-]{8,256}$/;

const RedeemBody = z.object({
  code: z.string().min(4).max(32),
  deviceKey: z.string().regex(DEVICE_KEY).optional(),
});

/** Referral program: GET my code + status, POST redeem a friend's code (also accepted on the first checkout). */
export async function referralRoutes(app: FastifyInstance, deps: AppDeps) {
  const auth = { preHandler: requireUser(deps) };

  app.get("/v1/referrals", auth, async (req): Promise<ReferralsResponse> => {
    const { user } = await loadContext(deps, req);
    const [code, mine, referredBy] = await Promise.all([
      ensureReferralCode(deps, user.id),
      deps.repo.referrals.listReferralsByReferrer(user.id),
      deps.repo.referrals.getReferralForReferee(user.id),
    ]);
    return {
      code,
      shareUrl: SHARE_BASE + code,
      reward: { months: REFERRAL_REWARD.months, plan: REFERRAL_REWARD.plan },
      referrals: mine.map(referralDto),
      referredBy: referredBy ? referralDto(referredBy) : null,
    };
  });

  // Per-user rate limit on top of the global one: codes are short, so guessing is throttled.
  app.post("/v1/referrals/redeem", { ...auth, config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply): Promise<RedeemReferralResponse> => {
    const body = parse(RedeemBody, req.body);
    const { user, account } = await loadContext(deps, req);
    const row = await redeemReferral(deps, { user, account, code: body.code, ...(body.deviceKey ? { deviceKey: body.deviceKey } : {}) });
    reply.code(201);
    return referralDto(row);
  });
}
