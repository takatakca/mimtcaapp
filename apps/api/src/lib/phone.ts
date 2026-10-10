import { NANP_E164 } from "@mimt/shared";

export const E164 = /^\+[1-9]\d{6,14}$/;

/** Normalizes what a user dials into E.164. Returns null when it cannot be routed. */
export function normalizeDialed(raw: string): string | null {
  const s = raw.trim().replace(/[\s().-]/g, "");
  if (/^\+[1-9]\d{6,14}$/.test(s)) return s;
  if (/^011[1-9]\d{6,14}$/.test(s)) return "+" + s.slice(3);
  if (/^1[2-9]\d{9}$/.test(s)) return "+" + s;
  if (/^[2-9]\d{9}$/.test(s)) return "+1" + s;
  return null;
}

// Canadian NPAs (geographic + 600 non-geographic). Source: CNA, 2026.
const CA_NPAS = new Set(
  "204 226 236 249 250 257 263 289 306 343 354 365 367 368 382 387 403 416 418 428 431 437 438 450 460 468 474 506 514 519 548 579 581 584 587 600 604 613 639 647 672 683 705 709 742 753 778 780 782 807 819 825 867 873 879 902 905 942".split(
    " ",
  ),
);

// NANP codes outside CA/US mainland that carry international-style rates (Caribbean, Atlantic, Pacific territories).
const HIGH_COST_NANP = new Set(
  "242 246 264 268 284 340 345 441 473 649 658 664 670 671 684 721 758 767 784 809 829 849 868 869 876".split(" "),
);

export type DestinationZone = "ca" | "us" | "nanp_premium" | "nanp_high_cost" | "cuba" | "intl" | "invalid";

export function classifyDestination(e164: string): DestinationZone {
  if (!E164.test(e164)) return "invalid";
  // Twilio has no Cuba destination. +53 is routed through the second carrier.
  if (/^\+53\d{6,12}$/.test(e164)) return "cuba";
  if (!e164.startsWith("+1")) return "intl";
  if (!NANP_E164.test(e164)) return "invalid";
  const npa = e164.slice(2, 5);
  const nxx = e164.slice(5, 8);
  if (npa === "900" || npa === "976" || nxx === "976") return "nanp_premium";
  if (HIGH_COST_NANP.has(npa)) return "nanp_high_cost";
  return CA_NPAS.has(npa) ? "ca" : "us";
}

export const isDomesticZone = (z: DestinationZone) => z === "ca" || z === "us";

/** SMS segment count (GSM-7 vs UCS-2), good enough for caps before Twilio reports the real value. */
export function smsSegments(body: string): number {
  const gsm = /^[\n\r @£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/.test(body);
  const len = [...body].length;
  if (gsm) return len <= 160 ? 1 : Math.ceil(len / 153);
  return len <= 70 ? 1 : Math.ceil(len / 67);
}
