// In-app purchases (App Store / Google Play) next to Stripe: verification, account linking, Play acknowledgement,
// App Store Server Notifications V2, Google Play RTDN, and the same entitlements whatever the channel.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { purchaseFromGoogleSubscription, STORE_RENEWAL_MARGIN_MS, type GooglePurchase, type StoreVerifier } from "../src/billing/iap.js";
import type { Subscription } from "../src/repo/types.js";
import { isLiveSubscription } from "../src/services/accounts.js";
import { makeUser, setup, type Ctx } from "./helpers.js";

const DAY = 86_400_000;
const RTDN_TOKEN = "rtdn-test-token-0123456789abcdef";
const STORE_CONFIG = {
  APPLE_ROOT_CA_PEM: "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----",
  APPLE_BUNDLE_ID: "ca.mimt.app",
  GOOGLE_PLAY_PACKAGE_NAME: "ca.mimt.app",
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: '{"client_email":"x@y","private_key":"k"}',
  GOOGLE_PLAY_RTDN_TOKEN: RTDN_TOKEN,
};

/** Fake JWS: "fake.<base64url JSON>". Anything else fails verification, like a bad Apple signature. */
const jws = (payload: Record<string, unknown>) => `fake.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;

let ctx: Ctx;
let googleState: Map<string, GooglePurchase | null>;
let store: StoreVerifier & { googleAcknowledge: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  googleState = new Map();
  store = {
    appleJws: async (token: string) => {
      if (!token.startsWith("fake.")) throw new Error("bad signature");
      return JSON.parse(Buffer.from(token.slice(5), "base64url").toString("utf8")) as Record<string, unknown>;
    },
    google: async (_productId: string, token: string) => googleState.get(token) ?? null,
    googleAcknowledge: vi.fn(async () => {}),
  };
  ctx = await setup({ config: STORE_CONFIG, store });
});
afterEach(() => ctx.app.close());

const appleTx = (over: Record<string, unknown> = {}) => ({
  bundleId: "ca.mimt.app",
  productId: "ca.mimt.app.premium.monthly",
  originalTransactionId: "1000",
  transactionId: "1000",
  expiresDate: Date.now() + 30 * DAY,
  ...over,
});

const verify = (auth: Record<string, string>, payload: Record<string, unknown>) =>
  ctx.app.inject({ method: "POST", url: "/v1/billing/iap/verify", headers: auth, payload });
const me = async (auth: Record<string, string>) => (await ctx.app.inject({ url: "/v1/me", headers: auth })).json();

function googlePurchase(token: string, over: Partial<GooglePurchase> = {}): GooglePurchase {
  return {
    plan: "lock",
    transactionId: token.slice(0, 120),
    status: "active",
    currentPeriodEnd: new Date(Date.now() + 30 * DAY),
    acknowledged: false,
    linkedPurchaseToken: null,
    ...over,
  };
}

describe("POST /v1/billing/iap/verify", () => {
  it("grants the App Store plan and reports where it is billed", async () => {
    const u = await makeUser(ctx);
    const tx = appleTx({ appAccountToken: u.account.id.toUpperCase() });
    const res = await verify(u.auth, { platform: "ios", productId: "ca.mimt.app.premium.monthly", transaction: jws(tx) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ plan: "premium", status: "active" });
    const body = await me(u.auth);
    expect(body.account.plan).toBe("premium");
    expect(body.account.planSource).toBe("app_store");
  });

  it("refuses a bad signature and a product id that does not match the receipt", async () => {
    const u = await makeUser(ctx);
    const bad = await verify(u.auth, { platform: "ios", productId: "ca.mimt.app.premium.monthly", transaction: "x".repeat(40) });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("invalid_receipt");
    const other = await verify(u.auth, { platform: "ios", productId: "ca.mimt.app.lock.monthly", transaction: jws(appleTx()) });
    expect(other.statusCode).toBe(400);
    expect((await me(u.auth)).account.plan).toBe("free");
  });

  it("refuses a receipt tagged for another account, and the same subscription on a second account", async () => {
    const a = await makeUser(ctx);
    const b = await makeUser(ctx);
    const tagged = await verify(b.auth, {
      platform: "ios",
      productId: "ca.mimt.app.premium.monthly",
      transaction: jws(appleTx({ appAccountToken: a.account.id })),
    });
    expect(tagged.statusCode).toBe(409);
    expect(tagged.json().error).toBe("store_purchase_linked");

    expect((await verify(a.auth, { platform: "ios", productId: "ca.mimt.app.premium.monthly", transaction: jws(appleTx()) })).statusCode).toBe(200);
    const restoredElsewhere = await verify(b.auth, { platform: "ios", productId: "ca.mimt.app.premium.monthly", transaction: jws(appleTx()) });
    expect(restoredElsewhere.statusCode).toBe(409);
    expect((await me(a.auth)).account.plan).toBe("premium");
    expect((await me(b.auth)).account.plan).toBe("free");
  });

  it("an expired or refunded App Store transaction grants nothing", async () => {
    const u = await makeUser(ctx);
    const expired = await verify(u.auth, {
      platform: "ios",
      productId: "ca.mimt.app.premium.monthly",
      transaction: jws(appleTx({ expiresDate: Date.now() - 10 * DAY })),
    });
    expect(expired.json().status).toBe("canceled");
    const refunded = await verify(u.auth, {
      platform: "ios",
      productId: "ca.mimt.app.premium.monthly",
      transaction: jws(appleTx({ originalTransactionId: "2000", revocationDate: Date.now() - 1000 })),
    });
    expect(refunded.json().status).toBe("canceled");
    expect((await me(u.auth)).account.plan).toBe("free");
  });

  it("the Sans pub add-on bought in the app removes ads like the web one", async () => {
    const u = await makeUser(ctx);
    const res = await verify(u.auth, {
      platform: "ios",
      productId: "ca.mimt.app.noads.yearly",
      transaction: jws(appleTx({ productId: "ca.mimt.app.noads.yearly", originalTransactionId: "3000" })),
    });
    expect(res.json()).toMatchObject({ addon: "no_ads", status: "active" });
    const body = await me(u.auth);
    expect(body.account.addOns).toEqual(["no_ads"]);
    expect(body.account.addOnSource).toBe("app_store");
  });

  it("verifies a Play subscription, then acknowledges it on the server", async () => {
    const u = await makeUser(ctx);
    googleState.set("play-token-1".padEnd(40, "x"), googlePurchase("play-token-1".padEnd(40, "x"), { accountToken: u.account.id }));
    const res = await verify(u.auth, { platform: "android", productId: "ca.mimt.app.lock.monthly", transaction: "play-token-1".padEnd(40, "x") });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ plan: "lock", status: "active" });
    expect(store.googleAcknowledge).toHaveBeenCalledWith("ca.mimt.app.lock.monthly", "play-token-1".padEnd(40, "x"));
    expect((await me(u.auth)).account.planSource).toBe("google_play");
  });

  it("a Play upgrade replaces the previous subscription row", async () => {
    const u = await makeUser(ctx);
    const oldToken = "play-old".padEnd(40, "o");
    const newToken = "play-new".padEnd(40, "n");
    googleState.set(oldToken, googlePurchase(oldToken, { acknowledged: true }));
    await verify(u.auth, { platform: "android", productId: "ca.mimt.app.lock.monthly", transaction: oldToken });
    googleState.set(newToken, googlePurchase(newToken, { plan: "premium", linkedPurchaseToken: oldToken, acknowledged: true }));
    await verify(u.auth, { platform: "android", productId: "ca.mimt.app.premium.monthly", transaction: newToken });
    const subs = await ctx.repo.listSubscriptions(u.account.id);
    expect(subs.find((s) => s.stripeSubscriptionId === `android:${oldToken}`)?.status).toBe("canceled");
    expect((await me(u.auth)).account.plan).toBe("premium");
    expect(store.googleAcknowledge).not.toHaveBeenCalled();
  });

  it("a paid plan bought in the app lets the user claim a number", async () => {
    const u = await makeUser(ctx, { e911: true, ack: true });
    await verify(u.auth, { platform: "ios", productId: "ca.mimt.app.lock.monthly", transaction: jws(appleTx({ productId: "ca.mimt.app.lock.monthly" })) });
    const res = await ctx.app.inject({ method: "POST", url: "/v1/numbers/claim", headers: u.auth, payload: { e164: "+15145550199" } });
    expect(res.statusCode).toBeLessThan(300);
    expect((await me(u.auth)).numbers).toHaveLength(1);
  });
});

describe("one account, two channels", () => {
  it("a web (Stripe) plan shows in the app as billed on the web, and wins over a store row", async () => {
    const u = await makeUser(ctx);
    await ctx.repo.upsertSubscription({
      telecomAccountId: u.account.id,
      kind: "plan",
      code: "premium",
      quantity: 1,
      stripeSubscriptionId: "sub_web_1",
      status: "active",
      source: "stripe",
      currentPeriodEnd: new Date(Date.now() + 30 * DAY),
    });
    expect((await me(u.auth)).account).toMatchObject({ plan: "premium", planSource: "web" });
    await verify(u.auth, { platform: "ios", productId: "ca.mimt.app.premium.monthly", transaction: jws(appleTx()) });
    expect((await me(u.auth)).account).toMatchObject({ plan: "premium", planSource: "web" });
  });

  it("store rows stop counting after their period plus the renewal margin; Stripe rows follow their webhooks", () => {
    const now = new Date();
    const row = (source: Subscription["source"], endAgoMs: number): Subscription => ({
      id: "s",
      telecomAccountId: "a",
      kind: "plan",
      code: "premium",
      quantity: 1,
      stripeSubscriptionId: "x",
      status: "active",
      source,
      currentPeriodEnd: new Date(now.getTime() - endAgoMs),
      createdAt: now,
    });
    expect(isLiveSubscription(row("iap_apple", STORE_RENEWAL_MARGIN_MS - 60_000), now)).toBe(true);
    expect(isLiveSubscription(row("iap_apple", STORE_RENEWAL_MARGIN_MS + 60_000), now)).toBe(false);
    expect(isLiveSubscription(row("iap_google", STORE_RENEWAL_MARGIN_MS + 60_000), now)).toBe(false);
    expect(isLiveSubscription(row("stripe", 10 * DAY), now)).toBe(true);
  });
});

describe("Google Play subscription states", () => {
  const now = new Date();
  const line = (expiry: number) => [{ productId: "ca.mimt.app.premium.monthly", expiryTime: new Date(expiry).toISOString() }];
  it("keeps access after auto-renew is turned off, until the paid period ends", () => {
    const p = purchaseFromGoogleSubscription("ca.mimt.app.premium.monthly", "t".repeat(30), { subscriptionState: "SUBSCRIPTION_STATE_CANCELED", lineItems: line(now.getTime() + DAY) }, now);
    expect(p?.status).toBe("active");
  });
  it("gives no access on hold, paused, pending or expired", () => {
    for (const state of ["SUBSCRIPTION_STATE_ON_HOLD", "SUBSCRIPTION_STATE_PAUSED", "SUBSCRIPTION_STATE_PENDING", "SUBSCRIPTION_STATE_EXPIRED"]) {
      const p = purchaseFromGoogleSubscription("ca.mimt.app.premium.monthly", "t".repeat(30), { subscriptionState: state, lineItems: line(now.getTime() + DAY) }, now);
      expect(p?.status, state).toBe("canceled");
    }
  });
  it("reads acknowledgement, the linked token and the account id", () => {
    const p = purchaseFromGoogleSubscription(
      "ca.mimt.app.premium.monthly",
      "t".repeat(30),
      {
        subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
        lineItems: line(now.getTime() + DAY),
        acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
        linkedPurchaseToken: "old",
        externalAccountIdentifiers: { obfuscatedExternalAccountId: "ABC" },
      },
      now,
    );
    expect(p).toMatchObject({ acknowledged: false, linkedPurchaseToken: "old", accountToken: "abc", plan: "premium" });
    expect(purchaseFromGoogleSubscription("com.other.app.sku", "t".repeat(30), {}, now)).toBeNull();
  });
});

describe("App Store Server Notifications V2", () => {
  const notify = (payload: Record<string, unknown>) =>
    ctx.app.inject({ method: "POST", url: "/webhooks/appstore", payload: { signedPayload: jws(payload) } });
  const note = (type: string, tx: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    notificationType: type,
    notificationUUID: `uuid-${Math.random()}`,
    data: { bundleId: "ca.mimt.app", signedTransactionInfo: jws(tx) },
    ...extra,
  });

  it("ends the plan on EXPIRED and renews it on DID_RENEW", async () => {
    const u = await makeUser(ctx);
    await verify(u.auth, { platform: "ios", productId: "ca.mimt.app.premium.monthly", transaction: jws(appleTx()) });
    expect((await notify(note("EXPIRED", appleTx()))).statusCode).toBe(200);
    expect((await me(u.auth)).account.plan).toBe("free");
    expect((await notify(note("DID_RENEW", appleTx({ expiresDate: Date.now() + 60 * DAY })))).statusCode).toBe(200);
    expect((await me(u.auth)).account.plan).toBe("premium");
  });

  it("refunds cancel; grace-period billing retries keep access", async () => {
    const u = await makeUser(ctx);
    await verify(u.auth, { platform: "ios", productId: "ca.mimt.app.premium.monthly", transaction: jws(appleTx()) });
    const grace = note("DID_FAIL_TO_RENEW", appleTx({ expiresDate: Date.now() - DAY * 5 }), { subtype: "GRACE_PERIOD" });
    (grace.data as Record<string, unknown>).signedRenewalInfo = jws({ gracePeriodExpiresDate: Date.now() + 10 * DAY });
    await notify(grace);
    expect((await me(u.auth)).account.plan).toBe("premium");
    await notify(note("REFUND", appleTx()));
    expect((await me(u.auth)).account.plan).toBe("free");
  });

  it("links a first notification through appAccountToken, ignores unknown accounts, duplicates and other apps", async () => {
    const u = await makeUser(ctx);
    expect((await notify(note("SUBSCRIBED", appleTx({ originalTransactionId: "9", appAccountToken: u.account.id })))).json()).toEqual({ received: true });
    expect((await me(u.auth)).account.plan).toBe("premium");
    expect((await notify(note("SUBSCRIBED", appleTx({ originalTransactionId: "10" })))).json().ignored).toBe("unknown_account");
    const once = note("EXPIRED", appleTx({ originalTransactionId: "9" }));
    once.notificationUUID = "same-uuid";
    await notify(once);
    expect((await notify(once)).json().duplicate).toBe(true);
    expect((await notify({ ...note("SUBSCRIBED", appleTx()), data: { bundleId: "com.other", signedTransactionInfo: jws(appleTx()) } })).json().ignored).toBe("bundle");
  });

  it("refuses a payload that is not signed by Apple", async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/webhooks/appstore", payload: { signedPayload: "not-a-jws".repeat(5) } });
    expect(res.statusCode).toBe(400);
  });
});

describe("Google Play RTDN", () => {
  const push = (data: Record<string, unknown>, token = RTDN_TOKEN, messageId = `m-${Math.random()}`) =>
    ctx.app.inject({
      method: "POST",
      url: `/webhooks/google-play?token=${token}`,
      payload: { message: { messageId, data: Buffer.from(JSON.stringify(data)).toString("base64") }, subscription: "projects/p/subscriptions/s" },
    });
  const token = "rtdn-token".padEnd(40, "r");

  it("refuses a wrong push token", async () => {
    expect((await push({ packageName: "ca.mimt.app" }, "wrong-token-wrong-token-wrong")).statusCode).toBe(401);
  });

  it("re-reads the purchase from Google, links it by obfuscated account id, and acknowledges it", async () => {
    const u = await makeUser(ctx);
    googleState.set(token, googlePurchase(token, { plan: "premium", accountToken: u.account.id }));
    const res = await push({ packageName: "ca.mimt.app", subscriptionNotification: { notificationType: 4, purchaseToken: token, subscriptionId: "ca.mimt.app.premium.monthly" } });
    expect(res.json()).toEqual({ received: true });
    expect((await me(u.auth)).account.plan).toBe("premium");
    expect(store.googleAcknowledge).toHaveBeenCalledOnce();

    googleState.set(token, googlePurchase(token, { plan: "premium", status: "canceled", acknowledged: true }));
    await push({ packageName: "ca.mimt.app", subscriptionNotification: { notificationType: 13, purchaseToken: token, subscriptionId: "ca.mimt.app.premium.monthly" } });
    expect((await me(u.auth)).account.plan).toBe("free");
  });

  it("a voided purchase (refund) ends access; other packages are ignored", async () => {
    const u = await makeUser(ctx);
    googleState.set(token, googlePurchase(token, { acknowledged: true }));
    await verify(u.auth, { platform: "android", productId: "ca.mimt.app.lock.monthly", transaction: token });
    expect((await me(u.auth)).account.plan).toBe("lock");
    await push({ packageName: "ca.mimt.app", voidedPurchaseNotification: { purchaseToken: token, productType: 1 } });
    expect((await me(u.auth)).account.plan).toBe("free");
    expect((await push({ packageName: "com.other" })).json().ignored).toBe("package");
  });
});

describe("store webhooks without store configuration", () => {
  it("answer 503", async () => {
    const bare = await setup();
    expect((await bare.app.inject({ method: "POST", url: "/webhooks/appstore", payload: { signedPayload: "x".repeat(30) } })).statusCode).toBe(503);
    expect((await bare.app.inject({ method: "POST", url: "/webhooks/google-play?token=x", payload: { message: {} } })).statusCode).toBe(503);
    await bare.app.close();
  });
});
