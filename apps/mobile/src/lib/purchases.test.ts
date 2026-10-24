import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../api/errors";
import {
  ALL_SKUS,
  createPurchaseFlow,
  managedByThisStore,
  offersFor,
  storeErrorKey,
  type Account,
  type PurchaseState,
  type StorePort,
  type StoreProduct,
  type StorePurchase,
} from "./purchases";
import { resolveStoreMode } from "./storeMode";

const products: StoreProduct[] = ALL_SKUS.map((id) => ({
  id,
  title: id,
  displayPrice: id.includes("yearly") ? "99,99 $" : "13,99 $",
  offers: [
    { offerToken: `${id}-intro`, phases: 2 },
    { offerToken: `${id}-base`, phases: 1 },
  ],
}));
const free: Account = { plan: "free", addOns: [], planSource: null, addOnSource: null };

/** In-memory store: buy() emits a purchase (or an error) like expo-iap's listeners do. */
function fakeStore(opts: { owned?: StorePurchase[]; onBuy?: (sku: string) => StorePurchase | { code: string } } = {}) {
  let purchaseCb: ((p: StorePurchase) => void) | null = null;
  let errorCb: ((e: { code: string }) => void) | null = null;
  const store = {
    products: vi.fn(async () => products),
    buy: vi.fn(async (req: { sku: string }) => {
      const out = opts.onBuy?.(req.sku);
      if (!out) return;
      queueMicrotask(() => ("code" in out ? errorCb?.(out) : purchaseCb?.(out)));
    }),
    finish: vi.fn(async () => {}),
    owned: vi.fn(async () => opts.owned ?? []),
    restore: vi.fn(async () => {}),
    onPurchase: (cb: (p: StorePurchase) => void) => ((purchaseCb = cb), () => (purchaseCb = null)),
    onError: (cb: (e: { code: string }) => void) => ((errorCb = cb), () => (errorCb = null)),
    emit: (p: StorePurchase) => purchaseCb?.(p),
  } satisfies StorePort & { emit: unknown };
  return store;
}

function setupFlow(store: ReturnType<typeof fakeStore>, verify: (body: { productId: string }) => Promise<unknown>, platform: "ios" | "android" = "ios") {
  const states: PurchaseState[] = [];
  const refresh = vi.fn(async () => {});
  const api = { verify: vi.fn(verify) as never };
  const flow = createPurchaseFlow({ store, api, platform, refresh, onChange: (s) => states.push(s) });
  const last = () => states[states.length - 1]!;
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { flow, states, last, refresh, api: api as unknown as { verify: ReturnType<typeof vi.fn> }, settle };
}

const purchased = (productId: string, token = `jws-${productId}`): StorePurchase => ({ productId, purchaseToken: token, purchaseState: "purchased" });
const active = (productId: string) => async () => ({ status: "active", plan: productId.includes("premium") ? "premium" : "lock", currentPeriodEnd: null });

describe("store mode", () => {
  it("defaults to in-app purchase; companion only when asked", () => {
    expect(resolveStoreMode(undefined)).toBe("iap");
    expect(resolveStoreMode("iap")).toBe("iap");
    expect(resolveStoreMode("companion")).toBe("companion");
    expect(resolveStoreMode("stripe")).toBe("iap");
  });
});

