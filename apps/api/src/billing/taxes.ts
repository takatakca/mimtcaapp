import type { CheckoutLine } from "../gateways/billing.js";

/** GST 5% and QST 9.975%, both on the pre-tax price (Revenu Québec, since 2013). */
export const GST_RATE = 0.05;
export const QST_RATE = 0.09975;
/** Quebec municipal 9-1-1 tax, CAD cents per number per month (2026). */
export const E911_CENTS_PER_NUMBER_MONTH = 55;

const roundCents = (n: number) => Math.round(n);

export interface TaxInput {
  baseUnitCents: number;
  quantity: number;
  recurring: "month" | "year" | null;
  /** Per-number monthly 9-1-1 tax. Off for one-time credits and minute packs. */
  chargeE911: boolean;
  locale: "fr-CA" | "en-CA";
}

/** Extra checkout lines so TPS, TVQ and the 9-1-1 tax appear on the invoice. */
export function quebecTaxLines(input: TaxInput): CheckoutLine[] {
  const base = input.baseUnitCents * input.quantity;
  const fr = input.locale === "fr-CA";
  const recurring = input.recurring ?? undefined;
  const lines: CheckoutLine[] = [
    {
      name: fr ? "TPS (5 %)" : "GST (5%)",
      description: fr ? "Taxe sur les produits et services" : "Goods and services tax",
      unitAmountCents: roundCents(base * GST_RATE),
      quantity: 1,
      ...(recurring ? { recurring } : {}),
    },
    {
      name: fr ? "TVQ (9,975 %)" : "QST (9.975%)",
      description: fr ? "Taxe de vente du Québec" : "Quebec sales tax",
      unitAmountCents: roundCents(base * QST_RATE),
      quantity: 1,
      ...(recurring ? { recurring } : {}),
    },
  ];
  if (input.chargeE911 && input.recurring) {
    const months = input.recurring === "year" ? 12 : 1;
    lines.push({
      name: fr ? "Taxe municipale 9-1-1 du Québec" : "Quebec municipal 9-1-1 tax",
      description: fr ? "0,55 $ par numéro et par mois" : "$0.55 per number per month",
      unitAmountCents: E911_CENTS_PER_NUMBER_MONTH * input.quantity * months,
      quantity: 1,
      recurring: input.recurring,
    });
  }
  return lines.filter((line) => line.unitAmountCents > 0);
}
