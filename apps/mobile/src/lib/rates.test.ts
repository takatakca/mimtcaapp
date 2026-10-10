import type { RateResponse } from "@mimt/shared";
import { describe, expect, it } from "vitest";
import { translate } from "../i18n/core";
import { canPlaceCall, rateQuoteTarget, toDialable, toDialableVoice } from "./dial";
import { rateNotice } from "./rates";

const base: RateResponse = {
  to: "+33142685300",
  kind: "international",
  country: { fr: "France", en: "France" },
  centsPerMinute: 5,
  currency: "CAD",
  allowed: true,
  reason: null,
  intlCreditCents: 1000,
  minutesAvailable: 200,
  placeholder: true,
};

const render = (rate: RateResponse, lang: "fr" | "en" = "fr") =>
  // Intl puts a no-break space before "$" in French; compare with plain spaces.
  rateNotice(rate, lang)?.lines.map((l) => translate(lang, l.key, l.vars).replace(/[\u00a0\u202f]/g, " ")) ?? null;

describe("rate before dialling", () => {
  it("shows the price, the credit and that the rate is indicative", () => {
    expect(render(base)).toEqual([
      "Tarif : 0,05 $/min vers France",
      "Votre crédit : 10,00 $ (environ 200 min)",
      "Tarif indicatif, sous réserve de confirmation.",
    ]);
    expect(render(base, "en")![0]).toBe("Rate: $0.05/min to France");
    expect(rateNotice(base, "fr")?.tone).toBe("info");
  });

  it("warns when there is no credit or the destination is not offered", () => {
    const noCredit = rateNotice({ ...base, allowed: false, reason: "intl_no_credit", intlCreditCents: 0, minutesAvailable: 0 }, "fr")!;
    expect(noCredit.tone).toBe("warning");
    expect(noCredit.lines.map((l) => l.key)).toContain("calls.rateNoCredit");
    const blocked = rateNotice({ ...base, allowed: false, reason: "destination_blocked", country: null }, "fr")!;
    expect(blocked.lines.map((l) => l.key)).toEqual(["calls.rateNoCountry", "calls.rateBlocked", "calls.ratePlaceholder"]);
  });

  it("says nothing for Canada/US and 9-1-1", () => {
    expect(rateNotice({ ...base, kind: "domestic", centsPerMinute: 0 }, "fr")).toBeNull();
    expect(rateNotice({ ...base, kind: "emergency", to: "911", centsPerMinute: 0 }, "fr")).toBeNull();
  });
});

describe("international dialling", () => {
  it("accepts + and 011 for voice, never for texts", () => {
    expect(toDialableVoice("+33 1 42 68 53 00")).toBe("+33142685300");
    expect(toDialableVoice("011 33 1 42 68 53 00")).toBe("+33142685300");
    expect(toDialableVoice("514 555-0123")).toBe("+15145550123");
    expect(toDialableVoice("+0123")).toBeNull();
    expect(toDialable("+33142685300")).toBeNull();
  });

  it("asks for a rate only for complete non-emergency numbers", () => {
    expect(rateQuoteTarget("+3314")).toBeNull();
    expect(rateQuoteTarget("911")).toBeNull();
    expect(rateQuoteTarget("+33142685300")).toBe("+33142685300");
  });

  it("still ALWAYS allows 9-1-1 and gates international on the 9-1-1 setup like any call", () => {
    expect(canPlaceCall("911", null)).toBe(true);
    expect(canPlaceCall("+33142685300", { addressRegistered: false, noticeAccepted: false })).toBe(false);
    expect(canPlaceCall("+33142685300", { addressRegistered: true, noticeAccepted: true })).toBe(true);
  });
});
