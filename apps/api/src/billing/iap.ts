// In-app purchases from the native apps (StoreKit 2 / Google Play Billing). The web keeps Stripe
// (routes/billing.ts); both write the same `subscriptions` rows, so entitlements are the same on every channel.
import { X509Certificate } from "node:crypto";
import { storeAddOnProduct, storeProduct, type PlanCode, type SubscriptionAddOnCode } from "@mimt/shared";
import { compactVerify, importX509 } from "jose";
import type { Config } from "../config.js";
import { googleAccessToken, readServiceAccount } from "../devices/verify.js";

/** Exactly one of plan (plan SKUs) or addon (add-on SKUs such as ca.mimt.app.noads.monthly) is set. */
export interface StorePurchase {
  plan?: Extract<PlanCode, "lock" | "premium">;
  addon?: SubscriptionAddOnCode;
  transactionId: string;
  status: "active" | "canceled";
  currentPeriodEnd: Date | null;
  /** Account the app attached to the purchase (Apple appAccountToken / Play obfuscatedAccountId). */
  accountToken?: string | null;
}

/** Google Play subscription, with what the API needs to acknowledge it and follow upgrades. */
export interface GooglePurchase extends StorePurchase {
  acknowledged: boolean;
  /** Token of the subscription this one replaced (upgrade, downgrade, resubscribe). */
  linkedPurchaseToken: string | null;
}

/** Store calls behind one interface, so the routes can be tested without Apple or Google. */
export interface StoreVerifier {
  /** Payload of a StoreKit 2 / App Store Server Notification JWS, after checking its x5c chain. Throws when invalid. */
  appleJws(jws: string): Promise<Record<string, unknown>>;
  /** Current state of a Play subscription, or null when the token or product is not a MIMT subscription. */
  google(productId: string, purchaseToken: string): Promise<GooglePurchase | null>;
  /** Acknowledges a Play subscription (Google refunds purchases left unacknowledged for 3 days). */
  googleAcknowledge(productId: string, purchaseToken: string): Promise<void>;
}

/** The subscriptions row id of a store purchase (kept in stripe_subscription_id, which is unique). */
export function storeRowId(platform: "ios" | "android", transactionId: string): string {
  return `${platform}:${transactionId}`;
}

/** Google purchase tokens are long; the row keeps a stable prefix. */
export const googleTransactionId = (purchaseToken: string) => purchaseToken.slice(0, 120);

/** Plan or add-on SKU, or undefined when the product is not a MIMT subscription. */
function storeSku(id: string): { plan: Extract<PlanCode, "lock" | "premium"> } | { addon: SubscriptionAddOnCode } | undefined {
  const plan = storeProduct(id);
  if (plan) return { plan: plan.plan };
  const addon = storeAddOnProduct(id);
  return addon ? { addon: addon.addon } : undefined;
}

