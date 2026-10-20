// Live number picker (mimt.ca hero, app.mimt.ca, Affaires page): what a visitor types → Canadian area codes,
// and the public search / hold contract. API: apps/api/src/routes/numberPicker.ts.
//
// Honest urgency only: a hold is real (no other MIMT customer can take the number for NUMBER_HOLD_MINUTES) and the
// count shown is the real count returned by the carrier. Nothing here invents scarcity.

/** How long a picked number stays reserved for the visitor before sign-up and payment. */
export const NUMBER_HOLD_MINUTES = 10;
/** Once Stripe Checkout is open the hold follows the checkout session (Stripe's minimum lifetime is 30 minutes). */
export const NUMBER_CHECKOUT_HOLD_MINUTES = 30;
/** Public search results are cached this long per area code (carrier API cost and rate limits). */
export const NUMBER_SEARCH_CACHE_SECONDS = 60;

export type Province = "QC" | "ON" | "BC" | "AB" | "MB" | "SK" | "NS" | "NB" | "NL" | "PE" | "YT" | "NT" | "NU";

/** Canadian geographic area codes (CNA, 2026). Overlays included. */
export const CANADIAN_AREA_CODES: Readonly<Record<string, Province>> = {
  // Québec
  "418": "QC", "581": "QC", "367": "QC",
  "450": "QC", "579": "QC", "354": "QC",
  "514": "QC", "438": "QC", "263": "QC",
  "819": "QC", "873": "QC", "468": "QC",
  // Ontario
  "416": "ON", "647": "ON", "437": "ON", "942": "ON",
  "905": "ON", "289": "ON", "365": "ON", "742": "ON",
  "613": "ON", "343": "ON", "753": "ON",
  "519": "ON", "226": "ON", "548": "ON", "382": "ON",
  "705": "ON", "249": "ON", "683": "ON",
  "807": "ON",
  // Prairies, BC, Atlantic, North
  "204": "MB", "431": "MB", "584": "MB",
  "306": "SK", "639": "SK", "474": "SK",
  "403": "AB", "587": "AB", "780": "AB", "825": "AB", "368": "AB",
  "604": "BC", "778": "BC", "236": "BC", "672": "BC", "250": "BC", "257": "BC",
  "902": "NS", "782": "NS",
  "506": "NB", "428": "NB",
  "709": "NL", "879": "NL",
  "867": "YT",
};

export interface PlaceAreaCodes {
  label: { fr: string; en: string };
  areaCodes: readonly string[];
}

