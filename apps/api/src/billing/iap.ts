import { X509Certificate } from "node:crypto";
import { storeProduct, type PlanCode } from "@mimt/shared";
import { compactVerify, importX509 } from "jose";
import { googleAccessToken, readServiceAccount } from "../devices/verify.js";

export interface StorePurchase {
  plan: Extract<PlanCode, "lock" | "premium">;
  transactionId: string;
  status: "active" | "canceled";
  currentPeriodEnd: Date | null;
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
  const product = storeProduct(String(payload.productId ?? ""));
  const transactionId = String(payload.originalTransactionId ?? payload.transactionId ?? "");
  if (!product || !transactionId) return null;
  const expires = typeof payload.expiresDate === "number" ? new Date(payload.expiresDate) : null;
  const active = !expires || expires.getTime() > now.getTime();
  return { plan: product.plan, transactionId, status: active ? "active" : "canceled", currentPeriodEnd: expires };
}

interface GoogleSub {
  lineItems?: Array<{ expiryTime?: string; productId?: string }>;
  subscriptionState?: string;
}

/** Google Play subscriptionsv2. Returns null when the purchase does not match a MIMT product. */
export async function verifyGoogleSubscription(input: {
  packageName: string;
  productId: string;
  purchaseToken: string;
  serviceAccountJson: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<StorePurchase | null> {
  const account = readServiceAccount(input.serviceAccountJson);
  const product = storeProduct(input.productId);
  if (!account || !product) return null;
  const fetchImpl = input.fetchImpl ?? fetch;
  const access = await googleAccessToken(account, "https://www.googleapis.com/auth/androidpublisher", fetchImpl);
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(input.packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(input.purchaseToken)}`;
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const body = (await res.json()) as GoogleSub;
  const line = body.lineItems?.find((item) => item.productId === input.productId) ?? body.lineItems?.[0];
  const expires = line?.expiryTime ? new Date(line.expiryTime) : null;
  const now = input.now ?? new Date();
  const active = body.subscriptionState === "SUBSCRIPTION_STATE_ACTIVE" || body.subscriptionState === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD";
  return {
    plan: product.plan,
    transactionId: input.purchaseToken.slice(0, 120),
    status: active && (!expires || expires.getTime() > now.getTime()) ? "active" : "canceled",
    currentPeriodEnd: expires,
  };
}
