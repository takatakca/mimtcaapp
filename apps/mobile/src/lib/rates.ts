// What the dial screen says about the price of a call before dialling (pure, unit-tested).
import { formatCad, type RateResponse } from "@mimt/shared";
import type { Lang, TKey, Vars } from "../i18n/core";

export interface RateNotice {
  tone: "info" | "warning";
  lines: Array<{ key: TKey; vars?: Vars }>;
}

/** Null for Canada/US and 9-1-1 (no rate line: plan minutes, or always free). */
export function rateNotice(rate: RateResponse, lang: Lang): RateNotice | null {
  if (rate.kind !== "international") return null;
  const price = formatCad(rate.centsPerMinute, lang);
  const lines: RateNotice["lines"] = [
    rate.country ? { key: "calls.rate", vars: { price, country: rate.country[lang] } } : { key: "calls.rateNoCountry", vars: { price } },
  ];
  if (rate.allowed && rate.minutesAvailable !== null) {
    lines.push({ key: "calls.rateCredit", vars: { credit: formatCad(rate.intlCreditCents, lang), minutes: rate.minutesAvailable } });
  } else if (rate.reason === "intl_no_credit") {
    lines.push({ key: "calls.rateNoCredit" });
  } else if (rate.reason) {
    lines.push({ key: "calls.rateBlocked" });
  }
  if (rate.placeholder) lines.push({ key: "calls.ratePlaceholder" });
  return { tone: rate.allowed ? "info" : "warning", lines };
}
