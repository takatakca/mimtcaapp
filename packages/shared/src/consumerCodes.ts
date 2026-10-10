// CRTC Wireless Code (TRP 2013-271, revised 2017-200), Internet Code (TRP 2019-269) and Quebec
// Consumer Protection Act (LPC art. 214.1 ss.) helpers: contract summary, bill shock, cancellation.
// Pure functions, French first. Every number below is a CONFIGURABLE constant: à valider par l'avocat
// avant le lancement (docs/MIMT-RESALE.md › Conformité). This is not legal advice.

import { consumerCodeFor, isInternetLine, type ConsumerCode, type LocalizedText, type Offer, type ProductLine } from "./catalog.js";
import { formatCad } from "./plans.js";

export const CONSUMER_CODE_RULES = {
  /** Wireless Code: no commitment longer than 24 months. À valider par l'avocat. */
  maxTermMonths: 24,
  /** Wireless Code: trial period, 15 calendar days. À valider par l'avocat. */
  wirelessTrialDays: 15,
  /** Wireless Code: 30 days for customers with a disability. À valider par l'avocat. */
  wirelessTrialDaysAccessibility: 30,
  /** Wireless Code: no fee if usage during the trial is under half of the monthly allowance. À valider par l'avocat. */
  wirelessTrialUsageFraction: 0.5,
  /**
   * Internet Code trial period for fixed-term contracts. [VERIFY] à valider par l'avocat
   * (applies today to large ISPs only; MIMT applies it voluntarily).
   */
  internetTrialDays: 30,
  /** Wireless Code: data overage charges suspended at $50/month unless the account holder consents. À valider par l'avocat. */
  dataOverageCapCents: 5_000,
  /** Wireless Code: data roaming charges suspended at $100/month unless consent. À valider par l'avocat. */
  roamingCapCents: 10_000,
  /**
   * Term contract with no discount/subsidy: fee ≤ lesser of $50 or 10 % of the remaining monthly charges
   * (Wireless Code; LPC art. 214.7). À valider par l'avocat.
   */
  noDiscountFeeMaxCents: 5_000,
  noDiscountFeePercent: 10,
  /** Usage notifications (Internet Code: 50/75/100 %; same for mobile data). À valider par l'avocat. */
  usageThresholds: [50, 75, 100] as readonly number[],
  /** Permanent copy of the contract sent within 15 days of agreement. À valider par l'avocat. */
  permanentCopyDays: 15,
  /** Quebec municipal 9-1-1 tax, per number per month, 2026 (MIMT-REGULATORY.md §11). [VERIFY] each year. */
  quebec911TaxCents: 55,
} as const;

/** Bump when the summary wording changes: customers must accept the new version. */
export const CONTRACT_SUMMARY_TEMPLATE = "cis-2026-10-draft-1";

export interface SummarySection {
  heading: string;
  lines: string[];
}

export interface SummaryDocument {
  locale: "fr-CA" | "en-CA";
  title: string;
  sections: SummarySection[];
}

export interface ContractSummary {
  /** Stable for the same offer and wording; stored with the customer's acceptance. */
  version: string;
  offerCode: string;
  code: ConsumerCode;
  /** French first. */
  fr: SummaryDocument;
  en: SummaryDocument;
}

/** FNV-1a 32-bit (pure, no crypto dependency: the package also runs in the mobile app). */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

type SummaryOffer = Pick<
  Offer<unknown>,
  "code" | "productLine" | "name" | "description" | "monthlyPriceCents" | "setupFeeCents" | "termMonths" | "discountCents" | "attributes"
>;

const qty = (v: number | null | undefined, unit: string, unlimited: string) => (v === null || v === undefined ? unlimited : `${v} ${unit}`);

