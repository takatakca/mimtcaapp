// In-app purchase logic (pure, unit-tested with a fake store). The native adapter is services/iap.ts (expo-iap).
// Rules (App Review 3.1.1 / 3.1.2, Google Play Payments):
// - prices come from the store, in the customer's currency; MIMT never shows its own (web) price in the app;
// - a purchase is finished (iOS) / acknowledged (Android) only AFTER the API has verified it and granted the plan;
// - pending / "Ask to Buy" purchases grant nothing until the store confirms them;
// - restore re-sends what the store says the customer owns.
import {
  ADDON_STORE_PRODUCTS,
  adFreeFor,
  STORE_PRODUCTS,
  type BillingSource,
  type IapVerifyRequest,
  type IapVerifyResponse,
  type MeResponse,
  type PlanCode,
} from "@mimt/shared";
import { ApiClientError } from "../api/errors";
import type { TKey } from "../i18n/core";

export type StorePlatform = "ios" | "android";
export type StoreSku = keyof typeof STORE_PRODUCTS | keyof typeof ADDON_STORE_PRODUCTS;

export const PLAN_SKUS = Object.keys(STORE_PRODUCTS) as (keyof typeof STORE_PRODUCTS)[];
export const ADDON_SKUS = Object.keys(ADDON_STORE_PRODUCTS) as (keyof typeof ADDON_STORE_PRODUCTS)[];
export const ALL_SKUS: StoreSku[] = [...PLAN_SKUS, ...ADDON_SKUS];

export function isMimtSku(id: string): id is StoreSku {
  return id in STORE_PRODUCTS || id in ADDON_STORE_PRODUCTS;
}

/** What the store returns for a product (the subset MIMT uses). */
export interface StoreProduct {
  id: string;
  title: string;
  displayPrice: string;
  /** Android base-plan offers; the app buys the base plan (no unadvertised intro offer). */
  offers?: Array<{ offerToken?: string | null; phases: number }>;
}

/** What the store returns for a purchase (the subset MIMT uses). */
export interface StorePurchase {
  productId: string;
  /** iOS: StoreKit 2 JWS. Android: Play purchase token. */
  purchaseToken?: string | null;
  purchaseState: "pending" | "purchased" | "unknown";
}

export interface BuyRequest {
  sku: StoreSku;
  /** Account id: Apple appAccountToken / Play obfuscatedAccountId, checked by the API. */
  accountToken: string;
  offerToken?: string | null;
  /** Android plan change: the Play subscription being replaced. */
  replacing?: { productId: string; purchaseToken: string } | null;
}

/** The store, behind a small interface (services/iap.ts implements it with expo-iap). */
export interface StorePort {
  products(skus: StoreSku[]): Promise<StoreProduct[]>;
  /** Starts the store sheet. The result arrives through onPurchase / onError. */
  buy(req: BuyRequest): Promise<void>;
  finish(purchase: StorePurchase): Promise<void>;
  /** Purchases the store currently reports (active subscriptions, unfinished transactions). */
  owned(): Promise<StorePurchase[]>;
  /** Asks the store to sync with the customer's account (may prompt for the store password). */
  restore(): Promise<void>;
  onPurchase(cb: (p: StorePurchase) => void): () => void;
  onError(cb: (e: { code: string }) => void): () => void;
}

export interface VerifyPort {
  verify(body: IapVerifyRequest): Promise<IapVerifyResponse>;
}

// --------------------------------------------------------------------------------------------- offers

export interface Offer {
  sku: StoreSku;
  kind: "plan" | "addon";
  /** Plan code, or "no_ads". */
  code: PlanCode | "no_ads";
  interval: "month" | "year";
  title: string;
  /** Store-localized price, e.g. "12,99 $". */
  price: string;
  offerToken: string | null;
}

const PLAN_RANK: PlanCode[] = ["free", "lock", "premium", "business", "business_pro"];

function describe(sku: StoreSku): Pick<Offer, "kind" | "code" | "interval"> {
  if (sku in STORE_PRODUCTS) {
    const p = STORE_PRODUCTS[sku as keyof typeof STORE_PRODUCTS];
    return { kind: "plan", code: p.plan, interval: p.interval };
  }
  const a = ADDON_STORE_PRODUCTS[sku as keyof typeof ADDON_STORE_PRODUCTS];
  return { kind: "addon", code: a.addon, interval: a.interval };
}

/** Base-plan offer token on Android: the offer with the fewest pricing phases (no intro price). */
function baseOfferToken(product: StoreProduct): string | null {
  const offers = (product.offers ?? []).filter((o) => o.offerToken);
  if (!offers.length) return null;
  return [...offers].sort((a, b) => a.phases - b.phases)[0]!.offerToken ?? null;
}

export type Account = Pick<MeResponse["account"], "plan" | "addOns" | "planSource" | "addOnSource">;