/** Places people type, in the order the hero suggests them. Keys are normalised (lowercase, no accents). */
export const NUMBER_PLACES: Readonly<Record<string, PlaceAreaCodes>> = {
  montreal: { label: { fr: "Montréal", en: "Montréal" }, areaCodes: ["514", "438", "263"] },
  laval: { label: { fr: "Laval", en: "Laval" }, areaCodes: ["450", "579", "354"] },
  longueuil: { label: { fr: "Longueuil", en: "Longueuil" }, areaCodes: ["450", "579", "354"] },
  "rive-sud": { label: { fr: "Rive-Sud", en: "South Shore" }, areaCodes: ["450", "579", "354"] },
  "rive-nord": { label: { fr: "Rive-Nord", en: "North Shore" }, areaCodes: ["450", "579", "354"] },
  laurentides: { label: { fr: "Laurentides", en: "Laurentides" }, areaCodes: ["450", "579", "819", "873"] },
  quebec: { label: { fr: "Québec", en: "Québec City" }, areaCodes: ["418", "581", "367"] },
  levis: { label: { fr: "Lévis", en: "Lévis" }, areaCodes: ["418", "581", "367"] },
  saguenay: { label: { fr: "Saguenay", en: "Saguenay" }, areaCodes: ["418", "581", "367"] },
  rimouski: { label: { fr: "Rimouski", en: "Rimouski" }, areaCodes: ["418", "581", "367"] },
  gatineau: { label: { fr: "Gatineau", en: "Gatineau" }, areaCodes: ["819", "873", "468"] },
  sherbrooke: { label: { fr: "Sherbrooke", en: "Sherbrooke" }, areaCodes: ["819", "873", "468"] },
  "trois-rivieres": { label: { fr: "Trois-Rivières", en: "Trois-Rivières" }, areaCodes: ["819", "873", "468"] },
  drummondville: { label: { fr: "Drummondville", en: "Drummondville" }, areaCodes: ["819", "873", "468"] },
  toronto: { label: { fr: "Toronto", en: "Toronto" }, areaCodes: ["416", "647", "437"] },
  ottawa: { label: { fr: "Ottawa", en: "Ottawa" }, areaCodes: ["613", "343"] },
  mississauga: { label: { fr: "Mississauga", en: "Mississauga" }, areaCodes: ["905", "289", "365"] },
  hamilton: { label: { fr: "Hamilton", en: "Hamilton" }, areaCodes: ["905", "289", "365"] },
  london: { label: { fr: "London", en: "London" }, areaCodes: ["519", "226", "548"] },
  vancouver: { label: { fr: "Vancouver", en: "Vancouver" }, areaCodes: ["604", "778", "236"] },
  calgary: { label: { fr: "Calgary", en: "Calgary" }, areaCodes: ["403", "587", "825"] },
  edmonton: { label: { fr: "Edmonton", en: "Edmonton" }, areaCodes: ["780", "587", "825"] },
  winnipeg: { label: { fr: "Winnipeg", en: "Winnipeg" }, areaCodes: ["204", "431"] },
  halifax: { label: { fr: "Halifax", en: "Halifax" }, areaCodes: ["902", "782"] },
  moncton: { label: { fr: "Moncton", en: "Moncton" }, areaCodes: ["506", "428"] },
};

/** Area codes the hero suggests as one-tap chips. */
export const SUGGESTED_AREA_CODES = ["514", "438", "450", "418", "581", "819", "873", "367", "579", "354", "263", "468"] as const;

const normalise = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

export interface ResolvedNumberQuery {
  areaCodes: string[];
  label: { fr: string; en: string };
}

/** "514", "(514)", "Montréal", "trois rivieres" → area codes. Null when it is not a Canadian place or area code. */
export function resolveNumberQuery(raw: string): ResolvedNumberQuery | null {
  const q = (raw ?? "").slice(0, 60);
  const digits = q.replace(/\D/g, "");
  if (/^\s*\(?\d{3}\)?\s*$/.test(q) && CANADIAN_AREA_CODES[digits]) return { areaCodes: [digits], label: { fr: digits, en: digits } };
  const key = normalise(q);
  if (key.length < 2) return null;
  const exact = NUMBER_PLACES[key];
  if (exact) return { areaCodes: [...exact.areaCodes], label: exact.label };
  // Prefix match ("mont" → Montréal), first in table order.
  const hit = Object.entries(NUMBER_PLACES).find(([k]) => k.startsWith(key));
  return hit ? { areaCodes: [...hit[1].areaCodes], label: hit[1].label } : null;
}

export interface PublicNumber {
  e164: string;
  locality: string | null;
  region: string | null;
}

export interface PublicNumberSearchResponse {
  label: { fr: string; en: string };
  areaCodes: string[];
  /** Real numbers the carrier offers right now, minus those MIMT holds or assigns. */
  numbers: PublicNumber[];
}

export type NumberHoldStatus = "held" | "checkout" | "converted" | "expired" | "released" | "failed";

export interface NumberHoldResponse {
  id: string;
  e164: string;
  status: NumberHoldStatus;
  expiresAt: string;
  /** Only on creation: the secret that proves the visitor owns the hold (kept in the browser, never in a URL log). */
  token?: string;
}

/** "+15145550199" → "514 555-0199" (Québec style) or "(514) 555-0199" (en). */
export function formatNanp(e164: string, lang: "fr" | "en" = "fr"): string {
  const d = e164.replace(/^\+1/, "");
  if (!/^\d{10}$/.test(d)) return e164;
  return lang === "fr" ? `${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6)}` : `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
