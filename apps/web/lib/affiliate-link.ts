// Affiliate links on mimt.ca (docs/MIMT-AFFILIATES.md): https://mimt.ca/?aff=CODE. Kept pure so node --test checks it.
// - First touch: the first code seen is kept with the click time, for AFFILIATE_ATTRIBUTION_DAYS; a later link does
//   not replace it.
// - It rides along when a number is held in the live picker (the API stores it with the hold) and on links to the
//   web app (?aff=CODE), which keeps it until sign-in and checkout. The API alone decides whether it counts.
// - Any storage error: nothing is kept (the visitor is simply not attributed).
import { AFFILIATE_ATTRIBUTION_DAYS, AFFILIATE_LINK_PARAM, normalizeAffiliateCode } from "@mimt/shared";
import type { KeyValueStore, StoreGetter } from "./download-prompt.ts";

export const AFFILIATE_STORAGE_KEY = "mimt.affiliate.v1";
const DAY_MS = 86_400_000;

export interface AffiliateTouch {
  code: string;
  touchedAt: string;
}

export function readAffiliateTouch(getStore: StoreGetter, now: Date = new Date()): AffiliateTouch | null {
  try {
    const raw = getStore()?.getItem(AFFILIATE_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as AffiliateTouch;
    const at = new Date(v.touchedAt).getTime();
    if (!normalizeAffiliateCode(v.code ?? "") || !Number.isFinite(at) || now.getTime() - at > AFFILIATE_ATTRIBUTION_DAYS * DAY_MS) return null;
    return { code: v.code, touchedAt: v.touchedAt };
  } catch {
    return null;
  }
}

export function captureAffiliateTouch(search: string, getStore: StoreGetter, now: Date = new Date()): AffiliateTouch | null {
  const existing = readAffiliateTouch(getStore, now);
  if (existing) return existing;
  const code = normalizeAffiliateCode(new URLSearchParams(search).get(AFFILIATE_LINK_PARAM) ?? "");
  if (!code) return null;
  const touch = { code, touchedAt: now.toISOString() };
  try {
    (getStore() as KeyValueStore | null | undefined)?.setItem(AFFILIATE_STORAGE_KEY, JSON.stringify(touch));
  } catch {
    return null;
  }
  return touch;
}

/** Adds ?aff=CODE to a web-app URL (the fragment, which may carry a number hold, is kept as is). */
export function withAffiliateParam(url: string, touch: AffiliateTouch | null): string {
  if (!touch) return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has(AFFILIATE_LINK_PARAM)) u.searchParams.set(AFFILIATE_LINK_PARAM, touch.code);
    return u.toString();
  } catch {
    return url;
  }
}
