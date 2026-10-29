// Affiliate links (docs/MIMT-AFFILIATES.md): https://app.mimt.ca/?aff=CODE. The app keeps the FIRST code it sees with
// the time of the click (first touch), for AFFILIATE_ATTRIBUTION_DAYS, then hands it to the API: right after sign-in
// (POST /v1/affiliates/attribution) and with every Stripe Checkout. The API decides; this is only a carrier.
// Storage errors (private mode, blocked storage) are ignored: the visitor simply is not attributed.
import { AFFILIATE_ATTRIBUTION_DAYS, AFFILIATE_LINK_PARAM, normalizeAffiliateCode } from "@mimt/shared";

export const AFFILIATE_STORAGE_KEY = "mimt.affiliate";
const DAY_MS = 86_400_000;

export interface PendingAffiliate {
  code: string;
  touchedAt: string;
  /** Set once the API has seen it after sign-in (it keeps riding along with checkouts until it expires). */
  sentAt?: string;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const storage = (): Store | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

export function readPendingAffiliate(store: Store | null = storage(), now = new Date()): PendingAffiliate | null {
  try {
    const raw = store?.getItem(AFFILIATE_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as PendingAffiliate;
    const touched = new Date(v.touchedAt).getTime();
    if (!normalizeAffiliateCode(v.code) || !Number.isFinite(touched) || now.getTime() - touched > AFFILIATE_ATTRIBUTION_DAYS * DAY_MS) {
      store?.removeItem(AFFILIATE_STORAGE_KEY);
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

/** Reads ?aff=CODE from a URL search string. First touch: an existing, unexpired code is never replaced. */
export function captureAffiliate(search: string, store: Store | null = storage(), now = new Date()): PendingAffiliate | null {
  const existing = readPendingAffiliate(store, now);
  if (existing) return existing;
  const code = normalizeAffiliateCode(new URLSearchParams(search).get(AFFILIATE_LINK_PARAM) ?? "");
  if (!code) return null;
  const v: PendingAffiliate = { code, touchedAt: now.toISOString() };
  try {
    store?.setItem(AFFILIATE_STORAGE_KEY, JSON.stringify(v));
  } catch {
    // ignored
  }
  return v;
}

export function markAffiliateSent(store: Store | null = storage(), now = new Date()): void {
  const v = readPendingAffiliate(store, now);
  if (!v) return;
  try {
    store?.setItem(AFFILIATE_STORAGE_KEY, JSON.stringify({ ...v, sentAt: now.toISOString() }));
  } catch {
    // ignored
  }
}

/** The `affiliate` field of POST /v1/billing/checkout, when a code is pending. */
export function checkoutAffiliate(store: Store | null = storage(), now = new Date()): { code: string; touchedAt: string } | undefined {
  const v = readPendingAffiliate(store, now);
  return v ? { code: v.code, touchedAt: v.touchedAt } : undefined;
}