function derToPem(derB64: string): string {
  const body = derB64.replace(/\s/g, "").match(/.{1,64}/g)?.join("\n") ?? derB64;
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----`;
}

/** Verifies a StoreKit 2 JWS: ES256, x5c chain, pinned Apple root. */
export async function verifyAppleTransactionJws(jws: string, trustedRootPem: string): Promise<Record<string, unknown>> {
  const headerPart = jws.split(".")[0];
  if (!headerPart) throw new Error("malformed");
  const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")) as { alg?: string; x5c?: string[] };
  if (header.alg !== "ES256" || !header.x5c?.length) throw new Error("missing_x5c");
  const certs = header.x5c.map((part) => new X509Certificate(derToPem(part)));
  for (let i = 0; i < certs.length - 1; i++) {
    if (!certs[i]!.verify(certs[i + 1]!.publicKey)) throw new Error("chain");
  }
  const root = new X509Certificate(trustedRootPem);
  const last = certs[certs.length - 1]!;
  const rooted = last.fingerprint256 === root.fingerprint256 || last.verify(root.publicKey);
  if (!rooted) throw new Error("root");
  const now = Date.now();
  if (new Date(certs[0]!.validFrom).getTime() > now || new Date(certs[0]!.validTo).getTime() < now) throw new Error("leaf_expired");
  const leafKey = await importX509(derToPem(header.x5c[0]!), "ES256");
  const { payload } = await compactVerify(jws, leafKey);
  return JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
}

export function purchaseFromApplePayload(payload: Record<string, unknown>, now: Date, bundleId?: string): StorePurchase | null {
  if (bundleId && payload.bundleId !== bundleId) return null;
  const product = storeSku(String(payload.productId ?? ""));
  const transactionId = String(payload.originalTransactionId ?? payload.transactionId ?? "");
  if (!product || !transactionId) return null;
  const expires = typeof payload.expiresDate === "number" ? new Date(payload.expiresDate) : null;
  // A refunded or revoked (Family Sharing removed) transaction carries revocationDate: no access from then on.
  const revoked = typeof payload.revocationDate === "number" && payload.revocationDate <= now.getTime();
  const active = !revoked && (!expires || expires.getTime() > now.getTime());
  const accountToken = typeof payload.appAccountToken === "string" && payload.appAccountToken ? payload.appAccountToken.toLowerCase() : null;
  return { ...product, transactionId, status: active ? "active" : "canceled", currentPeriodEnd: expires, ...(accountToken ? { accountToken } : {}) };
}

interface GoogleSub {
  lineItems?: Array<{ expiryTime?: string; productId?: string }>;
  subscriptionState?: string;
  acknowledgementState?: string;
  linkedPurchaseToken?: string;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
}

/**
 * States that still give access. SUBSCRIPTION_STATE_CANCELED means "will not renew": the customer keeps what
 * they paid for until expiryTime. ON_HOLD, PAUSED, PENDING and EXPIRED give no access.
 */
const GOOGLE_ENTITLED = new Set(["SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "SUBSCRIPTION_STATE_CANCELED"]);

export function purchaseFromGoogleSubscription(productId: string, purchaseToken: string, body: GoogleSub, now: Date): GooglePurchase | null {
  const product = storeSku(productId);
  if (!product) return null;
  const line = body.lineItems?.find((item) => item.productId === productId) ?? body.lineItems?.[0];
  const expires = line?.expiryTime ? new Date(line.expiryTime) : null;
  const entitled = GOOGLE_ENTITLED.has(body.subscriptionState ?? "") && (!expires || expires.getTime() > now.getTime());
  const accountToken = body.externalAccountIdentifiers?.obfuscatedExternalAccountId?.toLowerCase() ?? null;
  return {
    ...product,
    transactionId: googleTransactionId(purchaseToken),
    status: entitled ? "active" : "canceled",
    currentPeriodEnd: expires,
    ...(accountToken ? { accountToken } : {}),
    acknowledged: body.acknowledgementState !== "ACKNOWLEDGEMENT_STATE_PENDING",
    linkedPurchaseToken: body.linkedPurchaseToken ?? null,
  };
}

const PLAY_API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
const PLAY_SCOPE = "https://www.googleapis.com/auth/androidpublisher";

/** Google Play subscriptionsv2. Returns null when the purchase does not match a MIMT product. */
export async function verifyGoogleSubscription(input: {
  packageName: string;
  productId: string;
  purchaseToken: string;
  serviceAccountJson: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<GooglePurchase | null> {
  const account = readServiceAccount(input.serviceAccountJson);
  if (!account || !storeSku(input.productId)) return null;
  const fetchImpl = input.fetchImpl ?? fetch;
  const access = await googleAccessToken(account, PLAY_SCOPE, fetchImpl);
  const url = `${PLAY_API}/${encodeURIComponent(input.packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(input.purchaseToken)}`;
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  return purchaseFromGoogleSubscription(input.productId, input.purchaseToken, (await res.json()) as GoogleSub, input.now ?? new Date());
}

export async function acknowledgeGoogleSubscription(input: {
  packageName: string;
  productId: string;
  purchaseToken: string;
  serviceAccountJson: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const account = readServiceAccount(input.serviceAccountJson);
  if (!account) throw new Error("google_service_account");
  const fetchImpl = input.fetchImpl ?? fetch;
  const access = await googleAccessToken(account, PLAY_SCOPE, fetchImpl);
  const url = `${PLAY_API}/${encodeURIComponent(input.packageName)}/purchases/subscriptions/${encodeURIComponent(input.productId)}/tokens/${encodeURIComponent(input.purchaseToken)}:acknowledge`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`google acknowledge HTTP ${res.status}`);
}

/** Real store calls. Each method needs its store configured; the routes check that first (503 otherwise). */
export function createStoreVerifier(config: Config, fetchImpl: typeof fetch = fetch): StoreVerifier {
  const google = () => {
    if (!config.GOOGLE_PLAY_PACKAGE_NAME || !config.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) throw new Error("google_play_not_configured");
    return { packageName: config.GOOGLE_PLAY_PACKAGE_NAME, serviceAccountJson: config.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON, fetchImpl };
  };
  return {
    appleJws: (jws) => {
      if (!config.APPLE_ROOT_CA_PEM) throw new Error("app_store_not_configured");
      return verifyAppleTransactionJws(jws, config.APPLE_ROOT_CA_PEM);
    },
    google: (productId, purchaseToken) => verifyGoogleSubscription({ ...google(), productId, purchaseToken }),
    googleAcknowledge: (productId, purchaseToken) => acknowledgeGoogleSubscription({ ...google(), productId, purchaseToken }),
  };
}

/** Store rows stay live this long after their period end: a renewal can reach the API a little late. */
export const STORE_RENEWAL_MARGIN_MS = 2 * 86_400_000;