function buildDoc(offer: SummaryOffer, lang: "fr" | "en"): SummaryDocument {
  const fr = lang === "fr";
  const R = CONSUMER_CODE_RULES;
  const money = (c: number) => formatCad(c, lang);
  const code = consumerCodeFor(offer.productLine);
  const a = offer.attributes;
  const sections: SummarySection[] = [];

  // 1. Services
  const services: string[] = [`${fr ? offer.name.fr : offer.name.en} — ${fr ? offer.description.fr : offer.description.en}`];
  if (offer.productLine === "mobile") {
    services.push(
      fr
        ? `Données : ${qty(a.dataGb, "Go", "illimitées")}${a.throttleKbps ? ` (vitesse réduite à ${a.throttleKbps} kbit/s ensuite, sans frais)` : ""}`
        : `Data: ${qty(a.dataGb, "GB", "unlimited")}${a.throttleKbps ? ` (reduced to ${a.throttleKbps} kbps afterwards, no charge)` : ""}`,
      fr ? `Appels au Canada : ${qty(a.minutes, "minutes", "illimités")}` : `Canada-wide calling: ${qty(a.minutes, "minutes", "unlimited")}`,
      fr ? `Textos : ${qty(a.sms, "", "illimités").trim()}` : `Texts: ${qty(a.sms, "", "unlimited").trim()}`,
    );
    if (a.overagePerGbCents) services.push(fr ? `Données additionnelles : ${money(a.overagePerGbCents)} par Go` : `Extra data: ${money(a.overagePerGbCents)} per GB`);
  }
  if (isInternetLine(offer.productLine)) {
    services.push(
      fr
        ? `Vitesse : jusqu'à ${a.downloadMbps ?? "?"} Mbit/s en téléchargement et ${a.uploadMbps ?? "?"} Mbit/s en téléversement (vitesses maximales, non garanties)`
        : `Speed: up to ${a.downloadMbps ?? "?"} Mbps download and ${a.uploadMbps ?? "?"} Mbps upload (maximum, not guaranteed)`,
      fr ? `Utilisation mensuelle : ${qty(a.internetDataGb, "Go", "illimitée")}` : `Monthly usage: ${qty(a.internetDataGb, "GB", "unlimited")}`,
    );
  }
  sections.push({ heading: fr ? "Services inclus" : "Included services", lines: services });

  // 2. Price
  const price = [
    fr ? `Frais mensuels minimaux : ${money(offer.monthlyPriceCents)} avant taxes` : `Minimum monthly charge: ${money(offer.monthlyPriceCents)} before taxes`,
    offer.setupFeeCents > 0
      ? fr
        ? `Frais uniques : ${money(offer.setupFeeCents)} (activation / installation)`
        : `One-time fees: ${money(offer.setupFeeCents)} (activation / installation)`
      : fr
        ? "Aucuns frais uniques"
        : "No one-time fees",
    offer.productLine === "mobile"
      ? fr
        ? `Taxes en sus : TPS, TVQ et taxe municipale 9-1-1 du Québec (${money(R.quebec911TaxCents)} par mois par numéro).`
        : `Taxes extra: GST, QST and the Quebec municipal 9-1-1 tax (${money(R.quebec911TaxCents)} per month per number).`
      : fr
        ? "Taxes en sus : TPS et TVQ."
        : "Taxes extra: GST and QST.",
  ];
  sections.push({ heading: fr ? "Prix" : "Price", lines: price });

  // 3. Term and cancellation
  const term: string[] = [];
  if (offer.termMonths === 0) {
    term.push(fr ? "Sans engagement (de mois en mois)." : "No commitment (month to month).");
    term.push(fr ? "Aucuns frais de résiliation." : "No cancellation fee.");
  } else {
    term.push(fr ? `Engagement : ${offer.termMonths} mois.` : `Commitment: ${offer.termMonths} months.`);
    if (offer.discountCents > 0) {
      const perMonth = Math.round(offer.discountCents / offer.termMonths);
      term.push(
        fr
          ? `Frais de résiliation anticipée : au plus ${money(offer.discountCents)} (valeur du rabais${offer.productLine === "mobile" ? " sur l'appareil" : ""}), réduits d'environ ${money(perMonth)} par mois, à 0 $ à la fin de l'engagement.`
          : `Early cancellation fee: at most ${money(offer.discountCents)} (value of the ${offer.productLine === "mobile" ? "device " : ""}discount), reduced by about ${money(perMonth)} per month, $0 at the end of the commitment.`,
      );
    } else {
      term.push(
        fr
          ? `Frais de résiliation anticipée : le moindre de ${money(R.noDiscountFeeMaxCents)} ou ${R.noDiscountFeePercent} % des frais mensuels restants.`
          : `Early cancellation fee: the lesser of ${money(R.noDiscountFeeMaxCents)} or ${R.noDiscountFeePercent}% of the remaining monthly charges.`,
      );
    }
  }
  term.push(
    fr
      ? "Vous pouvez résilier en tout temps ; la résiliation prend effet le jour où nous recevons votre avis."
      : "You may cancel at any time; cancellation takes effect the day we receive your notice.",
  );
  sections.push({ heading: fr ? "Durée et résiliation" : "Term and cancellation", lines: term });

  // 4. Trial period
  if (code === "wireless") {
    sections.push({
      heading: fr ? "Période d'essai" : "Trial period",
      lines: [
        fr
          ? `Vous pouvez annuler sans frais dans les ${R.wirelessTrialDays} jours (${R.wirelessTrialDaysAccessibility} jours pour les personnes ayant un handicap) si vous avez utilisé moins de ${R.wirelessTrialUsageFraction * 100} % de vos limites mensuelles et retournez l'appareil en état quasi neuf.`
          : `You may cancel at no charge within ${R.wirelessTrialDays} days (${R.wirelessTrialDaysAccessibility} days for persons with disabilities) if you used less than ${R.wirelessTrialUsageFraction * 100}% of your monthly limits and return the device in near-new condition.`,
      ],
    });
  } else if (code === "internet" && offer.termMonths > 0) {
    sections.push({
      heading: fr ? "Période d'essai" : "Trial period",
      lines: [
        fr
          ? `Vous pouvez annuler sans frais de résiliation dans les ${R.internetTrialDays} jours suivant l'activation.`
          : `You may cancel without a cancellation fee within ${R.internetTrialDays} days of activation.`,
      ],
    });
  }

  // 5. Bill shock / usage
  if (code === "wireless") {
    sections.push({
      heading: fr ? "Plafonds de frais" : "Charge caps",
      lines: [
        fr
          ? `Les frais de données excédentaires sont suspendus à ${money(R.dataOverageCapCents)} par mois et les frais d'itinérance de données à ${money(R.roamingCapCents)} par mois, sauf si le titulaire du compte accepte expressément de payer davantage.`
          : `Data overage charges are suspended at ${money(R.dataOverageCapCents)} per month and data roaming charges at ${money(R.roamingCapCents)} per month, unless the account holder expressly agrees to pay more.`,
        fr
          ? `Avis à ${R.usageThresholds.join(" %, ")} % de vos données et dès que des frais d'itinérance s'appliquent.`
          : `Notices at ${R.usageThresholds.join("%, ")}% of your data and as soon as roaming charges apply.`,
        fr ? "Votre appareil est déverrouillé, sans frais." : "Your device is unlocked, at no charge.",
      ],
    });
  } else if (code === "internet") {
    sections.push({
      heading: fr ? "Avis d'utilisation" : "Usage notices",
      lines: [
        fr
          ? `Si votre forfait comporte une limite, nous vous avisons à ${R.usageThresholds.join(" %, ")} % de l'utilisation.`
          : `If your plan has a limit, we notify you at ${R.usageThresholds.join("%, ")}% of usage.`,
      ],
    });
  }

  // 6. Rights
  sections.push({
    heading: fr ? "Vos droits" : "Your rights",
    lines: [
      code === "wireless"
        ? fr
          ? "Ce contrat est régi par le Code sur les services sans fil du CRTC et la Loi sur la protection du consommateur du Québec."
          : "This contract is governed by the CRTC Wireless Code and the Quebec Consumer Protection Act."
        : code === "internet"
          ? fr
            ? "Ce contrat suit le Code sur les services Internet du CRTC et la Loi sur la protection du consommateur du Québec."
            : "This contract follows the CRTC Internet Code and the Quebec Consumer Protection Act."
          : fr
            ? "Ce contrat est régi par la Loi sur la protection du consommateur du Québec."
            : "This contract is governed by the Quebec Consumer Protection Act.",
      fr
        ? `Vous recevrez une copie permanente du contrat dans les ${R.permanentCopyDays} jours.`
        : `You will receive a permanent copy of the contract within ${R.permanentCopyDays} days.`,
      fr
        ? "Plainte non réglée : Commission des plaintes relatives aux services en télécom-télévision (CPRST), www.ccts-cprst.ca, 1-888-221-1687."
        : "Unresolved complaint: Commission for Complaints for Telecom-television Services (CCTS), www.ccts-cprst.ca, 1-888-221-1687.",
    ],
  });

  return {
    locale: fr ? "fr-CA" : "en-CA",
    title: fr ? "Résumé des renseignements essentiels" : "Critical Information Summary",
    sections,
  };
}

