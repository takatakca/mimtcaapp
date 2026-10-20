import { planOf } from "../plansConfig.js";
import type { FastifyInstance } from "fastify";
import {
  ADD_ONS,
  FREE_PLAN_INTL_LIMITS,
  formatCad,
  PLANS,
  SUBSCRIPTION_ADD_ONS,
  TRIAL_DAYS,
  type BillingPortalResponse,
  type CheckoutRequest,
  type CheckoutResponse,
  type IapVerifyResponse,
  type PlanCode,
} from "@mimt/shared";
import type Stripe from "stripe";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser } from "../auth/guard.js";
import { badRequest, conflict, forbidden, HttpError, notConfigured } from "../lib/errors.js";
import { addDays } from "../lib/time.js";
import { parse } from "../lib/validate.js";
import type { Subscription, TelecomAccount, User } from "../repo/types.js";
import { getFeatures, getPlan, outboundBlocked, recomputeEntitlements, usagePeriods } from "../services/accounts.js";
import { redeemReferral, settleReferralOnPaidPlan } from "../services/referrals.js";
import { purchaseFromApplePayload, verifyAppleTransactionJws, verifyGoogleSubscription } from "../billing/iap.js";
import { quebecTaxLines } from "../billing/taxes.js";
import { BUSINESS_PLANS, businessSubscription } from "../pbx/engine.js";
import type { CheckoutLine } from "../gateways/billing.js";

const CheckoutBody = z
  .object({
    plan: z.enum(["lock", "premium", "business", "business_pro"]).optional(),
    addon: z.enum(["extra_number", "minutes_250", "intl_credit", "no_ads"]).optional(),
    interval: z.enum(["month", "year"]).default("month"),
    quantity: z.number().int().min(1).max(50).default(1),
    /** International credit amount, CAD cents. */
    amountCents: z.number().int().min(ADD_ONS.intl_credit_min.priceCents).max(10_000).optional(),
    referralCode: z.string().min(4).max(32).optional(),
    trial: z.boolean().optional(),
  })
  .refine((b) => Boolean(b.plan) !== Boolean(b.addon), "Pass exactly one of plan or addon");

const SUB_STATUSES = new Set<Subscription["status"]>(["active", "trialing", "past_due", "canceled", "incomplete", "unpaid"]);

