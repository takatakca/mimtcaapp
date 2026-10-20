// Free-plan web ads (Google AdSense). Pure rules + a tiny script loader, unit-tested in adsense.test.ts.
// Mirrors apps/mobile/src/services/ads.ts:
// - only plans without "no_ads" and without the « Sans pub » add-on see ads;
// - NON-personalised by default (Quebec Law 25): personalised only after the user turns on
//   « Publicités personnalisées » in Compte › Confidentialité (consent "ads_personalised");
// - never on the call screen, during a call, on 9-1-1 information, sign-in, billing/checkout or
//   meeting rooms: ads appear only at the bottom of the Messages, Calls and Voicemail lists.
// The rewarded « Gagnez 10 minutes » ad stays in the mobile app (AdMob server-side verification).
import { adFreeFor, type PlanCode } from "@mimt/shared";

export type AdPlacement = "banner" | "sidebar";
export type AdMode = "none" | "placeholder" | "live";

export interface AdSenseConfig {
  client: string;
  slotBanner: string;
  slotSidebar: string | null;
}

export const ADSENSE_ORIGIN = "https://pagead2.googlesyndication.com";
export const ADSENSE_SCRIPT_ID = "mimt-adsense";

/** Valid AdSense ids, or null (no ads at all). The client is "ca-pub-" + 16 digits, slots are digits. */
export function adSenseConfig(raw: { client?: string; slotBanner?: string; slotSidebar?: string }): AdSenseConfig | null {
  const client = (raw.client ?? "").trim();
  const slotBanner = (raw.slotBanner ?? "").trim();
  const slotSidebar = (raw.slotSidebar ?? "").trim();
  if (!/^ca-pub-\d{16}$/.test(client) || !/^\d{5,20}$/.test(slotBanner)) return null;
  return { client, slotBanner, slotSidebar: /^\d{5,20}$/.test(slotSidebar) ? slotSidebar : null };
}

/**
 * Ads only on the three list pages. Everything else is excluded on purpose: conversations, dial pad,
 * Compte (9-1-1 address and notice, billing), Services (checkout), Réunions, Affaires, sign-in.
 */
const AD_PATHS = /^\/(messages|appels|messagerie)\/?$/;
export const adsAllowedOnPath = (pathname: string): boolean => AD_PATHS.test(pathname);

/** True while a call is ringing, connecting or connected (the call screen is up). */
export const callInProgress = (status: string): boolean => !["idle", "ended", "failed"].includes(status);

/** Whether this account sees ads at all (plan loaded, no "no_ads"). */
export function adsEligible(plan: PlanCode | undefined, addOns: readonly string[] = []): boolean {
  return !!plan && !adFreeFor(plan, addOns);
}

export function adMode(input: {
  plan: PlanCode | undefined;
  addOns?: readonly string[];
  config: AdSenseConfig | null;
  mock: boolean;
  pathname: string;
  inCall: boolean;
  placement: AdPlacement;
}): AdMode {
  if (!adsEligible(input.plan, input.addOns)) return "none";
  if (!adsAllowedOnPath(input.pathname) || input.inCall) return "none";
  // Demo mode (VITE_MOCK_API=1): a labelled box shows where the ad goes; no Google script is loaded.
  if (input.mock) return "placeholder";
  if (!input.config) return "none";
  if (input.placement === "sidebar" && !input.config.slotSidebar) return "none";
  return "live";
}

/** Load the AdSense script only for real (non-demo) builds, configured, for accounts that see ads. */
export function shouldLoadAdSense(input: { plan: PlanCode | undefined; addOns?: readonly string[]; config: AdSenseConfig | null; mock: boolean }): boolean {
  return !input.mock && !!input.config && adsEligible(input.plan, input.addOns);
}

type AdsQueue = unknown[] & { requestNonPersonalizedAds?: 0 | 1 };
type AdsWindow = { adsbygoogle?: AdsQueue };

function queue(w: AdsWindow): AdsQueue {
  w.adsbygoogle ??= [] as AdsQueue;
  return w.adsbygoogle;
}

/** Law 25: 1 (non-personalised) unless the user granted "ads_personalised". Applies to the next ad requests. */
export function applyAdConsent(personalised: boolean, w: AdsWindow = window as unknown as AdsWindow): 0 | 1 {
  const npa = personalised ? 0 : 1;
  queue(w).requestNonPersonalizedAds = npa;
  return npa;
}

/** Injects adsbygoogle.js once (async). The consent flag is set first, before any ad request. */
export function loadAdSense(client: string, personalised: boolean, doc: Document = document): void {
  applyAdConsent(personalised, doc.defaultView as unknown as AdsWindow);
  if (doc.getElementById(ADSENSE_SCRIPT_ID)) return;
  const s = doc.createElement("script");
  s.id = ADSENSE_SCRIPT_ID;
  s.async = true;
  s.crossOrigin = "anonymous";
  s.src = `${ADSENSE_ORIGIN}/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  doc.head.appendChild(s);
}

/** Asks AdSense to fill the <ins class="adsbygoogle"> just rendered. Never throws. */
export function requestAd(w: AdsWindow = window as unknown as AdsWindow): void {
  try {
    queue(w).push({});
  } catch {
    // Ad blockers and "already filled" errors must never break the app.
  }
}

/** Where the mobile app (rewarded « Gagnez 10 minutes ») is announced. */
export const mobileAppUrl = (lang: "fr" | "en") => (lang === "fr" ? "https://mimt.ca/bientot/" : "https://mimt.ca/en/coming-soon/");