/** Store channels: a subscription billed by the store this app runs on can be managed or changed here. */
const storeChannel = (platform: StorePlatform): BillingSource => (platform === "ios" ? "app_store" : "google_play");

/**
 * Offers shown to this account, in display order (plans by rank, monthly first, then "Sans pub"). Nothing is
 * offered when the plan is billed elsewhere (web, other store, referral) or is a business plan: a second
 * subscription would bill the customer twice.
 */
export function offersFor(account: Account, products: StoreProduct[], platform: StorePlatform): Offer[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const offers: Offer[] = [];
  const current = PLAN_RANK.indexOf(account.plan);
  const planBilledHere = account.plan === "free" || account.planSource === storeChannel(platform);
  for (const sku of ALL_SKUS) {
    const product = byId.get(sku);
    if (!product) continue; // Not created in the store yet, or not available in this storefront.
    const d = describe(sku);
    if (d.kind === "plan") {
      if (!planBilledHere || account.plan === "business" || account.plan === "business_pro") continue;
      if (PLAN_RANK.indexOf(d.code as PlanCode) <= current) continue;
    } else if (adFreeFor(account.plan, account.addOns ?? [])) {
      continue;
    }
    offers.push({ sku, ...d, title: product.title, price: product.displayPrice, offerToken: baseOfferToken(product) });
  }
  return offers;
}

/** "Gérer l'abonnement" opens the store's page only for a subscription this store bills. */
export function managedByThisStore(account: Account, platform: StorePlatform): boolean {
  const channel = storeChannel(platform);
  return account.planSource === channel || account.addOnSource === channel;
}

// --------------------------------------------------------------------------------------------- flow

export type PurchasePhase = "idle" | "buying" | "verifying" | "restoring" | "pending" | "done" | "error";

export interface PurchaseState {
  phase: PurchasePhase;
  sku: StoreSku | null;
  /** Message to show: an error (phase "error") or an outcome ("done", "pending"). */
  messageKey: TKey | null;
}

export const IDLE: PurchaseState = { phase: "idle", sku: null, messageKey: null };

/** Store error codes (expo-iap ErrorCode values) → what the customer reads. null = say nothing (cancelled). */
export function storeErrorKey(code: string): TKey | null {
  switch (code) {
    case "user-cancelled":
      return null;
    case "deferred-payment":
    case "pending":
      return "purchase.pending";
    case "network-error":
    case "service-timeout":
    case "service-disconnected":
    case "connection-closed":
      return "error.network";
    case "already-owned":
      return "purchase.alreadyOwned";
    case "item-unavailable":
    case "sku-not-found":
    case "query-product":
    case "empty-sku-list":
      return "purchase.unavailable";
    case "billing-unavailable":
    case "iap-not-available":
    case "feature-not-supported":
    case "init-connection":
    case "not-prepared":
      return "purchase.storeUnavailable";
    default:
      return "purchase.failed";
  }
}

/** API failures while verifying: finish the transaction or keep it for a retry? */
function verifyFailure(e: unknown): { key: TKey; finish: boolean } {
  if (e instanceof ApiClientError) {
    // Already linked to another MIMT account: the store delivered it there, so the transaction can be closed.
    if (e.code === "store_purchase_linked") return { key: "purchase.linkedElsewhere", finish: true };
    // Network or server trouble: kept unfinished, the store replays it and the next start verifies it again.
    if (e.status === null || e.status === 0 || e.status >= 500) return { key: "purchase.verifyLater", finish: false };
  }
  // Anything else (rejected receipt, unknown product): kept unfinished so support can recover it; nothing granted.
  return { key: "purchase.verifyFailed", finish: false };
}

export interface PurchaseFlowDeps {
  store: StorePort;
  api: VerifyPort;
  platform: StorePlatform;
  /** Re-reads /v1/me so the plan shows right away. */
  refresh: () => Promise<void>;
  onChange: (s: PurchaseState) => void;
  log?: (msg: string) => void;
}

export interface PurchaseFlow {
  buy(offer: Offer, account: { id: string; owned?: StorePurchase[] }): Promise<void>;
  restore(): Promise<void>;
  /** Silent sync at start: unfinished transactions and renewals the API has not seen. */
  sync(): Promise<void>;
  /** Unsubscribes the store listeners. */
  dispose(): void;
  handle(p: StorePurchase, quiet?: boolean): Promise<"granted" | "expired" | "pending" | "failed" | "ignored">;
}