describe("offers", () => {
  it("offers Essentiel and Premium (monthly, yearly) and Sans pub on the free plan, with store prices", () => {
    const offers = offersFor(free, products, "ios");
    expect(offers.map((o) => o.sku)).toEqual([
      "ca.mimt.app.lock.monthly",
      "ca.mimt.app.lock.yearly",
      "ca.mimt.app.premium.monthly",
      "ca.mimt.app.premium.yearly",
      "ca.mimt.app.noads.monthly",
      "ca.mimt.app.noads.yearly",
    ]);
    expect(offers[0]).toMatchObject({ price: "13,99 $", kind: "plan", code: "lock", interval: "month", offerToken: "ca.mimt.app.lock.monthly-base" });
  });

  it("offers only the upgrade on a plan billed by this store, nothing on a plan billed by the web", () => {
    const lockApple: Account = { plan: "lock", addOns: [], planSource: "app_store", addOnSource: null };
    expect(offersFor(lockApple, products, "ios").filter((o) => o.kind === "plan").map((o) => o.code)).toEqual(["premium", "premium"]);
    const lockWeb: Account = { ...lockApple, planSource: "web" };
    expect(offersFor(lockWeb, products, "ios").filter((o) => o.kind === "plan")).toEqual([]);
    expect(offersFor(lockApple, products, "android").filter((o) => o.kind === "plan")).toEqual([]);
  });

  it("offers nothing to Premium (ads already off) and no plan to business accounts", () => {
    expect(offersFor({ plan: "premium", addOns: [], planSource: "app_store", addOnSource: null }, products, "ios")).toEqual([]);
    expect(offersFor({ plan: "business", addOns: [], planSource: "web", addOnSource: null }, products, "ios")).toEqual([]);
    expect(offersFor({ ...free, addOns: ["no_ads"], addOnSource: "web" }, products, "ios").some((o) => o.kind === "addon")).toBe(false);
  });

  it("skips products the store does not return", () => {
    expect(offersFor(free, products.slice(0, 1), "ios").map((o) => o.sku)).toEqual(["ca.mimt.app.lock.monthly"]);
    expect(offersFor(free, [], "ios")).toEqual([]);
  });

  it("subscription management opens only for a subscription this store bills", () => {
    expect(managedByThisStore({ ...free, plan: "lock", planSource: "app_store" }, "ios")).toBe(true);
    expect(managedByThisStore({ ...free, plan: "lock", planSource: "web" }, "ios")).toBe(false);
    expect(managedByThisStore({ ...free, addOns: ["no_ads"], addOnSource: "google_play" }, "android")).toBe(true);
  });
});

