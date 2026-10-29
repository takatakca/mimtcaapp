// Subscription add-ons sold on their own, next to a plan (parity P1 item 1: "Sans pub").
// Additive to PLANS / ADD_ONS in plans.ts: prices there are an owner decision and stay as they are.
// Prices are CAD cents before taxes (GST/QST added on the bill; no 9-1-1 tax: an add-on is not a number).

import { planHas, yearlyPriceFor, type Feature, type PlanCode } from "./plans.js";

export type SubscriptionAddOnCode = "no_ads" | "google_calendar";

export interface SubscriptionAddOn {
  code: SubscriptionAddOnCode;
  name: { fr: string; en: string };
  description: { fr: string; en: string };
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  /** Features the add-on grants on top of the plan. */
  features: readonly Feature[];
  /** Plans that already include it (no checkout: 409 already_included). */
  includedIn?: readonly PlanCode[];
  /** Plans that may buy it; absent = any plan. */
  availableOn?: readonly PlanCode[];
  /** Free trial on the first Stripe checkout of this add-on (once per account). */
  trialDays?: number;
}

export const SUBSCRIPTION_ADD_ONS: Record<SubscriptionAddOnCode, SubscriptionAddOn> = {
  no_ads: {
    code: "no_ads",
    name: { fr: "Sans pub", en: "Ad-free" },
    description: {
      fr: "Retire les publicités de l'application, sans changer de forfait.",
      en: "Removes ads from the app without changing your plan.",
    },
    monthlyPriceCents: 399,
    yearlyPriceCents: 2999,
    features: ["no_ads"],
  },
  // « Google Agenda » (owner decision 2026-10-29, docs/MIMT-CALENDAR.md): included in Affaires and Affaires Pro,
  // 3,95 $/month on Essentiel and Premium, yearly = 11 × monthly like the plans, 14-day free trial (Stripe).
  // Cost to MIMT ≈ 0 (Google Calendar API calls are free within quota): unitEconomics.test.ts checks it anyway.
  google_calendar: {
    code: "google_calendar",
    name: { fr: "Google Agenda", en: "Google Calendar" },
    description: {
      fr: "Vos appels, appels manqués, messages vocaux et résumés d'appel IA dans votre Google Agenda.",
      en: "Your calls, missed calls, voicemails and AI call summaries in your Google Calendar.",
    },
    monthlyPriceCents: 395,
    yearlyPriceCents: yearlyPriceFor(395),
    features: ["calendar_sync"],
    includedIn: ["business", "business_pro"],
    availableOn: ["lock", "premium"],
    trialDays: 14,
  },
};

export function isSubscriptionAddOn(code: string): code is SubscriptionAddOnCode {
  return code in SUBSCRIPTION_ADD_ONS;
}

/**
 * App Store and Play product ids for add-ons (separate from the plan SKUs in STORE_PRODUCTS). « Google Agenda » has
 * none on purpose: it is connected and sold in the web app only (OAuth with Google in the browser); the native apps
 * do not offer it. Proposed ids if that changes: ca.mimt.app.gcal.monthly / ca.mimt.app.gcal.yearly
 * (docs/MIMT-CALENDAR.md).
 */
export const ADDON_STORE_PRODUCTS = {
  "ca.mimt.app.noads.monthly": { addon: "no_ads", interval: "month" },
  "ca.mimt.app.noads.yearly": { addon: "no_ads", interval: "year" },
} as const satisfies Record<string, { addon: SubscriptionAddOnCode; interval: "month" | "year" }>;

export function storeAddOnProduct(id: string): (typeof ADDON_STORE_PRODUCTS)[keyof typeof ADDON_STORE_PRODUCTS] | undefined {
  if (id in ADDON_STORE_PRODUCTS) return ADDON_STORE_PRODUCTS[id as keyof typeof ADDON_STORE_PRODUCTS];
  return undefined;
}

/** True when the account sees no ads: its plan includes "no_ads" or it holds the "Sans pub" add-on. */
export function adFreeFor(plan: PlanCode | undefined, addOns: readonly string[] = []): boolean {
  if (addOns.includes("no_ads")) return true;
  return !!plan && planHas(plan, "no_ads");
}

/** « Google Agenda » is part of the plan (Affaires, Affaires Pro): no add-on, no trial. */
export function calendarIncludedIn(plan: PlanCode | undefined): boolean {
  return !!plan && planHas(plan, "calendar_sync");
}

/**
 * Who may use the Google Calendar connector: a plan that includes it, or a live "google_calendar" add-on (trialing
 * counts as live). The API also accepts members of a business whose account includes it (services/calendar.ts).
 */
export function calendarEntitled(plan: PlanCode | undefined, addOns: readonly string[] = []): boolean {
  return addOns.includes("google_calendar") || calendarIncludedIn(plan);
}
