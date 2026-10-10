// Subscription add-ons sold on their own, next to a plan (parity P1 item 1: "Sans pub").
// Additive to PLANS / ADD_ONS in plans.ts: prices there are an owner decision and stay as they are.
// Prices are CAD cents before taxes (GST/QST added on the bill; no 9-1-1 tax: an add-on is not a number).

import { planHas, type Feature, type PlanCode } from "./plans.js";

export type SubscriptionAddOnCode = "no_ads";

export interface SubscriptionAddOn {
  code: SubscriptionAddOnCode;
  name: { fr: string; en: string };
  description: { fr: string; en: string };
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  /** Features the add-on grants on top of the plan. */
  features: readonly Feature[];
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
};

export function isSubscriptionAddOn(code: string): code is SubscriptionAddOnCode {
  return code in SUBSCRIPTION_ADD_ONS;
}

/** App Store and Play product ids for add-ons (separate from the plan SKUs in STORE_PRODUCTS). */
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