describe("purchase flow", () => {
  const lockOffer = () => offersFor(free, products, "ios")[0]!;

  it("verifies with the API, then finishes the transaction, then refreshes", async () => {
    const order: string[] = [];
    const store = fakeStore({ onBuy: (sku) => purchased(sku) });
    store.finish.mockImplementation(async () => void order.push("finish"));
    const t = setupFlow(store, async (body) => (order.push("verify"), active(body.productId)()));
    await t.flow.buy(lockOffer(), { id: "acc-1" });
    await t.settle();
    await t.settle();
    expect(store.buy).toHaveBeenCalledWith(expect.objectContaining({ sku: "ca.mimt.app.lock.monthly", accountToken: "acc-1", offerToken: "ca.mimt.app.lock.monthly-base" }));
    expect(t.api.verify).toHaveBeenCalledWith({ platform: "ios", productId: "ca.mimt.app.lock.monthly", transaction: "jws-ca.mimt.app.lock.monthly" });
    expect(order).toEqual(["verify", "finish"]);
    expect(t.refresh).toHaveBeenCalled();
    expect(t.states.map((s) => s.phase)).toEqual(["buying", "verifying", "done"]);
    expect(t.last().messageKey).toBe("purchase.success");
  });

  it("never finishes when the API cannot verify (network, server): the store replays it later", async () => {
    const store = fakeStore({ onBuy: (sku) => purchased(sku) });
    const t = setupFlow(store, async () => {
      throw new ApiClientError(null, "network", "error.network", "offline");
    });
    await t.flow.buy(lockOffer(), { id: "acc-1" });
    await t.settle();
    await t.settle();
    expect(store.finish).not.toHaveBeenCalled();
    expect(t.last()).toMatchObject({ phase: "error", messageKey: "purchase.verifyLater" });
  });

  it("a rejected receipt is not finished either; a purchase linked to another account is closed", async () => {
    const store = fakeStore();
    const rejected = setupFlow(store, async () => {
      throw new ApiClientError(400, "invalid_receipt", "purchase.verifyFailed", "bad");
    });
    expect(await rejected.flow.handle(purchased("ca.mimt.app.lock.monthly"))).toBe("failed");
    expect(store.finish).not.toHaveBeenCalled();
    rejected.flow.dispose();
    const linked = setupFlow(store, async () => {
      throw new ApiClientError(409, "store_purchase_linked", "purchase.linkedElsewhere", "linked");
    });
    expect(await linked.flow.handle(purchased("ca.mimt.app.lock.monthly"))).toBe("failed");
    expect(store.finish).toHaveBeenCalledOnce();
    expect(linked.last().messageKey).toBe("purchase.linkedElsewhere");
  });

  it("pending purchases (Ask to Buy, deferred) grant nothing and are not finished", async () => {
    const store = fakeStore({ onBuy: (sku) => ({ productId: sku, purchaseToken: null, purchaseState: "pending" }) });
    const t = setupFlow(store, async () => ({ status: "active" }));
    await t.flow.buy(lockOffer(), { id: "acc-1" });
    await t.settle();
    expect(t.api.verify).not.toHaveBeenCalled();
    expect(store.finish).not.toHaveBeenCalled();
    expect(t.last()).toMatchObject({ phase: "pending", messageKey: "purchase.pending" });
    // Approved later: the store emits it again, now purchased, and it is verified quietly.
    store.emit(purchased("ca.mimt.app.lock.monthly"));
    await t.settle();
    await t.settle();
    expect(t.api.verify).toHaveBeenCalledOnce();
    expect(store.finish).toHaveBeenCalledOnce();
  });

  it("maps store errors: cancel says nothing, deferred is pending, others are explained in French keys", async () => {
    expect(storeErrorKey("user-cancelled")).toBeNull();
    expect(storeErrorKey("deferred-payment")).toBe("purchase.pending");
    expect(storeErrorKey("network-error")).toBe("error.network");
    expect(storeErrorKey("already-owned")).toBe("purchase.alreadyOwned");
    expect(storeErrorKey("sku-not-found")).toBe("purchase.unavailable");
    expect(storeErrorKey("billing-unavailable")).toBe("purchase.storeUnavailable");
    expect(storeErrorKey("something-new")).toBe("purchase.failed");

    const store = fakeStore({ onBuy: () => ({ code: "user-cancelled" }) });
    const t = setupFlow(store, async () => ({ status: "active" }));
    await t.flow.buy(lockOffer(), { id: "acc-1" });
    await t.settle();
    expect(t.last().phase).toBe("idle");
  });

  it("restores: re-verifies what the store owns and ignores other apps' products", async () => {
    const store = fakeStore({ owned: [purchased("ca.mimt.app.premium.yearly"), purchased("com.other.app.gold")] });
    const t = setupFlow(store, async (body) => active(body.productId)());
    await t.flow.restore();
    expect(store.restore).toHaveBeenCalled();
    expect(t.api.verify).toHaveBeenCalledOnce();
    expect(t.last()).toMatchObject({ phase: "done", messageKey: "purchase.restored" });

    const empty = setupFlow(fakeStore(), async () => ({ status: "active" }));
    await empty.flow.restore();
    expect(empty.last().messageKey).toBe("purchase.nothingToRestore");
  });

  it("verifies the same transaction once even when the listener and the sync both see it", async () => {
    const p = purchased("ca.mimt.app.lock.monthly");
    const store = fakeStore({ owned: [p] });
    let resolve!: (v: unknown) => void;
    const t = setupFlow(store, () => new Promise((r) => (resolve = r)));
    const sync = t.flow.sync();
    await t.settle();
    store.emit(p);
    resolve({ status: "active" });
    await sync;
    await t.settle();
    expect(t.api.verify).toHaveBeenCalledOnce();
  });

  it("on Android, a plan change replaces the current Play subscription", async () => {
    const store = fakeStore();
    const t = setupFlow(store, async () => ({ status: "active" }), "android");
    const premium = offersFor(free, products, "android").find((o) => o.sku === "ca.mimt.app.premium.monthly")!;
    await t.flow.buy(premium, { id: "acc-1", owned: [purchased("ca.mimt.app.lock.monthly", "play-token-lock")] });
    expect(store.buy).toHaveBeenCalledWith(
      expect.objectContaining({ replacing: { productId: "ca.mimt.app.lock.monthly", purchaseToken: "play-token-lock" } }),
    );
  });
});

describe("store builds never sell through the web", () => {
  const root = join(__dirname, "..", "..");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
    });

  it("has no Stripe checkout, billing portal or web price in the app code", () => {
    for (const path of [...files(join(root, "app")), ...files(join(root, "src"))]) {
      const text = readFileSync(path, "utf8");
      expect(text, path).not.toMatch(/\/v1\/billing\/checkout|\/v1\/billing\/portal|checkoutUrl|portalUrl|checkout\.stripe\.com|monthlyPriceCents|yearlyPriceCents|priceCents/);
    }
  });

  it("has no text sending people to a website to buy or to see prices", async () => {
    const { fr } = await import("../i18n/fr");
    const { en } = await import("../i18n/en");
    for (const text of [...Object.values(fr), ...Object.values(en)]) {
      expect(text).not.toMatch(/(mimt\.ca|site web|website|navigateur|browser)[^.]*(forfait|plan|prix|price|pay|achet|buy|abonn|subscri)/i);
      expect(text).not.toMatch(/(acheter|payer|buy|pay|subscribe|abonnez)[^.]*(mimt\.ca|site web|website|en ligne|online)/i);
    }
  });
});