export function createPurchaseFlow(deps: PurchaseFlowDeps): PurchaseFlow {
  const { store, api, platform } = deps;
  let state: PurchaseState = IDLE;
  const inFlight = new Map<string, Promise<"granted" | "expired" | "pending" | "failed" | "ignored">>();
  const set = (next: PurchaseState) => {
    state = next;
    deps.onChange(next);
  };

  async function verifyAndFinish(p: StorePurchase, quiet: boolean) {
    if (!isMimtSku(p.productId)) return "ignored" as const;
    if (p.purchaseState === "pending") {
      if (!quiet) set({ phase: "pending", sku: p.productId, messageKey: "purchase.pending" });
      return "pending" as const;
    }
    if (!p.purchaseToken) {
      if (!quiet) set({ phase: "error", sku: p.productId, messageKey: "purchase.failed" });
      return "failed" as const;
    }
    if (!quiet) set({ phase: "verifying", sku: p.productId, messageKey: null });
    let res: IapVerifyResponse;
    try {
      res = await api.verify({ platform, productId: p.productId, transaction: p.purchaseToken });
    } catch (e) {
      const failure = verifyFailure(e);
      if (failure.finish) await store.finish(p).catch(() => deps.log?.("finish failed"));
      if (!quiet) set({ phase: "error", sku: p.productId, messageKey: failure.key });
      return "failed" as const;
    }
    // Only now: the plan is granted on the server, so the store may close (iOS) / acknowledge (Android) it.
    await store.finish(p).catch(() => deps.log?.("finish failed"));
    await deps.refresh().catch(() => undefined);
    const granted = res.status === "active";
    if (!quiet) set({ phase: "done", sku: p.productId, messageKey: granted ? "purchase.success" : "purchase.expired" });
    return granted ? ("granted" as const) : ("expired" as const);
  }

  function handle(p: StorePurchase, quiet = false) {
    const key = p.purchaseToken ?? `${p.productId}:${p.purchaseState}`;
    const running = inFlight.get(key);
    if (running) return running;
    const job = verifyAndFinish(p, quiet).finally(() => inFlight.delete(key));
    inFlight.set(key, job);
    return job;
  }

  const offPurchase = store.onPurchase((p) => {
    // A purchase the customer is not waiting for (renewal, Ask to Buy approved later) is handled quietly.
    const quiet = state.phase !== "buying" && state.phase !== "pending";
    void handle(p, quiet);
  });
  const offError = store.onError((e) => {
    if (state.phase !== "buying") return;
    const key = storeErrorKey(e.code);
    if (key === null) return set(IDLE);
    set({ phase: key === "purchase.pending" ? "pending" : "error", sku: state.sku, messageKey: key });
  });

  return {
    handle,
    async buy(offer, account) {
      if (state.phase === "buying" || state.phase === "verifying" || state.phase === "restoring") return;
      set({ phase: "buying", sku: offer.sku, messageKey: null });
      // Android plan change: replace the current Play plan instead of adding a second subscription.
      let replacing: BuyRequest["replacing"] = null;
      if (platform === "android" && offer.kind === "plan") {
        const current = (account.owned ?? []).find((p) => p.productId in STORE_PRODUCTS && p.purchaseState === "purchased" && p.purchaseToken);
        if (current?.purchaseToken) replacing = { productId: current.productId, purchaseToken: current.purchaseToken };
      }
      try {
        await store.buy({ sku: offer.sku, accountToken: account.id, offerToken: offer.offerToken, replacing });
      } catch (e) {
        const code = typeof e === "object" && e && "code" in e ? String((e as { code: unknown }).code) : "unknown";
        const key = storeErrorKey(code);
        set(key === null ? IDLE : { phase: key === "purchase.pending" ? "pending" : "error", sku: offer.sku, messageKey: key });
      }
    },
    async restore() {
      set({ phase: "restoring", sku: null, messageKey: null });
      try {
        await store.restore().catch(() => undefined);
        const owned = (await store.owned()).filter((p) => isMimtSku(p.productId));
        if (!owned.length) return set({ phase: "done", sku: null, messageKey: "purchase.nothingToRestore" });
        const results = await Promise.all(owned.map((p) => handle(p, true)));
        if (results.includes("granted")) return set({ phase: "done", sku: null, messageKey: "purchase.restored" });
        if (results.includes("pending")) return set({ phase: "pending", sku: null, messageKey: "purchase.pending" });
        if (results.every((r) => r === "expired")) return set({ phase: "done", sku: null, messageKey: "purchase.nothingToRestore" });
        set({ phase: "error", sku: null, messageKey: "purchase.restoreFailed" });
      } catch {
        set({ phase: "error", sku: null, messageKey: "purchase.storeUnavailable" });
      }
    },
    async sync() {
      try {
        const owned = (await store.owned()).filter((p) => isMimtSku(p.productId));
        await Promise.all(owned.map((p) => handle(p, true)));
      } catch {
        // Store not reachable: the next start tries again. Nothing is granted or removed here.
      }
    },
    dispose() {
      offPurchase();
      offError();
    },
  };
}