export async function billingRoutes(app: FastifyInstance, deps: AppDeps) {
  const { repo, config } = deps;
  const auth = { preHandler: requireUser(deps) };
  const appUrl = config.APP_BASE_URL.replace(/\/$/, "");

  app.post("/v1/billing/checkout", auth, async (req): Promise<CheckoutResponse> => {
    const body = parse(CheckoutBody, req.body) satisfies CheckoutRequest;
    const { user, account } = await loadContext(deps, req);
    if (!deps.billing) throw notConfigured("Billing");
    const fr = user.locale === "fr-CA";
    const taxNote = fr ? "Prix avant taxes (TPS/TVQ et taxe 9-1-1 en sus)." : "Price before taxes (GST/QST and 9-1-1 tax extra).";

    let line: CheckoutLine;
    let mode: "subscription" | "payment";
    let code: string;
    if (body.trial) {
      // Optional 7-day Essentiel trial: off unless TRIAL_ENABLED, monthly only, once per account (any past plan).
      if (!config.TRIAL_ENABLED) throw badRequest("trial_unavailable", "Aucun essai gratuit n'est offert en ce moment.");
      if (body.plan !== "lock" || body.interval !== "month" || body.quantity !== 1) throw badRequest("trial_unavailable", "L'essai s'applique au forfait Essentiel mensuel.");
      if ((await repo.listSubscriptions(account.id)).some((s) => s.kind === "plan")) {
        throw conflict("trial_already_used", "L'essai gratuit est offert une seule fois par compte.");
      }
    }
    if (body.plan) {
      const plan = planOf(body.plan);
      const yearly = body.interval === "year";
      if (yearly && !plan.yearlyPriceCents) throw badRequest("no_yearly_price");
      if (!plan.perLine && body.quantity !== 1) throw badRequest("quantity_not_allowed");
      line = {
        name: `MIMT ${fr ? plan.name.fr : plan.name.en}`,
        description: taxNote,
        unitAmountCents: yearly ? plan.yearlyPriceCents! : plan.monthlyPriceCents,
        quantity: body.quantity,
        recurring: body.interval,
      };
      mode = "subscription";
      code = body.plan;
    } else if (body.addon === "extra_number") {
      const a = ADD_ONS.extra_number;
      line = { name: fr ? a.name.fr : a.name.en, description: taxNote, unitAmountCents: a.monthlyPriceCents, quantity: body.quantity, recurring: "month" };
      mode = "subscription";
      code = "extra_number";
    } else if (body.addon === "minutes_250") {
      const a = ADD_ONS.minutes_250;
      line = { name: fr ? a.name.fr : a.name.en, description: taxNote, unitAmountCents: a.priceCents, quantity: body.quantity };
      mode = "payment";
      code = "minutes_250";
    } else if (body.addon === "no_ads") {
      const a = SUBSCRIPTION_ADD_ONS.no_ads;
      const { features } = await getFeatures(repo, account.id);
      if (features.has("no_ads")) throw conflict("already_ad_free", "Votre forfait ne contient déjà aucune publicité.");
      if (body.quantity !== 1) throw badRequest("quantity_not_allowed");
      const yearly = body.interval === "year";
      line = {
        name: fr ? `MIMT ${a.name.fr}` : `MIMT ${a.name.en}`,
        description: taxNote,
        unitAmountCents: yearly ? a.yearlyPriceCents : a.monthlyPriceCents,
        quantity: 1,
        recurring: body.interval,
      };
      mode = "subscription";
      code = "no_ads";
    } else {
      const amountCents = body.amountCents ?? ADD_ONS.intl_credit_min.priceCents;
      if ((await getPlan(repo, account.id)) === "free") await checkFreeIntlTopUp(account, user, amountCents);
      const a = ADD_ONS.intl_credit_min;
      line = { name: fr ? a.name.fr : a.name.en, description: taxNote, unitAmountCents: amountCents, quantity: 1 };
      mode = "payment";
      code = "intl_credit";
    }

    if (body.referralCode) {
      const existing = await repo.referrals.getReferralForReferee(user.id);
      if (!existing) await redeemReferral(deps, { user, account, code: body.referralCode });
    }

    const customerId = account.stripeCustomerId ?? (await createCustomer(account, user.email, user.displayName, user.locale));
    const taxLines = quebecTaxLines({
      baseUnitCents: line.unitAmountCents,
      quantity: line.quantity,
      recurring: line.recurring ?? null,
      chargeE911: Boolean(body.plan) || body.addon === "extra_number",
      locale: user.locale,
    });
    const session = await deps.billing.createCheckout({
      customerId,
      mode,
      line,
      taxLines,
      metadata: { telecom_account_id: account.id, kind: body.plan ? "plan" : "addon", code },
      successUrl: `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${appUrl}/billing/cancel`,
      locale: user.locale,
      ...(body.trial ? { trialDays: TRIAL_DAYS } : {}),
    });
    return { checkoutUrl: session.url, sessionId: session.id };
  });

  /** International credit on the free plan (parity P1 item 9): small top-ups, small balance, clean accounts only. */
  async function checkFreeIntlTopUp(account: TelecomAccount, user: User, amountCents: number) {
    if (outboundBlocked(account) || account.riskTier === "high") throw forbidden("account_restricted", "Ce compte ne peut pas acheter de crédit international.");
    if (!user.phoneVerifiedAt) throw forbidden("phone_verification_required", "Confirmez votre numéro de cellulaire avant d'acheter du crédit.");
    if (amountCents > FREE_PLAN_INTL_LIMITS.maxTopUpCents) {
      throw badRequest("intl_topup_too_large", `Forfait Gratuit : ${formatCad(FREE_PLAN_INTL_LIMITS.maxTopUpCents)} maximum par recharge.`);
    }
    if (account.intlCreditCents + amountCents > FREE_PLAN_INTL_LIMITS.maxBalanceCents) {
      throw conflict("intl_balance_limit", `Forfait Gratuit : solde maximal de ${formatCad(FREE_PLAN_INTL_LIMITS.maxBalanceCents)}.`);
    }
    const ok = await deps.rateLimiter.take(`intl-topup:free:${account.id}`, { capacity: FREE_PLAN_INTL_LIMITS.checkoutsPerDay, windowSeconds: 86_400 });
    if (!ok) {
      await repo.addFraudEvent({ telecomAccountId: account.id, rule: "free_intl_topup_rate", score: 20, action: "hold", details: { amountCents } });
      throw new HttpError(429, "intl_topup_rate_limited", "Trop de recharges aujourd'hui. Réessayez demain.");
    }
  }

  async function createCustomer(account: TelecomAccount, email: string | null, name: string | null, locale: string) {
    const id = await deps.billing!.createCustomer({ accountId: account.id, email, name, locale });
    await repo.updateAccount(account.id, { stripeCustomerId: id });
    return id;
  }

  app.get("/v1/billing/portal", auth, async (req): Promise<BillingPortalResponse> => {
    const { account } = await loadContext(deps, req);
    if (!deps.billing) throw notConfigured("Billing");
    if (!account.stripeCustomerId) throw conflict("no_billing_account");
    return { portalUrl: await deps.billing.createPortal(account.stripeCustomerId, `${appUrl}/settings/billing`) };
  });

  const IapBody = z.object({
    platform: z.enum(["ios", "android"]),
    productId: z.string().min(1).max(200),
    transaction: z.string().min(20).max(20_000),
  });

  app.post("/v1/billing/iap/verify", auth, async (req) => {
    const body = parse(IapBody, req.body);
    const { account } = await loadContext(deps, req);
    let purchase;
    if (body.platform === "ios") {
      if (!config.APPLE_ROOT_CA_PEM) throw notConfigured("App Store");
      let payload: Record<string, unknown>;
      try {
        payload = await verifyAppleTransactionJws(body.transaction, config.APPLE_ROOT_CA_PEM);
      } catch {
        throw badRequest("invalid_receipt", "Le reçu Apple n'a pas pu être vérifié.");
      }
      purchase = purchaseFromApplePayload(payload, deps.now(), config.APPLE_BUNDLE_ID);
      if (purchase && payload.productId !== body.productId) purchase = null;
    } else {
      if (!config.GOOGLE_PLAY_PACKAGE_NAME || !config.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) throw notConfigured("Google Play");
      purchase = await verifyGoogleSubscription({
        packageName: config.GOOGLE_PLAY_PACKAGE_NAME,
        productId: body.productId,
        purchaseToken: body.transaction,
        serviceAccountJson: config.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON,
      });
    }
    const sku = purchase?.plan ? { kind: "plan" as const, code: purchase.plan } : purchase?.addon ? { kind: "addon" as const, code: purchase.addon } : null;
    if (!purchase || !sku) throw badRequest("unknown_product", "Ce produit n'est pas un forfait MIMT.");
    await repo.upsertSubscription({
      telecomAccountId: account.id,
      kind: sku.kind,
      code: sku.code,
      quantity: 1,
      stripeSubscriptionId: `${body.platform}:${purchase.transactionId}`,
      status: purchase.status,
      source: body.platform === "ios" ? "iap_apple" : "iap_google",
      currentPeriodEnd: purchase.currentPeriodEnd,
    });
    await recomputeEntitlements(repo, account);
    const res: IapVerifyResponse = {
      ...(purchase.plan ? { plan: purchase.plan } : {}),
      ...(purchase.addon ? { addon: purchase.addon } : {}),
      status: purchase.status,
      currentPeriodEnd: purchase.currentPeriodEnd?.toISOString() ?? null,
    };
    return res;
  });

  // Stripe webhook: needs the raw body for signature verification, so JSON parsing is overridden in this scope only.
  await app.register(async (scope) => {
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

    scope.post("/webhooks/stripe", { config: { rateLimit: false } }, async (req, reply) => {
      if (!deps.billing) throw notConfigured("Billing");
      const signature = req.headers["stripe-signature"];
      if (typeof signature !== "string" || !Buffer.isBuffer(req.body)) throw new HttpError(400, "invalid_signature");
      let event: Stripe.Event;
      try {
        event = deps.billing.constructEvent(req.body, signature);
      } catch {
        throw new HttpError(400, "invalid_signature", "Stripe signature verification failed");
      }
      if (!(await repo.useOnce(`stripe:${event.id}`, addDays(deps.now(), 30)))) return reply.code(200).send({ received: true, duplicate: true });
      await handleStripeEvent(event);
      return { received: true };
    });
  });

  async function accountFor(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null, metadata?: Stripe.Metadata | null) {
    const byMeta = metadata?.telecom_account_id ? await repo.getAccount(metadata.telecom_account_id) : null;
    if (byMeta) return byMeta;
    const id = typeof customer === "string" ? customer : customer?.id;
    return id ? repo.findAccountByStripeCustomer(id) : null;
  }

  async function syncSubscription(sub: Stripe.Subscription) {
    const account = await accountFor(sub.customer, sub.metadata);
    if (!account) return app.log.warn({ subscription: sub.id }, "Stripe subscription for unknown account");
    const kind = sub.metadata.kind === "addon" ? "addon" : "plan";
    const code = sub.metadata.code ?? "free";
    if (kind === "plan" && !(code in PLANS)) return app.log.warn({ subscription: sub.id, code }, "Stripe subscription with unknown plan");
    const item = sub.items.data[0];
    const periodEnd = item?.current_period_end;
    await repo.upsertSubscription({
      telecomAccountId: account.id,
      kind,
      code: kind === "plan" ? (code as PlanCode) : code,
      quantity: item?.quantity ?? 1,
      stripeSubscriptionId: sub.id,
      status: SUB_STATUSES.has(sub.status as Subscription["status"]) ? (sub.status as Subscription["status"]) : "incomplete",
      source: "stripe",
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    });
    await recomputeEntitlements(repo, account);
    if (kind === "plan" && BUSINESS_PLANS.has(code as PlanCode)) await syncBusinessSeats(account, sub, item?.quantity ?? 1);
  }

  /**
   * PBX-01: Stripe is the source of truth for MIMT Affaires lines. The seat count follows the quantity of the
   * business subscription that counts (a stale event of an old subscription never overwrites the live one).
   * Plan status comes from the subscription row: past_due = payment attention (service continues),
   * canceled/unpaid = business outbound calls refused by the PBX engine (inbound and 9-1-1 unchanged).
   */
  async function syncBusinessSeats(account: TelecomAccount, sub: Stripe.Subscription, quantity: number) {
    const business = await repo.pbx.getBusinessByAccount(account.id);
    if (!business) return;
    const current = businessSubscription(await repo.listSubscriptions(account.id));
    if (current && current.stripeSubscriptionId !== sub.id) return;
    const before = await repo.pbx.getSeats(business.id);
    const seats = Math.min(500, Math.max(1, quantity));
    await repo.pbx.setSeats(business.id, seats, sub.id);
    await repo.audit({
      actorUserId: null,
      action: "business.billing_synced",
      targetType: "business",
      targetId: business.id,
      meta: { status: sub.status, seats, previousSeats: before.seats, paymentAttention: sub.status === "past_due" },
    });
  }

  /** Stores the card fingerprint of a paid invoice/payment (referral anti-fraud). Never fails the webhook. */
  async function recordFingerprint(account: TelecomAccount, ref: { invoiceId?: string; paymentIntentId?: string }): Promise<string | null> {
    if (!deps.billing?.paymentFingerprint) return null;
    try {
      const fingerprint = await deps.billing.paymentFingerprint(ref);
      if (fingerprint) await repo.referrals.addPaymentFingerprint(account.id, fingerprint, deps.now());
      return fingerprint;
    } catch (err) {
      app.log.warn({ err, account: account.id }, "could not read the payment fingerprint");
      return null;
    }
  }

  async function handleStripeEvent(event: Stripe.Event) {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        const account = await accountFor(s.customer, s.metadata);
        if (!account) return app.log.warn({ session: s.id }, "Checkout for unknown account");
        if (s.mode === "subscription" && typeof s.subscription === "string") {
          await syncSubscription(await deps.billing!.retrieveSubscription(s.subscription));
        } else if (s.mode === "payment" && s.payment_status === "paid") {
          const pi = typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? null);
          if (pi) await recordFingerprint(account, { paymentIntentId: pi });
          if (s.metadata?.code === "minutes_250") {
            const packs = Math.max(1, Math.round((s.amount_subtotal ?? ADD_ONS.minutes_250.priceCents) / ADD_ONS.minutes_250.priceCents));
            await repo.addUsage(account.id, usagePeriods(deps.now()).slice(0, 1), { bonusMinutesOut: 250 * packs });
          } else if (s.metadata?.code === "intl_credit") {
            await repo.addIntlCredit(account.id, s.amount_subtotal ?? 0);
            await repo.replaceEntitlements(account.id, "intl_credit", [{ feature: "intl_calling", limit: null }]);
            await recomputeEntitlements(repo, account);
          }
        }
        await repo.audit({ actorUserId: null, action: "billing.checkout_completed", targetType: "telecom_account", targetId: account.id, meta: { code: s.metadata?.code } });
        return;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        return syncSubscription(event.data.object);
      case "invoice.paid": {
        // Referral program: the referee's first paid plan invoice settles the referral (reward or fraud refusal).
        const inv = event.data.object;
        const meta = inv.parent?.subscription_details?.metadata ?? null;
        const account = await accountFor(inv.customer, meta);
        if (!account || !inv.amount_paid || inv.amount_paid <= 0) return;
        const fingerprint = inv.id ? await recordFingerprint(account, { invoiceId: inv.id }) : null;
        if (meta?.kind === "plan" && meta.code && meta.code !== "free" && meta.code in PLANS) {
          const outcome = await settleReferralOnPaidPlan(deps, { account, fingerprint });
          if (outcome) app.log.info({ account: account.id, outcome }, "referral settled");
        }
        return;
      }
      default:
        return;
    }
  }
}
