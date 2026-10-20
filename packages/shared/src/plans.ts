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
  | "vm_email"
  /** Réunions MIMT: video meetings (LiveKit). Participant caps by plan in meetings.ts. */
  | "video_meetings";

export type PlanCode = "free" | "lock" | "premium" | "business" | "business_pro";

export interface PlanCaps {
  /** A real phone-network number comes with the plan. Free has none (MIMT-to-MIMT only). */
  hasNumber: boolean;
  /** Outbound PSTN minutes per billing month (Canada/US). */
  outboundMinutes: number;
  /** Inbound PSTN minutes per billing month. */
  inboundMinutes: number;
  /** Text messages per billing month, sent AND received (SMS segments + MMS): Twilio bills both directions. */
  messages: number;
  /** Of `messages`, the most MMS that may be sent. */
  mms: number;
  /** App-to-app call minutes; null = they draw from `outboundMinutes` (paid plans, cheaper than PSTN). */
  onNetMinutes: number | null;
  /** Voicemail transcription minutes (plans with vm_transcription). */
  transcriptionMinutes: number;
  /** Call recording minutes (plans with call_recording). */
  recordingMinutes: number;
  /** Max simultaneous calls per line. */
  concurrentCalls: number;
  /** Days without activity before a number enters grace; null = never (kept while the plan is paid). */
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

// Launch line-up (docs/MIMT-UNIT-ECONOMICS.md): worst-case carrier cost ≤ 70 % of the price after Stripe fees.
// The internal code `lock` is the Essentiel plan (DB constraints, Stripe metadata and store SKUs keep the code).
// The API can override prices and quotas from the environment (apps/api/src/plansConfig.ts), never past the rule.
export const PLANS: Record<PlanCode, Plan> = {
  free: {
    code: "free",
    name: { fr: "Gratuit", en: "Free" },
    monthlyPriceCents: 0,
    perLine: false,
    features: [],
    caps: {
      hasNumber: false,
      outboundMinutes: 0,
      inboundMinutes: 0,
      messages: 0,
      mms: 0,
      onNetMinutes: 120,
      transcriptionMinutes: 0,
      recordingMinutes: 0,
      concurrentCalls: 1,
      inactivityDays: 30,
    },
  },
  lock: {
    code: "lock",
    name: { fr: "Essentiel", en: "Essential" },
    monthlyPriceCents: 1299,
    perLine: false,
    features: ["number_lock", "vm_greeting", "vm_email"],
    caps: {
      hasNumber: true,
      outboundMinutes: 60,
      inboundMinutes: 120,
      messages: 150,
      mms: 0,
      onNetMinutes: null,
      transcriptionMinutes: 0,
      recordingMinutes: 0,
      concurrentCalls: 1,
      inactivityDays: null,
    },
  },
  premium: {
    code: "premium",
    name: { fr: "Premium", en: "Premium" },
    monthlyPriceCents: 2999,
    perLine: false,
    features: ["no_ads", "number_lock", "vm_transcription", "mms", "call_forwarding", "ai_assist", "vm_greeting", "vm_email", "video_meetings"],
    caps: {
      hasNumber: true,
      outboundMinutes: 200,
      inboundMinutes: 300,
      messages: 400,
      mms: 50,
      onNetMinutes: null,
      transcriptionMinutes: 20,
      recordingMinutes: 0,
      concurrentCalls: 2,
      inactivityDays: null,
    },
  },
  business: {
    code: "business",
    name: { fr: "Affaires", en: "Business" },
    monthlyPriceCents: 3499,
    perLine: true,
    features: ["no_ads", "number_lock", "vm_transcription", "mms", "call_forwarding", "auto_attendant", "ring_groups", "admin_portal", "ai_assist", "vm_greeting", "vm_email", "video_meetings"],
    caps: {
      hasNumber: true,
      outboundMinutes: 300,
      inboundMinutes: 400,
      messages: 300,
      mms: 50,
      onNetMinutes: null,
      transcriptionMinutes: 20,
      recordingMinutes: 0,
      concurrentCalls: 2,
      inactivityDays: null,
    },
  },
  business_pro: {
    code: "business_pro",
    name: { fr: "Affaires Pro", en: "Business Pro" },
    monthlyPriceCents: 4499,
    perLine: true,
    features: ["no_ads", "number_lock", "vm_transcription", "mms", "call_forwarding", "auto_attendant", "ring_groups", "admin_portal", "call_recording", "ai_assist", "vm_greeting", "vm_email", "video_meetings"],
    caps: {
      hasNumber: true,
      outboundMinutes: 350,
      inboundMinutes: 450,
      messages: 400,
      mms: 50,
      onNetMinutes: null,
      transcriptionMinutes: 20,
      recordingMinutes: 750,
      concurrentCalls: 4,
      inactivityDays: null,
    },
  },
};

/** Optional 7-day trial (TRIAL_ENABLED): card on file, a real number and this tiny quota. */
export const TRIAL_CAPS: PlanCaps = {
  ...PLANS.lock.caps,
  outboundMinutes: 20,
  inboundMinutes: 20,
  messages: 20,
  mms: 0,
};
export const TRIAL_DAYS = 7;

export const ADD_ONS = {
  extra_number: { name: { fr: "Numéro supplémentaire", en: "Extra number" }, monthlyPriceCents: 499 },
  // 250 × (0.014 + 0.004) USD × 1.40 = 6,30 $ of carrier cost: 9,99 $ keeps it under 70 % after Stripe.
  minutes_250: { name: { fr: "250 minutes de plus", en: "250 extra minutes" }, priceCents: 999 },
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
