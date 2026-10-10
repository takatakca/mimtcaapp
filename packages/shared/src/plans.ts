// Plans, prices and caps. Source of truth: docs/MIMT-MVP.md §6 and docs/MIMT-STACK.md §2.
// Prices are CAD cents before taxes (GST/QST and the Quebec 9-1-1 municipal tax are added on the bill).

export type Feature =
  | "no_ads"
  | "number_lock"
  | "vm_transcription"
  | "intl_calling"
  | "extra_number"
  | "mms"
  | "call_forwarding"
  | "call_recording"
  | "auto_attendant"
  | "ring_groups"
  | "admin_portal"
  /** Claude-powered assistance: smart SMS replies, AI receptionist (business). See ai.ts. */
  | "ai_assist"
  /** Custom voicemail greeting (recorded or uploaded), played instead of the default French/English one. */
  | "vm_greeting"
  /** Voicemail to email (courriel): transcript + a signed, expiring audio link. */
  | "vm_email";

export type PlanCode = "free" | "lock" | "premium" | "business" | "business_pro";

export interface PlanCaps {
  /** Outbound PSTN minutes per billing month (Canada/US). */
  outboundMinutes: number;
  /** Inbound PSTN minutes per billing month. */
  inboundMinutes: number;
  /** Outbound SMS segments per billing month. */
  outboundSms: number;
  /** Max simultaneous calls per line. */
  concurrentCalls: number;
  /** Days without activity before a number enters grace; null = never (locked). */
  inactivityDays: number | null;
}

export interface Plan {
  code: PlanCode;
  name: { fr: string; en: string };
  monthlyPriceCents: number;
  yearlyPriceCents?: number;
  perLine: boolean;
  features: readonly Feature[];
  caps: PlanCaps;
}

export const PLANS: Record<PlanCode, Plan> = {
  free: {
    code: "free",
    name: { fr: "Gratuit", en: "Free" },
    monthlyPriceCents: 0,
    perLine: false,
    features: [],
    caps: { outboundMinutes: 30, inboundMinutes: 60, outboundSms: 50, concurrentCalls: 1, inactivityDays: 30 },
  },
  lock: {
    code: "lock",
    name: { fr: "Verrouillage du numéro", en: "Number Lock" },
    monthlyPriceCents: 499,
    yearlyPriceCents: 3999,
    perLine: false,
    features: ["number_lock", "vm_greeting", "vm_email"],
    caps: { outboundMinutes: 30, inboundMinutes: 60, outboundSms: 50, concurrentCalls: 1, inactivityDays: null },
  },
  premium: {
    code: "premium",
    name: { fr: "Premium", en: "Premium" },
    monthlyPriceCents: 1999,
    perLine: false,
    features: ["no_ads", "number_lock", "vm_transcription", "mms", "call_forwarding", "ai_assist", "vm_greeting", "vm_email"],
    caps: { outboundMinutes: 500, inboundMinutes: 1000, outboundSms: 500, concurrentCalls: 2, inactivityDays: null },
  },
  business: {
    code: "business",
    name: { fr: "Affaires", en: "Business" },
    monthlyPriceCents: 3499,
    perLine: true,
    features: ["no_ads", "number_lock", "vm_transcription", "mms", "call_forwarding", "auto_attendant", "ring_groups", "admin_portal", "ai_assist", "vm_greeting", "vm_email"],
    caps: { outboundMinutes: 1000, inboundMinutes: 2000, outboundSms: 500, concurrentCalls: 2, inactivityDays: null },
  },
  business_pro: {
    code: "business_pro",
    name: { fr: "Affaires Pro", en: "Business Pro" },
    monthlyPriceCents: 4499,
    perLine: true,
    features: ["no_ads", "number_lock", "vm_transcription", "mms", "call_forwarding", "auto_attendant", "ring_groups", "admin_portal", "call_recording", "ai_assist", "vm_greeting", "vm_email"],
    caps: { outboundMinutes: 1000, inboundMinutes: 2000, outboundSms: 1000, concurrentCalls: 4, inactivityDays: null },
  },
};

export const ADD_ONS = {
  extra_number: { name: { fr: "Numéro supplémentaire", en: "Extra number" }, monthlyPriceCents: 499 },
  minutes_250: { name: { fr: "250 minutes de plus", en: "250 extra minutes" }, priceCents: 799 },
  intl_credit_min: { name: { fr: "Crédit international (prépayé)", en: "International credit (prepaid)" }, priceCents: 500 },
} as const;

export function planHas(plan: PlanCode, feature: Feature): boolean {
  return PLANS[plan].features.includes(feature);
}

/** App Store and Play product ids. Business plans stay on the web (Stripe). */
export const STORE_PRODUCTS = {
  "ca.mimt.app.lock.monthly": { plan: "lock", interval: "month" },
  "ca.mimt.app.lock.yearly": { plan: "lock", interval: "year" },
  "ca.mimt.app.premium.monthly": { plan: "premium", interval: "month" },
  "ca.mimt.app.premium.yearly": { plan: "premium", interval: "year" },
} as const satisfies Record<string, { plan: "lock" | "premium"; interval: "month" | "year" }>;

export function storeProduct(id: string): (typeof STORE_PRODUCTS)[keyof typeof STORE_PRODUCTS] | undefined {
  if (id in STORE_PRODUCTS) return STORE_PRODUCTS[id as keyof typeof STORE_PRODUCTS];
  return undefined;
}

/** Format CAD cents the Quebec way: "19,99 $" (fr) or "$19.99" (en). */
export function formatCad(cents: number, locale: "fr" | "en" = "fr"): string {
  return new Intl.NumberFormat(locale === "fr" ? "fr-CA" : "en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}
