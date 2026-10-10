import type { PlanCode } from "@mimt/shared";
import { makeUser, type Ctx } from "./helpers.js";

/** Business-plan subscription (quantity = paid lines) on an account. */
export async function subscribe(ctx: Ctx, accountId: string, plan: PlanCode = "business", quantity = 5) {
  await ctx.repo.upsertSubscription({
    telecomAccountId: accountId,
    kind: "plan",
    code: plan,
    quantity,
    stripeSubscriptionId: `sub_${accountId.slice(0, 8)}`,
    status: "active",
    source: "stripe",
    currentPeriodEnd: null,
  });
}

/**
 * Owner with an active business plan, a business, a DID (+15145550100) held by the business account,
 * and one active member with extension 101.
 */
export async function makeBusiness(ctx: Ctx, opts: { plan?: PlanCode; did?: string } = {}) {
  const did = opts.did ?? "+15145550100";
  const owner = await makeUser(ctx, { e911: true, ack: true, number: did });
  await subscribe(ctx, owner.account.id, opts.plan ?? "business");
  const { pbx } = ctx.repo;
  const business = await pbx.createBusiness({ name: "Café Test", takatakBusinessId: null, telecomAccountId: owner.account.id, mainNumber: did, locale: "fr-CA" });
  await pbx.addMember({ businessId: business.id, userId: owner.user.id, email: "owner@test.ca", role: "owner", status: "active", invitedBy: null });

  const staff = await makeUser(ctx, { ack: true });
  await pbx.addMember({ businessId: business.id, userId: staff.user.id, email: "staff@test.ca", role: "member", status: "active", invitedBy: owner.user.id });
  const ext = await pbx.createExtension({
    businessId: business.id,
    number: "101",
    userId: staff.user.id,
    displayName: "Réception",
    voicemail: { enabled: true, greeting: null },
    forwardToMobile: null,
    did: null,
    ringTimeoutS: 20,
  });
  return { owner, staff, business, ext, didNumber: owner.number! };
}