/** Builds the Critical Information Summary (French first) for an offer. */
export function generateContractSummary(offer: SummaryOffer): ContractSummary {
  if (offer.termMonths < 0 || offer.termMonths > CONSUMER_CODE_RULES.maxTermMonths) {
    throw new Error(`termMonths must be between 0 and ${CONSUMER_CODE_RULES.maxTermMonths}`);
  }
  const fr = buildDoc(offer, "fr");
  const en = buildDoc(offer, "en");
  const version = `${CONTRACT_SUMMARY_TEMPLATE}:${offer.code}:${fnv1a(JSON.stringify([fr, en]))}`;
  return { version, offerCode: offer.code, code: consumerCodeFor(offer.productLine), fr, en };
}

export function renderSummaryText(doc: SummaryDocument): string {
  return [doc.title, "", ...doc.sections.flatMap((s) => [s.heading, ...s.lines.map((l) => `• ${l}`), ""])].join("\n").trim();
}

// ------------------------------------------------------------------------------- bill shock

/** Thresholds (percent) newly crossed and not yet notified. allowance null/0 = unlimited: none. */
export function usageThresholdsToNotify(usedMb: number, allowanceMb: number | null, alreadyNotified: readonly number[]): number[] {
  if (!allowanceMb || allowanceMb <= 0) return [];
  const pct = (usedMb / allowanceMb) * 100;
  return CONSUMER_CODE_RULES.usageThresholds.filter((t) => pct >= t && !alreadyNotified.includes(t));
}

