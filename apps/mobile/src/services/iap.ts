// Apple / Google in-app purchase for the store builds (expo-iap: StoreKit 2 and Play Billing, config plugin,
// development build only). The purchase rules live in lib/purchases.ts; this file only adapts expo-iap to them.
// The web (mimt.ca, app.mimt.ca) keeps Stripe; the API grants the same plan whichever channel billed it.
import Constants from "expo-constants";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import type * as ExpoIap from "expo-iap";
import type { MeResponse } from "@mimt/shared";
import { api } from "../api/client";
import {
  ALL_SKUS,
  createPurchaseFlow,
  IDLE,
  managedByThisStore,
  offersFor,
  type Offer,
  type PurchaseFlow,
  type PurchaseState,
  type StorePlatform,
  type StorePort,
  type StoreProduct,
  type StorePurchase,
} from "../lib/purchases";
import { resolveStoreMode, type StorePurchasesMode } from "../lib/storeMode";

type Iap = typeof ExpoIap;

/** Build-time mode (app.config.ts extra.storePurchases, from STORE_PURCHASES). Default: in-app purchase. */
export const STORE_MODE: StorePurchasesMode = resolveStoreMode(
  (Constants.expoConfig?.extra as { storePurchases?: unknown } | undefined)?.storePurchases,
);
const ANDROID_PACKAGE = Constants.expoConfig?.android?.package ?? "ca.mimt.app";

let iap: Iap | null | undefined;
function loadIap(): Iap | null {
  if (iap !== undefined) return iap;
  if (Platform.OS !== "ios" && Platform.OS !== "android") return (iap = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    iap = require("expo-iap") as Iap;
  } catch {
    iap = null; // Not in this build (Expo Go): no purchases.
  }
  return iap;
}

export const storePlatform: StorePlatform = Platform.OS === "ios" ? "ios" : "android";

type RawPurchase = ExpoIap.Purchase;

/** expo-iap → StorePort. Raw purchases are kept so finishTransaction receives the object the store gave. */
function expoIapStore(lib: Iap): StorePort {
  const raw = new Map<string, RawPurchase>();
  const remember = (p: RawPurchase): StorePurchase => {
    if (p.purchaseToken) raw.set(p.purchaseToken, p);
    return { productId: p.productId, purchaseToken: p.purchaseToken ?? null, purchaseState: p.purchaseState };
  };
  return {
    async products(skus) {
      const list = ((await lib.fetchProducts({ skus, type: "subs" })) ?? []) as ExpoIap.ProductSubscription[];
      return list.map(
        (p): StoreProduct => ({
          id: p.id,
          title: p.displayName ?? p.title,
          displayPrice: p.displayPrice,
          offers:
            p.platform === "android"
              ? p.subscriptionOffers.map((o) => ({ offerToken: o.offerTokenAndroid ?? null, phases: o.pricingPhasesAndroid?.pricingPhaseList.length ?? 1 }))
              : [],
        }),
      );
    },
    async buy({ sku, accountToken, offerToken, replacing }) {
      await lib.requestPurchase({
        type: "subs",
        request: {
          apple: { sku, appAccountToken: accountToken },
          google: {
            skus: [sku],
            obfuscatedAccountId: accountToken,
            ...(offerToken ? { subscriptionOffers: [{ sku, offerToken }] } : {}),
            ...(replacing
              ? {
                  purchaseToken: replacing.purchaseToken,
                  subscriptionProductReplacementParams: { oldProductId: replacing.productId, replacementMode: "charge-prorated-price" as const },
                }
              : {}),
          },
        },
      });
    },
    async finish(p) {
      const purchase = p.purchaseToken ? raw.get(p.purchaseToken) : undefined;
      if (purchase) await lib.finishTransaction({ purchase, isConsumable: false });
    },
    async owned() {
      return (await lib.getAvailablePurchases()).map(remember);
    },
    async restore() {
      await lib.restorePurchases();
    },
    onPurchase(cb) {
      const sub = lib.purchaseUpdatedListener((p) => cb(remember(p)));
      return () => sub.remove();
    },
    onError(cb) {
      const sub = lib.purchaseErrorListener((e) => cb({ code: String(e.code) }));
      return () => sub.remove();
    },
  };
}

/** Opens the App Store / Google Play subscription page (cancel, change plan, billing problem). */
export async function openStoreSubscriptions(sku?: string): Promise<void> {
  const lib = loadIap();
  if (!lib) return;
  await lib.deepLinkToSubscriptions({ skuAndroid: sku ?? null, packageNameAndroid: ANDROID_PACKAGE });
}

export interface StorePurchases {
  mode: StorePurchasesMode;
  /** false in companion mode, in Expo Go, or when the store cannot be reached. */
  available: boolean;
  loading: boolean;
  offers: Offer[];
  state: PurchaseState;
  manageable: boolean;
  buy(offer: Offer): void;
  restore(): void;
  manage(): void;
  clearMessage(): void;
}

/** Store products, purchase state and actions for the Compte screen. Does nothing in companion mode. */
export function useStorePurchases(me: MeResponse | null, refreshMe: () => Promise<unknown>): StorePurchases {
  const enabled = STORE_MODE === "iap" && !!loadIap();
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<PurchaseState>(IDLE);
  const flow = useRef<PurchaseFlow | null>(null);
  const port = useRef<StorePort | null>(null);
  const refresh = useRef(refreshMe);
  refresh.current = refreshMe;
  const signedIn = !!me;

  useEffect(() => {
    if (!enabled || !signedIn) return;
    const lib = loadIap()!;
    let cancelled = false;
    const store = expoIapStore(lib);
    port.current = store;
    flow.current = createPurchaseFlow({
      store,
      api: { verify: (body) => api.verifyStorePurchase(body) },
      platform: storePlatform,
      refresh: async () => void (await refresh.current()),
      onChange: (s) => !cancelled && setState(s),
      log: (m) => console.warn("[iap]", m),
    });
    (async () => {
      try {
        await lib.initConnection();
        const list = await store.products(ALL_SKUS);
        if (cancelled) return;
        setProducts(list);
        setAvailable(true);
        await flow.current?.sync();
      } catch {
        if (!cancelled) setAvailable(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      flow.current?.dispose();
      flow.current = null;
      lib.endConnection().catch(() => undefined);
    };
  }, [enabled, signedIn]);

  const offers = useMemo(() => (me && available ? offersFor(me.account, products, storePlatform) : []), [me, available, products]);
  const manageable = !!me && enabled && managedByThisStore(me.account, storePlatform);
  const accountId = me?.account.id ?? null;

  const buy = useCallback(
    (offer: Offer) => {
      if (!flow.current || !accountId || !port.current) return;
      const store = port.current;
      void (async () => {
        const owned = storePlatform === "android" ? await store.owned().catch(() => []) : [];
        await flow.current?.buy(offer, { id: accountId, owned });
      })();
    },
    [accountId],
  );
  const restore = useCallback(() => void flow.current?.restore(), []);
  const manage = useCallback(() => {
    void (async () => {
      // Android opens the page of one subscription: the MIMT one the store reports.
      const owned = (await port.current?.owned().catch(() => [])) ?? [];
      const sku = owned.find((p) => ALL_SKUS.includes(p.productId as (typeof ALL_SKUS)[number]))?.productId;
      await openStoreSubscriptions(sku).catch(() => undefined);
    })();
  }, []);
  const clearMessage = useCallback(() => setState(IDLE), []);

  return { mode: STORE_MODE, available: enabled && available, loading: enabled && loading, offers, state, manageable, buy, restore, manage, clearMessage };
}
