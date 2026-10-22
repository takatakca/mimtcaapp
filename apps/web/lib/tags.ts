// Google tags on mimt.ca: AdSense, Google Analytics 4 and Google Ads, each switched on by its id alone (env at build
// time) and always behind Consent Mode v2 (Law 25): nothing personal is stored or used before the visitor accepts.
import { CONSENT_KEY } from "./consent.ts";

export interface TagIds {
  /** "ca-pub-…" */
  adsenseClient?: string | null;
  /** GA4 measurement id "G-XXXXXXXXXX" (NEXT_PUBLIC_GA4_ID). */
  ga4?: string | null;
  /** Google Ads tag id "AW-123456789" (NEXT_PUBLIC_GADS_ID). */
  ads?: string | null;
}

export const GA4_ID = /^G-[A-Z0-9]{6,14}$/;
export const ADS_ID = /^AW-\d{6,14}$/;
export const ADS_LABEL = /^[A-Za-z0-9_-]{6,40}$/;

/** Valid ids only: a typo in a variable turns the tag off instead of shipping a broken one. */
export function tagIds(env: Record<string, string | undefined>, adsenseClient: string | null): TagIds {
  const ga4 = env.NEXT_PUBLIC_GA4_ID?.trim();
  const ads = env.NEXT_PUBLIC_GADS_ID?.trim();
  return { adsenseClient, ga4: ga4 && GA4_ID.test(ga4) ? ga4 : null, ads: ads && ADS_ID.test(ads) ? ads : null };
}

/**
 * One inline script, first in <head>: Consent Mode defaults (denied until « Accepter »; a stored choice is
 * re-applied), then the tags it needs. Injected by script so no tag can run before the defaults.
 */
export function tagBootstrap(ids: TagIds): string {
  const lines = [
    `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=gtag;`,
    `var c=null;try{c=localStorage.getItem(${JSON.stringify(CONSENT_KEY)})}catch(e){}var g=c==="granted"?"granted":"denied";`,
    `gtag("consent","default",{ad_storage:g,ad_user_data:g,ad_personalization:g,analytics_storage:g,wait_for_update:500});`,
    `function load(u,x){var s=document.createElement("script");s.async=true;if(x)s.crossOrigin="anonymous";s.src=u;document.head.appendChild(s);}`,
  ];
  if (ids.adsenseClient) {
    lines.push(`(window.adsbygoogle=window.adsbygoogle||[]).requestNonPersonalizedAds=g==="granted"?0:1;`);
    lines.push(`load("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ids.adsenseClient}",1);`);
  }
  const gtagIds = [ids.ga4, ids.ads].filter((v): v is string => Boolean(v));
  if (gtagIds.length) {
    lines.push(`load("https://www.googletagmanager.com/gtag/js?id=${gtagIds[0]}");gtag("js",new Date());`);
    for (const id of gtagIds) lines.push(`gtag("config",${JSON.stringify(id)});`);
  }
  return lines.join("\n");
}

type GtagWindow = Window & { gtag?: (...args: unknown[]) => void };

/** A visitor held a number in the picker: GA4 lead event, and the Google Ads conversion when configured. */
export function trackNumberHeld(w: GtagWindow = window): void {
  const ads = process.env.NEXT_PUBLIC_GADS_ID?.trim();
  const label = process.env.NEXT_PUBLIC_GADS_HOLD_LABEL?.trim();
  w.gtag?.("event", "generate_lead", { method: "number_picker" });
  if (ads && label && ADS_ID.test(ads) && ADS_LABEL.test(label)) w.gtag?.("event", "conversion", { send_to: `${ads}/${label}` });
}
