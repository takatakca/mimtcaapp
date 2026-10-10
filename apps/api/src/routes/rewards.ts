import type { FastifyInstance } from "fastify";
import type { RewardClaimResponse } from "@mimt/shared";
import { z } from "zod";
import { parseAdmobQuery, verifyAdmobSignature } from "../ads/ssv.js";
import type { AppDeps } from "../deps.js";
import { requireUser } from "../auth/guard.js";
import { conflict } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { usagePeriods } from "../services/accounts.js";

const ClaimBody = z.object({ kind: z.literal("rewarded_ad_10min"), adUnitId: z.string().min(1).max(200) });
const REWARD_MINUTES = 10;
const MAX_REWARDS_PER_DAY = 5;
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function startOfUtcDay(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function rewardRoutes(app: FastifyInstance, deps: AppDeps) {
  const { repo } = deps;

  // Google calls this. The client is never trusted to say an ad finished.
  app.get("/webhooks/admob/ssv", { config: { rateLimit: false } }, async (req, reply) => {
    const raw = req.url.split("?")[1] ?? "";
    const parsed = parseAdmobQuery(raw);
    if (!parsed.signature || !parsed.keyId) return reply.code(400).send({ error: "invalid_signature" });
    const keys = await deps.admobKeys().catch(() => null);
    const pem = keys?.get(parsed.keyId);
    if (!pem || !verifyAdmobSignature(parsed.message, parsed.signature, pem)) {
      return reply.code(403).send({ error: "invalid_signature" });
    }
    const userId = parsed.params.get("custom_data") || parsed.params.get("user_id") || "";
    const transactionId = parsed.params.get("transaction_id") ?? "";
    if (!USER_ID.test(userId) || transactionId.length < 8 || transactionId.length > 200) return reply.code(204).send();
    const user = await repo.getUser(userId);
    const account = user ? await repo.getAccountByOwner(user.id) : null;
    if (!user || !account) return reply.code(204).send();
    const now = deps.now();
    if ((await repo.countAdRewardsSince(user.id, startOfUtcDay(now))) >= MAX_REWARDS_PER_DAY) return reply.code(204).send();
    const granted = await repo.grantAdReward({ userId: user.id, transactionId, minutes: REWARD_MINUTES, createdAt: now });
    if (!granted) return reply.code(204).send();
    await repo.addUsage(account.id, usagePeriods(now), { bonusMinutesOut: REWARD_MINUTES });
    await repo.audit({ actorUserId: user.id, action: "reward.verified", targetType: "user", targetId: user.id, meta: { minutes: REWARD_MINUTES } });
    return reply.code(204).send();
  });

  app.post("/v1/rewards/claim", { preHandler: requireUser(deps) }, async (req): Promise<RewardClaimResponse> => {
    parse(ClaimBody, req.body);
    const reward = await repo.claimAdReward(req.userId, deps.now());
    if (!reward) {
      throw conflict("reward_pending", "La vérification de la publicité n'est pas encore arrivée. Réessayez dans un instant.");
    }
    return { creditedMinutes: reward.minutes };
  });
}
