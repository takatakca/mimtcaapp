// Ads for the free plan only (Google Mobile Ads). Privacy by default (Quebec Law 25):
// - Ads are NON-personalised unless the user opts in inside MIMT (Confidentialité) AND, on iOS,
//   allows App Tracking Transparency AND Google's UMP consent allows ads.
// - Plans with the "no_ads" feature, and the "Sans pub" add-on, never load ads.
// Only Google's public TEST ad unit ids are used in this codebase. TODO(launch): real unit ids
// from AdMob, set through EAS env vars, after the PIA for Google (Law 25 s. 17).
import { adFreeFor, type PlanCode } from "@mimt/shared";
import * as SecureStore from "expo-secure-store";
import { getTrackingPermissionsAsync, requestTrackingPermissionsAsync } from "expo-tracking-transparency";
import { Platform } from "react-native";
import type * as GoogleAds from "react-native-google-mobile-ads";

type AdsSdk = typeof GoogleAds;

const PERSONALISED_KEY = "mimt.consent.ads_personalised";

let sdk: AdsSdk | null | undefined;
let initPromise: Promise<boolean> | null = null;
let personalised = false;

export function loadAdsSdk(): AdsSdk | null {
  if (sdk !== undefined) return sdk;
  if (Platform.OS === "web") return (sdk = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sdk = require("react-native-google-mobile-ads") as AdsSdk;
  } catch {
    sdk = null; // Not in this build (Expo Go).
  }
  return sdk;
}

export function adsEnabledFor(plan: PlanCode | undefined, addOns: readonly string[] = []): boolean {
  return !!plan && !adFreeFor(plan, addOns);
}

export async function getPersonalisedConsent(): Promise<boolean> {
  return (await SecureStore.getItemAsync(PERSONALISED_KEY).catch(() => null)) === "true";
}

/** Synchronize server-side consent without unexpectedly prompting for iOS tracking on page load. */
export async function setPersonalisedConsent(granted: boolean, requestTracking = true): Promise<void> {
  // Immediately fail closed even when SecureStore is unavailable (e.g. device locked).
  if (!granted) personalised = false;
  await SecureStore.setItemAsync(PERSONALISED_KEY, granted ? "true" : "false");
  if (granted && requestTracking && Platform.OS === "ios") await requestTrackingPermissionsAsync().catch(() => undefined);
  personalised = await computePersonalised();
}

async function computePersonalised(): Promise<boolean> {
  if (!(await getPersonalisedConsent())) return false;
  if (Platform.OS === "ios") {
    const att = await getTrackingPermissionsAsync().catch(() => null);
    if (!att?.granted) return false;
  }
  return true;
}

/** Gathers UMP consent, then starts the SDK. Resolves false when ads cannot be shown. */
export function initAds(): Promise<boolean> {
  if (!initPromise) {
    initPromise = (async () => {
      const ads = loadAdsSdk();
      if (!ads) return false;
      try {
        const info = await ads.AdsConsent.gatherConsent();
        if (!info.canRequestAds) return false;
        personalised = await computePersonalised();
        await ads.default().setRequestConfiguration({
          maxAdContentRating: ads.MaxAdContentRating.PG,
          tagForChildDirectedTreatment: false,
          tagForUnderAgeOfConsent: false,
        });
        await ads.default().initialize();
        return true;
      } catch {
        return false;
      }
    })();
  }
  return initPromise;
}

/** Request options for every ad request: non-personalised unless all consents say otherwise. */
export function adRequestOptions(userId?: string): {
  requestNonPersonalizedAdsOnly: boolean;
  serverSideVerificationOptions?: { userId: string; customData: string };
} {
  return {
    requestNonPersonalizedAdsOnly: !personalised,
    ...(userId ? { serverSideVerificationOptions: { userId, customData: userId } } : {}),
  };
}

export function testUnitIds(ads: AdsSdk): { banner: string; rewarded: string } {
  return { banner: ads.TestIds.ADAPTIVE_BANNER, rewarded: ads.TestIds.REWARDED };
}

/** Google's privacy options form (required entry point when UMP says so). */
export async function showAdPrivacyOptions(): Promise<void> {
  const ads = loadAdsSdk();
  if (ads) await ads.AdsConsent.showPrivacyOptionsForm().catch(() => undefined);
}