export function usageNoticeText(threshold: number, line: ProductLine): LocalizedText {
  const what = line === "mobile" ? { fr: "de vos données mobiles", en: "of your mobile data" } : { fr: "de votre utilisation Internet", en: "of your Internet usage" };
  if (threshold >= 100) {
    return {
      fr: `Vous avez utilisé 100 % ${what.fr} ce mois-ci.${line === "mobile" ? ` Les frais excédentaires sont plafonnés à ${formatCad(CONSUMER_CODE_RULES.dataOverageCapCents, "fr")} sans votre accord.` : ""}`,
      en: `You have used 100% ${what.en} this month.${line === "mobile" ? ` Overage charges are capped at ${formatCad(CONSUMER_CODE_RULES.dataOverageCapCents, "en")} without your consent.` : ""}`,
    };
  }
  return { fr: `Vous avez utilisé ${threshold} % ${what.fr} ce mois-ci.`, en: `You have used ${threshold}% ${what.en} this month.` };
}

export interface ChargeCapResult {
  billableOverageCents: number;
  billableRoamingCents: number;
  /** Stop charging (or suspend) data overage until the account holder consents. */
  overageCapReached: boolean;
  roamingCapReached: boolean;
}

/** Applies the Wireless Code caps: charges above the cap are not billable without the holder's consent. */
export function applyChargeCaps(input: {
  overageCents: number;
  roamingCents: number;
  overageCapConsentCents?: number | null;
  roamingCapConsentCents?: number | null;
}): ChargeCapResult {
  const R = CONSUMER_CODE_RULES;
  const oCap = Math.max(R.dataOverageCapCents, input.overageCapConsentCents ?? 0);
  const rCap = Math.max(R.roamingCapCents, input.roamingCapConsentCents ?? 0);
  return {
    billableOverageCents: Math.min(input.overageCents, oCap),
    billableRoamingCents: Math.min(input.roamingCents, rCap),
    overageCapReached: input.overageCents >= oCap,
    roamingCapReached: input.roamingCents >= rCap,
  };
}

// ------------------------------------------------------------------------------ cancellation

export type CancellationBasis = "no_term" | "trial" | "term_ended" | "discount_declining" | "no_discount_cap";

