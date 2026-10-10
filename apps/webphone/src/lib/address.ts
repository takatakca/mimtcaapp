// Canadian civic address helpers for the 9-1-1 form (pure). Copied from apps/mobile/src/lib/address.ts.

export const PROVINCES = ["QC", "ON", "NB", "NS", "PE", "NL", "MB", "SK", "AB", "BC", "YT", "NT", "NU"] as const;
export type Province = (typeof PROVINCES)[number];

// Canada Post: no D, F, I, O, Q, U anywhere; no W or Z in first position.
const POSTAL = /^([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z])\s?(\d[ABCEGHJ-NPRSTV-Z]\d)$/;

/** "h3b1a1" → "H3B 1A1"; null when invalid. */
export function normalizePostalCode(raw: string): string | null {
  const m = POSTAL.exec(raw.trim().toUpperCase().replace(/\s+/g, " "));
  return m ? `${m[1]} ${m[2]}` : null;
}
