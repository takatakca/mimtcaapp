// International per-minute retail rates, shown to the user before dialling (GET /v1/rates).
//
// PLACEHOLDER VALUES: the owner must confirm every rate against the carrier cost sheets (Twilio,
// Cuba SIP trunk) before launch. They are CAD cents per minute before taxes, billed per started minute
// from the prepaid international credit. Canada/US calls never use these: they count against plan minutes.

export interface IntlRate {
  /** E.164 prefix, "+" included (longest prefix wins). */
  prefix: string;
  country: { fr: string; en: string };
  centsPerMinute: number;
}

/** True while the table has not been confirmed by the owner. The API echoes it so apps can say "tarif indicatif". */
export const INTL_RATES_ARE_PLACEHOLDERS = true;

export const INTL_RATES: readonly IntlRate[] = [
  { prefix: "+33", country: { fr: "France", en: "France" }, centsPerMinute: 5 },
  { prefix: "+32", country: { fr: "Belgique", en: "Belgium" }, centsPerMinute: 6 },
  { prefix: "+41", country: { fr: "Suisse", en: "Switzerland" }, centsPerMinute: 6 },
  { prefix: "+44", country: { fr: "Royaume-Uni", en: "United Kingdom" }, centsPerMinute: 5 },
  { prefix: "+49", country: { fr: "Allemagne", en: "Germany" }, centsPerMinute: 5 },
  { prefix: "+39", country: { fr: "Italie", en: "Italy" }, centsPerMinute: 5 },
  { prefix: "+34", country: { fr: "Espagne", en: "Spain" }, centsPerMinute: 5 },
  { prefix: "+351", country: { fr: "Portugal", en: "Portugal" }, centsPerMinute: 6 },
  { prefix: "+31", country: { fr: "Pays-Bas", en: "Netherlands" }, centsPerMinute: 6 },
  { prefix: "+52", country: { fr: "Mexique", en: "Mexico" }, centsPerMinute: 8 },
  { prefix: "+86", country: { fr: "Chine", en: "China" }, centsPerMinute: 5 },
  { prefix: "+91", country: { fr: "Inde", en: "India" }, centsPerMinute: 8 },
  { prefix: "+63", country: { fr: "Philippines", en: "Philippines" }, centsPerMinute: 25 },
  { prefix: "+84", country: { fr: "Viêt Nam", en: "Vietnam" }, centsPerMinute: 20 },
  { prefix: "+57", country: { fr: "Colombie", en: "Colombia" }, centsPerMinute: 10 },
  { prefix: "+55", country: { fr: "Brésil", en: "Brazil" }, centsPerMinute: 10 },
  { prefix: "+54", country: { fr: "Argentine", en: "Argentina" }, centsPerMinute: 10 },
  { prefix: "+961", country: { fr: "Liban", en: "Lebanon" }, centsPerMinute: 30 },
  { prefix: "+212", country: { fr: "Maroc", en: "Morocco" }, centsPerMinute: 45 },
  { prefix: "+213", country: { fr: "Algérie", en: "Algeria" }, centsPerMinute: 45 },
  { prefix: "+216", country: { fr: "Tunisie", en: "Tunisia" }, centsPerMinute: 45 },
  { prefix: "+221", country: { fr: "Sénégal", en: "Senegal" }, centsPerMinute: 50 },
  { prefix: "+225", country: { fr: "Côte d'Ivoire", en: "Côte d'Ivoire" }, centsPerMinute: 50 },
  { prefix: "+237", country: { fr: "Cameroun", en: "Cameroon" }, centsPerMinute: 50 },
  { prefix: "+509", country: { fr: "Haïti", en: "Haiti" }, centsPerMinute: 55 },
  { prefix: "+53", country: { fr: "Cuba", en: "Cuba" }, centsPerMinute: 120 },
  { prefix: "+1876", country: { fr: "Jamaïque", en: "Jamaica" }, centsPerMinute: 35 },
  { prefix: "+1809", country: { fr: "République dominicaine", en: "Dominican Republic" }, centsPerMinute: 25 },
  { prefix: "+1829", country: { fr: "République dominicaine", en: "Dominican Republic" }, centsPerMinute: 25 },
  { prefix: "+1849", country: { fr: "République dominicaine", en: "Dominican Republic" }, centsPerMinute: 25 },
];

/**
 * International credit on the free plan (parity P1 item 9) comes with stricter fraud limits than paid plans
 * (100 $ max top-up, every allowed destination). The free destination list lives in apps/api/src/fraud/destinations.ts.
 */
export const FREE_PLAN_INTL_LIMITS = {
  /** Max amount of one top-up, CAD cents. */
  maxTopUpCents: 1000,
  /** Max credit balance after a top-up, CAD cents. */
  maxBalanceCents: 2000,
  /** Top-up checkouts that can be started per rolling 24 hours. */
  checkoutsPerDay: 3,
  /** Longest single international call, minutes. */
  maxCallMinutes: 30,
} as const;

/** Longest-prefix match. Undefined when the destination is not in the table (the API then uses its default rate). */
export function intlRateFor(e164: string): IntlRate | undefined {
  let best: IntlRate | undefined;
  for (const rate of INTL_RATES) {
    if (e164.startsWith(rate.prefix) && (!best || rate.prefix.length > best.prefix.length)) best = rate;
  }
  return best;
}
