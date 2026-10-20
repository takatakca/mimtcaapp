// Free-plan web ads: who sees them, where, and the Law 25 non-personalised flag.
import { afterEach, describe, expect, it } from "vitest";
import { ADSENSE_SCRIPT_ID, adMode, adSenseConfig, adsAllowedOnPath, applyAdConsent, callInProgress, loadAdSense, requestAd, shouldLoadAdSense } from "./adsense";

const CONFIG = adSenseConfig({ client: "ca-pub-0123456789012345", slotBanner: "1234567890", slotSidebar: "2345678901" });
const base = { plan: "free" as const, addOns: [] as string[], config: CONFIG, mock: false, pathname: "/messages", inCall: false, placement: "banner" as const };

afterEach(() => {
  document.getElementById(ADSENSE_SCRIPT_ID)?.remove();
  delete (window as unknown as { adsbygoogle?: unknown }).adsbygoogle;
});

describe("adSenseConfig", () => {
  it("is null (no ads at all) when the client or the banner slot is unset or malformed", () => {
    expect(adSenseConfig({})).toBeNull();
    expect(adSenseConfig({ client: "ca-pub-0123456789012345" })).toBeNull();
    expect(adSenseConfig({ client: "pub-0123456789012345", slotBanner: "1234567890" })).toBeNull();
    expect(adSenseConfig({ client: "ca-pub-0123456789012345", slotBanner: "abc" })).toBeNull();
  });

  it("keeps the sidebar slot optional", () => {
    expect(adSenseConfig({ client: " ca-pub-0123456789012345 ", slotBanner: "1234567890" })).toEqual({
      client: "ca-pub-0123456789012345",
      slotBanner: "1234567890",
      slotSidebar: null,
    });
  });
});

describe("adMode: who sees ads", () => {
  it("shows live ads to the free plan and to Number Lock (no no_ads feature)", () => {
    expect(adMode(base)).toBe("live");
    expect(adMode({ ...base, plan: "lock" })).toBe("live");
  });

  it("never shows ads to Premium, business plans or the « Sans pub » add-on", () => {
    for (const plan of ["premium", "business", "business_pro"] as const) expect(adMode({ ...base, plan })).toBe("none");
    expect(adMode({ ...base, addOns: ["no_ads"] })).toBe("none");
    expect(adMode({ ...base, plan: "lock", addOns: ["no_ads"] })).toBe("none");
  });

  it("shows nothing before the plan is known or when AdSense is not configured", () => {
    expect(adMode({ ...base, plan: undefined })).toBe("none");
    expect(adMode({ ...base, config: null })).toBe("none");
    expect(adMode({ ...base, placement: "sidebar", config: adSenseConfig({ client: "ca-pub-0123456789012345", slotBanner: "1234567890" }) })).toBe("none");
    expect(adMode({ ...base, placement: "sidebar" })).toBe("live");
  });

  it("shows a labelled placeholder in demo mode, even without AdSense ids, still never to ad-free accounts", () => {
    expect(adMode({ ...base, mock: true, config: null })).toBe("placeholder");
    expect(adMode({ ...base, mock: true, plan: "premium" })).toBe("none");
  });
});

describe("adMode: where", () => {
  it("allows only the Messages, Calls and Voicemail lists", () => {
    for (const p of ["/messages", "/messages/", "/appels", "/messagerie"]) expect(adsAllowedOnPath(p), p).toBe(true);
  });

  it("excludes conversations, Compte (9-1-1, billing), checkout, meetings, business, sign-in", () => {
    for (const p of [
      "/messages/%2B15145550199",
      "/compte",
      "/compte/appels",
      "/services/offres",
      "/services/commandes/abc",
      "/services/transfert",
      "/reunions",
      "/reunions/m1",
      "/reunion/guest-token",
      "/affaires/biz",
      "/connexion",
      "/connexion/texto",
      "/auth/callback",
      "/",
    ]) {
      expect(adsAllowedOnPath(p), p).toBe(false);
      expect(adMode({ ...base, pathname: p }), p).toBe("none");
      expect(adMode({ ...base, mock: true, pathname: p }), p).toBe("none");
    }
  });

  it("hides every ad while a call is ringing or connected (call screen, dial pad in call)", () => {
    for (const s of ["incoming", "connecting", "ringing", "connected", "reconnecting"]) expect(callInProgress(s), s).toBe(true);
    for (const s of ["idle", "ended", "failed"]) expect(callInProgress(s), s).toBe(false);
    expect(adMode({ ...base, inCall: true })).toBe("none");
    expect(adMode({ ...base, inCall: true, mock: true })).toBe("none");
  });
});

describe("AdSense script and consent", () => {
  it("loads the script only for real builds with ids, for accounts that see ads", () => {
    expect(shouldLoadAdSense({ plan: "free", config: CONFIG, mock: false })).toBe(true);
    expect(shouldLoadAdSense({ plan: "free", config: CONFIG, mock: true })).toBe(false);
    expect(shouldLoadAdSense({ plan: "free", config: null, mock: false })).toBe(false);
    expect(shouldLoadAdSense({ plan: "premium", config: CONFIG, mock: false })).toBe(false);
    expect(shouldLoadAdSense({ plan: "free", addOns: ["no_ads"], config: CONFIG, mock: false })).toBe(false);
  });

  it("requests non-personalised ads (npa = 1) unless ads_personalised was granted", () => {
    const w: { adsbygoogle?: unknown[] & { requestNonPersonalizedAds?: 0 | 1 } } = {};
    expect(applyAdConsent(false, w)).toBe(1);
    expect(w.adsbygoogle?.requestNonPersonalizedAds).toBe(1);
    expect(applyAdConsent(true, w)).toBe(0);
    expect(w.adsbygoogle?.requestNonPersonalizedAds).toBe(0);
    expect(applyAdConsent(false, w)).toBe(1);
  });

  it("injects adsbygoogle.js once, async, with the flag set before it", () => {
    loadAdSense("ca-pub-0123456789012345", false);
    loadAdSense("ca-pub-0123456789012345", false);
    const scripts = document.querySelectorAll(`script#${ADSENSE_SCRIPT_ID}`);
    expect(scripts).toHaveLength(1);
    const s = scripts[0] as HTMLScriptElement;
    expect(s.src).toBe("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-0123456789012345");
    expect(s.async).toBe(true);
    expect(s.crossOrigin).toBe("anonymous");
    expect((window as unknown as { adsbygoogle: { requestNonPersonalizedAds: number } }).adsbygoogle.requestNonPersonalizedAds).toBe(1);
  });

  it("never throws when an ad blocker breaks the queue", () => {
    const w = { adsbygoogle: Object.assign([], { push: () => { throw new Error("blocked"); } }) };
    expect(() => requestAd(w)).not.toThrow();
  });
});
