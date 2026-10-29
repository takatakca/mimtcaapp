import { planOf } from "../plansConfig.js";
import type { FastifyInstance } from "fastify";
import {
  ADD_ONS,
  FREE_PLAN_INTL_LIMITS,
  formatCad,
  PLANS,
  storeAddOnProduct,
  storeProduct,
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
import {
  createStoreVerifier,
  googleTransactionId,
  purchaseFromApplePayload,
  storeRowId,
  type GooglePurchase,
  type StorePurchase,
} from "../billing/iap.js";
import { safeEqual } from "../lib/crypto.js";
import { quebecTaxLines } from "../billing/taxes.js";
import { BUSINESS_PLANS, businessSubscription } from "../pbx/engine.js";
import { checkHoldForCheckout } from "../services/numberHoldCheckout.js";
import { provisionHeldNumber } from "../services/numberProvisioning.js";
import { grantMission } from "../services/missions.js";
import { clawbackInvoicePoints, clawbackStorePoints, earnInvoicePoints, earnStorePoints, storePeriodPriceCents } from "../services/points.js";
import {
  attributeAccount,
  attributeFromHold,
  invoiceNetRevenueCents,
  recordAffiliateCommission,
  reverseAffiliateCommission,
} from "../services/affiliates.js";
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
    numberHold: z.object({ id: z.string().uuid(), token: z.string().min(16).max(128) }).optional(),
    trial: z.boolean().optional(),
    affiliate: z.object({ code: z.string().min(4).max(32), touchedAt: z.iso.datetime().optional() }).optional(),
  })
  .refine((b) => Boolean(b.plan) !== Boolean(b.addon), "Pass exactly one of plan or addon")
  .refine((b) => !b.numberHold || Boolean(b.plan), "A held number is bought with a plan");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

    // Live picker: the held number must still be ours and the account ready to own a number (9-1-1, verification).
    const hold = body.numberHold ? await checkHoldForCheckout(deps, { user, account, ...body.numberHold }) : null;

    // Affiliate program: who brought this customer, recorded server-side before the payment (first touch wins).
    try {
      if (hold) await attributeFromHold(deps, { user, account, holdId: hold.id });
      if (body.affiliate) {
        const touchedAt = body.affiliate.touchedAt ? new Date(body.affiliate.touchedAt) : null;
        await attributeAccount(deps, { user, account, code: body.affiliate.code, touchedAt, source: "checkout" });
      }
    } catch (err) {
      app.log.warn({ err: err instanceof Error ? err.message : "error" }, "affiliate attribution failed; checkout continues");
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
      metadata: { telecom_account_id: account.id, kind: body.plan ? "plan" : "addon", code, ...(line.recurring ? { interval: line.recurring } : {}), ...(hold ? { number_hold_id: hold.id } : {}) },
      successUrl: `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${appUrl}/billing/cancel`,
      locale: user.locale,
      ...(hold ? { expiresAt: hold.checkoutExpiresAt } : {}),
      ...(body.trial ? { trialDays: TRIAL_DAYS } : {}),
    });
    if (hold && !(await repo.numberHolds.startCheckout(hold.id, { telecomAccountId: account.id, checkoutSessionId: session.id, expiresAt: hold.checkoutExpiresAt, now: deps.now() }))) {
      throw conflict("hold_expired", "La réservation de ce numéro a expiré. Choisissez-en un autre.");
    }
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

  // ---------------------------------------------------------------- in-app purchases (native apps only)
  // The iOS/Android apps sell through StoreKit / Play Billing; the web keeps Stripe above. Both write the same
  // subscriptions rows of the same account, so a plan bought on either channel is active everywhere.
  const store = deps.store ?? createStoreVerifier(config);

  const IapBody = z.object({
    platform: z.enum(["ios", "android"]),
    productId: z.string().min(1).max(200),
    transaction: z.string().min(20).max(20_000),
  });

  /**
   * Writes a verified store purchase on `account`. Refuses a purchase already linked to another MIMT account.
   * `paidKey`: set when this verification is a PAID period (a purchase or a renewal, not a grace period or a free
   * offer): MIMT Points are credited once per key (services/points.ts).
   */
  async function saveStorePurchase(account: TelecomAccount, platform: "ios" | "android", purchase: StorePurchase, productId: string, paidKey?: string | null) {
    const sku = purchase.plan ? { kind: "plan" as const, code: purchase.plan } : purchase.addon ? { kind: "addon" as const, code: purchase.addon } : null;
    if (!sku) throw badRequest("unknown_product", "Ce produit n'est pas un forfait MIMT.");
    const rowId = storeRowId(platform, purchase.transactionId);
    const existing = await repo.findSubscriptionByExternalId(rowId);
    // One App Store / Google Play subscription pays for one MIMT account (restoring it on a second account is refused).
    if (existing && existing.telecomAccountId !== account.id) throw conflict("store_purchase_linked", "Cet achat est déjà lié à un autre compte MIMT.");
    await repo.upsertSubscription({
      telecomAccountId: account.id,
      kind: sku.kind,
      code: sku.code,
      quantity: 1,
      stripeSubscriptionId: rowId,
      status: purchase.status,
      source: platform === "ios" ? "iap_apple" : "iap_google",
      currentPeriodEnd: purchase.currentPeriodEnd,
    });
    await recomputeEntitlements(repo, account);
    // Mission « Passez à l'annuel »: a verified yearly App Store / Google Play plan.
    if (sku.kind === "plan" && purchase.status === "active" && storeProduct(productId)?.interval === "year") {
      await grantMission(deps, { account, mission: "go_yearly", sourceRef: `${platform}:yearly`, log: app.log });
    }
    // MIMT Points for a verified paid period, at MIMT's list price of the SKU (before taxes).
    const interval = storeProduct(productId)?.interval ?? storeAddOnProduct(productId)?.interval;
    if (paidKey && purchase.status === "active" && interval) {
      const priceCents = storePeriodPriceCents(sku.kind, sku.code, interval, sku.kind === "addon" && sku.code in SUBSCRIPTION_ADD_ONS ? SUBSCRIPTION_ADD_ONS[sku.code as keyof typeof SUBSCRIPTION_ADD_ONS] : null);
      await earnStorePoints(deps, account, { key: paidKey, priceCents, interval }, app.log);
    }
  }

  /** Points key of a paid App Store transaction (each renewal has its own transactionId); null for a free offer. */
  const applePaidKey = (tx: Record<string, unknown>): string | null =>
    typeof tx.transactionId === "string" && tx.transactionId && tx.price !== 0 ? `store:ios:${tx.transactionId}` : null;
  /** Points key of a Google Play period: the purchase token prefix and the period end (one per renewal). */
  const googlePaidKey = (purchase: StorePurchase): string | null =>
    purchase.currentPeriodEnd ? `store:android:${purchase.transactionId}:${purchase.currentPeriodEnd.getTime()}` : null;

  async function cancelLinkedGoogleRow(accountId: string, linkedPurchaseToken: string) {
    const old = await repo.findSubscriptionByExternalId(storeRowId("android", googleTransactionId(linkedPurchaseToken)));
    if (!old || old.telecomAccountId !== accountId || old.status === "canceled") return;
    const { id: _id, createdAt: _createdAt, ...fields } = old;
    await repo.upsertSubscription({ ...fields, status: "canceled" });
  }

  app.post("/v1/billing/iap/verify", auth, async (req) => {
    const body = parse(IapBody, req.body);
    const { account } = await loadContext(deps, req);
    let purchase: StorePurchase | GooglePurchase | null;
    let paidKey: string | null = null;
    if (body.platform === "ios") {
      if (!config.APPLE_ROOT_CA_PEM) throw notConfigured("App Store");
      let payload: Record<string, unknown>;
      try {
        payload = await store.appleJws(body.transaction);
      } catch {
        throw badRequest("invalid_receipt", "Le reçu Apple n'a pas pu être vérifié.");
      }
      purchase = purchaseFromApplePayload(payload, deps.now(), config.APPLE_BUNDLE_ID);
      if (purchase && payload.productId !== body.productId) purchase = null;
      if (purchase) paidKey = applePaidKey(payload);
    } else {
      if (!config.GOOGLE_PLAY_PACKAGE_NAME || !config.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) throw notConfigured("Google Play");
      purchase = await store.google(body.productId, body.transaction);
    }
    if (!purchase || (!purchase.plan && !purchase.addon)) throw badRequest("unknown_product", "Ce produit n'est pas un forfait MIMT.");
    // The app tags each purchase with the account id. A receipt tagged for another account is not reusable here.
    if (purchase.accountToken && purchase.accountToken !== account.id.toLowerCase()) {
      throw conflict("store_purchase_linked", "Cet achat est déjà lié à un autre compte MIMT.");
    }
    if (body.platform === "android") paidKey = googlePaidKey(purchase);
    await saveStorePurchase(account, body.platform, purchase, body.productId, paidKey);
    if ("acknowledged" in purchase) {
      // An upgrade or downgrade replaces the previous Play subscription: that row stops counting.
      if (purchase.linkedPurchaseToken) {
        await cancelLinkedGoogleRow(account.id, purchase.linkedPurchaseToken);
        await recomputeEntitlements(repo, account);
      }
      // Acknowledged here, once the entitlement is saved; the app's own acknowledgement then changes nothing.
      if (!purchase.acknowledged && purchase.status === "active") {
        await store.googleAcknowledge(body.productId, body.transaction).catch((err: unknown) =>
          app.log.warn({ err: err instanceof Error ? err.message : "error" }, "Google Play acknowledge failed; the app acknowledges too"),
        );
      }
    }
    const res: IapVerifyResponse = {
      ...(purchase.plan ? { plan: purchase.plan } : {}),
      ...(purchase.addon ? { addon: purchase.addon } : {}),
      status: purchase.status,
      currentPeriodEnd: purchase.currentPeriodEnd?.toISOString() ?? null,
    };
    return res;
  });

  /** Account of a store notification: the row already saved, else the account id the app attached to the purchase. */
  async function storeAccount(rowId: string, accountToken: string | null | undefined): Promise<TelecomAccount | null> {
    const row = await repo.findSubscriptionByExternalId(rowId);
    if (row) return repo.getAccount(row.telecomAccountId);
    return accountToken && UUID.test(accountToken) ? repo.getAccount(accountToken) : null;
  }

  /** A notification for a purchase linked to another account changes nothing (409 from saveStorePurchase). */
  async function saveNotified(account: TelecomAccount, platform: "ios" | "android", purchase: StorePurchase, productId: string, paidKey?: string | null): Promise<boolean> {
    try {
      await saveStorePurchase(account, platform, purchase, productId, paidKey);
      return true;
    } catch (err) {
      if (err instanceof HttpError && err.statusCode === 409) return false;
      throw err;
    }
  }

  /**
   * App Store Server Notifications V2 (renewals, expirations, refunds, revocations). Set this URL in App Store
   * Connect for Production and Sandbox. Every payload is a JWS signed by Apple (x5c chain to the pinned root).
   */
  const AppleNotification = z.object({ signedPayload: z.string().min(20).max(100_000) });
  const APPLE_ENDED = new Set(["EXPIRED", "GRACE_PERIOD_EXPIRED", "REFUND", "REVOKE"]);
  app.post("/webhooks/appstore", { config: { rateLimit: false } }, async (req) => {
    if (!config.APPLE_ROOT_CA_PEM) throw notConfigured("App Store");
    const { signedPayload } = parse(AppleNotification, req.body);
    let note: Record<string, unknown>;
    let data: Record<string, unknown>;
    try {
      note = await store.appleJws(signedPayload);
      data = (note.data ?? {}) as Record<string, unknown>;
    } catch {
      throw badRequest("invalid_signature", "App Store notification signature verification failed");
    }
    if (config.APPLE_BUNDLE_ID && data.bundleId !== config.APPLE_BUNDLE_ID) return { received: true, ignored: "bundle" };
    if (typeof data.signedTransactionInfo !== "string") return { received: true, ignored: "no_transaction" };
    let tx: Record<string, unknown>;
    let renewal: Record<string, unknown> | null = null;
    try {
      tx = await store.appleJws(data.signedTransactionInfo);
      if (typeof data.signedRenewalInfo === "string") renewal = await store.appleJws(data.signedRenewalInfo);
    } catch {
      throw badRequest("invalid_signature", "App Store notification signature verification failed");
    }
    const uuid = typeof note.notificationUUID === "string" ? note.notificationUUID : null;
    if (uuid && !(await repo.useOnce(`appstore:${uuid}`, addDays(deps.now(), 30)))) return { received: true, duplicate: true };
    const purchase = purchaseFromApplePayload(tx, deps.now(), config.APPLE_BUNDLE_ID);
    if (!purchase) return { received: true, ignored: "product" };
    const type = String(note.notificationType ?? "");
    if (APPLE_ENDED.has(type)) purchase.status = "canceled";
    // Refunded by Apple: the points of that transaction are taken back (REVOKE is Family Sharing removed, not a
    // refund: the purchaser paid, nothing to take back).
    if (type === "REFUND" && typeof tx.transactionId === "string" && tx.transactionId) {
      await clawbackStorePoints(deps, { platform: "ios", transactionId: tx.transactionId }, app.log);
    }
    // Billing retry inside Apple's grace period: access continues until gracePeriodExpiresDate.
    if (type === "DID_FAIL_TO_RENEW" && note.subtype === "GRACE_PERIOD" && typeof renewal?.gracePeriodExpiresDate === "number") {
      purchase.status = "active";
      purchase.currentPeriodEnd = new Date(renewal.gracePeriodExpiresDate);
    }
    const account = await storeAccount(storeRowId("ios", purchase.transactionId), purchase.accountToken);
    if (!account) return { received: true, ignored: "unknown_account" };
    // Points only for a paid period: a first purchase or a renewal (not a grace period, an expiry or a refund).
    const paid = type === "SUBSCRIBED" || type === "DID_RENEW" ? applePaidKey(tx) : null;
    if (!(await saveNotified(account, "ios", purchase, String(tx.productId ?? ""), paid))) return { received: true, ignored: "linked_elsewhere" };
    return { received: true };
  });

  /**
   * Google Play Real-time developer notifications, through a Cloud Pub/Sub push subscription to
   * /webhooks/google-play?token=<GOOGLE_PLAY_RTDN_TOKEN>. The message is only a hint: the purchase is re-read from
   * the Play Developer API before anything changes.
   */
  const PubSubPush = z.object({ message: z.object({ data: z.string().max(20_000).optional(), messageId: z.string().max(200).optional() }) });
  app.post("/webhooks/google-play", { config: { rateLimit: false } }, async (req) => {
    if (!config.GOOGLE_PLAY_RTDN_TOKEN || !config.GOOGLE_PLAY_PACKAGE_NAME || !config.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) throw notConfigured("Google Play");
    const token = (req.query as Record<string, unknown>).token;
    if (typeof token !== "string" || !safeEqual(token, config.GOOGLE_PLAY_RTDN_TOKEN)) throw new HttpError(401, "invalid_token");
    const { message } = parse(PubSubPush, req.body);
    let data: {
      packageName?: string;
      subscriptionNotification?: { purchaseToken?: string; subscriptionId?: string; notificationType?: number };
      voidedPurchaseNotification?: { purchaseToken?: string };
    };
    try {
      data = JSON.parse(Buffer.from(message.data ?? "", "base64").toString("utf8")) as typeof data;
    } catch {
      return { received: true, ignored: "malformed" };
    }
    if (data.packageName !== config.GOOGLE_PLAY_PACKAGE_NAME) return { received: true, ignored: "package" };
    if (message.messageId && !(await repo.useOnce(`play:${message.messageId}`, addDays(deps.now(), 30)))) return { received: true, duplicate: true };

    const voided = data.voidedPurchaseNotification?.purchaseToken;
    if (voided) {
      // Refund or chargeback: that purchase gives no access any more.
      const row = await repo.findSubscriptionByExternalId(storeRowId("android", googleTransactionId(voided)));
      // MIMT Points of the latest paid period of that purchase are taken back (once: key per period).
      if (row) await clawbackStorePoints(deps, { platform: "android", accountId: row.telecomAccountId, transactionId: googleTransactionId(voided) }, app.log);
      if (row && row.status !== "canceled") {
        const { id: _id, createdAt: _createdAt, ...fields } = row;
        await repo.upsertSubscription({ ...fields, status: "canceled" });
        const account = await repo.getAccount(row.telecomAccountId);
        if (account) await recomputeEntitlements(repo, account);
      }
      return { received: true };
    }
    const sub = data.subscriptionNotification;
    if (!sub?.purchaseToken || !sub.subscriptionId) return { received: true, ignored: "not_subscription" };
    const purchase = await store.google(sub.subscriptionId, sub.purchaseToken);
    if (!purchase) return { received: true, ignored: "product" };
    const account = await storeAccount(storeRowId("android", purchase.transactionId), purchase.accountToken);
    if (!account) return { received: true, ignored: "unknown_account" };
    // Points only for a paid period: SUBSCRIPTION_RENEWED (2) or SUBSCRIPTION_PURCHASED (4).
    const paid = sub.notificationType === 2 || sub.notificationType === 4 ? googlePaidKey(purchase) : null;
    if (!(await saveNotified(account, "android", purchase, sub.subscriptionId, paid))) return { received: true, ignored: "linked_elsewhere" };
    if (purchase.linkedPurchaseToken) {
      await cancelLinkedGoogleRow(account.id, purchase.linkedPurchaseToken);
      await recomputeEntitlements(repo, account);
    }
    if (!purchase.acknowledged && purchase.status === "active") await store.googleAcknowledge(sub.subscriptionId, sub.purchaseToken);
    return { received: true };
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
    // Mission « Passez à l'annuel »: a yearly plan Stripe reports as paid. The reward is the free month in the price.
    if (kind === "plan" && code !== "free" && item?.price?.recurring?.interval === "year" && sub.status === "active") {
      await grantMission(deps, { account, mission: "go_yearly", sourceRef: `stripe:${sub.id}`, log: app.log });
    }
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
          // Number picked in the live picker: bought now that the plan is paid.
          if (s.metadata?.number_hold_id) await provisionHeldNumber(deps, s.metadata.number_hold_id, account);
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
      case "checkout.session.expired": {
        // Abandoned checkout: the held number goes back to the picker right away.
        const holdId = event.data.object.metadata?.number_hold_id;
        if (holdId) await repo.numberHolds.finish(holdId, "released");
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
        // MIMT Points: 10 points per dollar paid before taxes, once per invoice (key: the invoice id).
        const interval = meta?.interval === "year" || meta?.interval === "month" ? meta.interval : undefined;
        await earnInvoicePoints(deps, account, inv, interval, app.log);
        // Affiliate program: commission on every paid subscription invoice of a referred customer (net of taxes).
        if (inv.id) {
          const paidAt = inv.status_transitions?.paid_at ? new Date(inv.status_transitions.paid_at * 1000) : deps.now();
          await recordAffiliateCommission(deps, { account, invoiceId: inv.id, netRevenueCents: invoiceNetRevenueCents(inv), paidAt, fingerprint }, app.log);
        }
        return;
      }
      case "charge.refunded":
      case "charge.dispute.created": {
        // A refund reverses in proportion, a chargeback reverses everything: the affiliate commission and the MIMT
        // Points the invoice earned (services/points.ts clawbackInvoicePoints, idempotent per refund state).
        const obj = event.data.object;
        const pi = typeof obj.payment_intent === "string" ? obj.payment_intent : (obj.payment_intent?.id ?? null);
        if (!pi || !deps.billing?.invoiceIdForPayment) return;
        const invoiceId = await deps.billing.invoiceIdForPayment(pi);
        if (!invoiceId) return;
        if (event.type === "charge.refunded") {
          const charge = event.data.object;
          await reverseAffiliateCommission(deps, { invoiceId, reason: "refund", refundedCents: charge.amount_refunded, amountCents: charge.amount });
          await clawbackInvoicePoints(deps, { invoiceId, reason: "refund", refundedCents: charge.amount_refunded, amountCents: charge.amount }, app.log);
        } else {
          await reverseAffiliateCommission(deps, { invoiceId, reason: "chargeback" });
          await clawbackInvoicePoints(deps, { invoiceId, reason: "chargeback" }, app.log);
        }
        return;
      }
      default:
        return;
    }
  }
}
