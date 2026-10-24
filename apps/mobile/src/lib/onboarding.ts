// Which onboarding step a signed-in user still needs (pure, unit-tested).
import { PLANS, type MeResponse } from "@mimt/shared";

export type OnboardingStep = "address" | "notice" | "number";

/**
 * The number step only comes up when the plan includes a phone-network number (Essentiel, Premium…). On the free
 * plan the app works with the MIMT @name (app-to-app calls and texts), so onboarding ends after the 9-1-1 notice.
 */
export function nextOnboardingStep(
  me: Pick<MeResponse, "e911" | "numbers"> & { account?: Pick<MeResponse["account"], "plan"> },
): OnboardingStep | null {
  if (!me.e911.addressRegistered) return "address";
  if (!me.e911.noticeAccepted) return "notice";
  if (me.numbers.length === 0 && planIncludesNumber(me.account?.plan)) return "number";
  return null;
}

/** True when the plan comes with a phone-network number. Unknown plan (older API): assume it does. */
export function planIncludesNumber(plan: MeResponse["account"]["plan"] | undefined): boolean {
  return plan ? PLANS[plan]?.caps.hasNumber !== false : true;
}

/** Order area codes for the picker: Montréal first, then the rest of Quebec. */
export function sortAreaCodes(codes: readonly string[]): string[] {
  const priority = ["514", "438", "450", "579", "418", "581", "819", "873", "367", "354", "263", "468"];
  return [...codes].sort((a, b) => {
    const ia = priority.indexOf(a);
    const ib = priority.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
}
