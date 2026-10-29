// MIMT Points on the web app (apps/api services/points.ts): the API credits every point itself from a verified
// event; the app shows the balance, the catalog and the history, and asks to redeem. A redemption carries a key
// made once per confirmation, so a double click or a retry never spends twice.
import { MISSIONS, POINTS_CATALOG, type PointsEntryDto } from "@mimt/shared";

/** Fired after the balance changed in this tab (a redemption); the sidebar badge and the toaster re-read it. */
export const POINTS_EVENT = "mimt:points";

export function announcePoints(balance?: number): void {
  window.dispatchEvent(new CustomEvent<number | undefined>(POINTS_EVENT, { detail: balance }));
}

/** A fresh idempotency key for POST /v1/points/redeem. */
export function newRedeemKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** "1 500" (fr) / "1,500" (en). */
export const formatPoints = (n: number, lang: "fr" | "en") => n.toLocaleString(lang === "fr" ? "fr-CA" : "en-CA");

/** Human label of a history line, from the API's label (never personal data). */
export function entryLabel(e: Pick<PointsEntryDto, "label" | "reason" | "campaignName">, lang: "fr" | "en"): string {
  const fr = lang === "fr";
  const pair = (head: string, tail: string) => (fr ? `${head} : ${tail}` : `${head}: ${tail}`);
  if (e.reason === "campaign") return pair(fr ? "Campagne" : "Campaign", e.campaignName ?? "promotion");
  if (e.reason === "expiry") return fr ? "Expiration (inactivité)" : "Expiry (inactivity)";
  if (e.reason === "clawback") {
    return e.label === "owed" ? (fr ? "Points dus repris" : "Owed points taken back") : fr ? "Paiement remboursé : points retirés" : "Payment refunded: points removed";
  }
  const [kind, id = ""] = e.label.split(":");
  if (kind === "mission") return pair("Mission", MISSIONS.find((x) => x.id === id)?.label[lang] ?? id);
  if (kind === "reward") {
    const name = POINTS_CATALOG.find((x) => x.id === id)?.label[lang] ?? id;
    return e.reason === "refund" ? pair(fr ? "Points remis" : "Points returned", name) : name;
  }
  if (kind === "invoice") return fr ? "Facture payée" : "Bill paid";
  if (kind === "store") return fr ? "Abonnement App Store ou Google Play" : "App Store or Google Play subscription";
  if (kind === "referral") return fr ? "Un ami s'est abonné" : "A friend subscribed";
  return e.label;
}

/** Credits the toaster celebrates: new since the last one seen in this browser, missions excluded (they have their own toast). */
export function newCredits(history: readonly PointsEntryDto[], lastSeenId: string | null): PointsEntryDto[] {
  const out: PointsEntryDto[] = [];
  for (const e of history) {
    if (e.id === lastSeenId) break;
    if (e.delta > 0 && e.reason !== "mission" && e.reason !== "refund") out.push(e);
  }
  return lastSeenId === null ? [] : out;
}
