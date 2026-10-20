// Law 25 ad consent on mimt.ca: one stored choice, read by the head script (lib/root-layout) and the banner.

export const CONSENT_KEY = "mimt-ads-consent";
/** Fired (on window) by the footer link to reopen the banner. */
export const CONSENT_OPEN_EVENT = "mimt:consent-open";

export type ConsentChoice = "granted" | "denied";

type AdsWindow = Window & { gtag?: (...args: unknown[]) => void; adsbygoogle?: { requestNonPersonalizedAds?: number } };

/** Tells Google about a choice: Consent Mode v2 update plus AdSense's non-personalised flag. */
export function applyConsent(choice: ConsentChoice, w: AdsWindow = window): void {
  w.gtag?.("consent", "update", { ad_storage: choice, ad_user_data: choice, ad_personalization: choice });
  w.adsbygoogle = w.adsbygoogle || ([] as unknown as { requestNonPersonalizedAds?: number });
  w.adsbygoogle.requestNonPersonalizedAds = choice === "granted" ? 0 : 1;
}