export interface CancellationResult {
  /** Early cancellation fee (CAD cents, before taxes). */
  feeCents: number;
  /** Remaining balance of a financed device (a debt, not a fee); 0 when none. */
  deviceBalanceCents: number;
  totalCents: number;
  basis: CancellationBasis;
  inTrial: boolean;
  monthsElapsed: number;
  monthsRemaining: number;
  /** Cancellation takes effect the day the notice is received (Wireless and Internet Codes). */
  effectiveAt: Date;
  explanation: LocalizedText;
}

/** Whole calendar months between two dates (a month counts once the same day-of-month is reached). */
export function wholeMonthsBetween(from: Date, to: Date): number {
  let m = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) m -= 1;
  return Math.max(0, m);
}

export function computeCancellation(input: {
  productLine: ProductLine;
  termMonths: number;
  discountCents: number;
  monthlyPriceCents: number;
  activatedAt: Date | null;
  cancelAt: Date;
  deviceBalanceCents?: number;
  /** Fraction (0–1) of the monthly allowance used so far, for the wireless trial rule. */
  usageFraction?: number;
  accessibilityTrial?: boolean;
}): CancellationResult {
  const R = CONSUMER_CODE_RULES;
  const code = consumerCodeFor(input.productLine);
  const deviceBalanceCents = Math.max(0, input.deviceBalanceCents ?? 0);
  const done = (basis: CancellationBasis, feeCents: number, inTrial: boolean, elapsed: number, remaining: number, explanation: LocalizedText) => ({
    feeCents,
    deviceBalanceCents,
    totalCents: feeCents + deviceBalanceCents,
    basis,
    inTrial,
    monthsElapsed: elapsed,
    monthsRemaining: remaining,
    effectiveAt: input.cancelAt,
    explanation,
  });

  // Not active yet: no service was delivered, nothing to charge.
  if (!input.activatedAt) return done("no_term", 0, false, 0, input.termMonths, { fr: "Service non activé : aucuns frais.", en: "Service not activated: no fee." });

  const days = (input.cancelAt.getTime() - input.activatedAt.getTime()) / 86_400_000;
  const trialDays =
    code === "wireless" ? (input.accessibilityTrial ? R.wirelessTrialDaysAccessibility : R.wirelessTrialDays) : code === "internet" && input.termMonths > 0 ? R.internetTrialDays : 0;
  const usageOk = code !== "wireless" || (input.usageFraction ?? 0) < R.wirelessTrialUsageFraction;
  const inTrial = trialDays > 0 && days <= trialDays && usageOk;

  const elapsed = wholeMonthsBetween(input.activatedAt, input.cancelAt);
  const remaining = Math.max(0, input.termMonths - elapsed);

  if (input.termMonths === 0) return done("no_term", 0, inTrial, elapsed, 0, { fr: "Sans engagement : aucuns frais de résiliation.", en: "No commitment: no cancellation fee." });
  if (inTrial) return done("trial", 0, true, elapsed, remaining, { fr: "Période d'essai : aucuns frais de résiliation.", en: "Trial period: no cancellation fee." });
  if (remaining === 0) return done("term_ended", 0, false, elapsed, 0, { fr: "Engagement terminé : aucuns frais.", en: "Commitment ended: no fee." });

  if (input.discountCents > 0) {
    // Reduced in equal monthly amounts over the term, reaching $0 at its end.
    const fee = Math.max(0, input.discountCents - Math.round((input.discountCents * elapsed) / input.termMonths));
    return done("discount_declining", fee, false, elapsed, remaining, {
      fr: `Solde du rabais : ${formatCad(fee, "fr")} (${remaining} mois restants sur ${input.termMonths}).`,
      en: `Remaining discount: ${formatCad(fee, "en")} (${remaining} of ${input.termMonths} months left).`,
    });
  }
  const tenPct = Math.round((input.monthlyPriceCents * remaining * R.noDiscountFeePercent) / 100);
  const fee = Math.min(R.noDiscountFeeMaxCents, tenPct);
  return done("no_discount_cap", fee, false, elapsed, remaining, {
    fr: `Le moindre de ${formatCad(R.noDiscountFeeMaxCents, "fr")} ou ${R.noDiscountFeePercent} % des frais restants : ${formatCad(fee, "fr")}.`,
    en: `The lesser of ${formatCad(R.noDiscountFeeMaxCents, "en")} or ${R.noDiscountFeePercent}% of remaining charges: ${formatCad(fee, "en")}.`,
  });
}
