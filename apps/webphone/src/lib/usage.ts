// Plan usage helpers (pure). Adapted from apps/mobile/src/lib/usage.ts.
import { PLANS, type PlanCode } from "@mimt/shared";

/** Percentage of a cap used, clamped to 0–100 and rounded. A zero cap counts as full when used. */
export function usagePercent(used: number, cap: number): number {
  if (!Number.isFinite(used) || used <= 0) return 0;
  if (!Number.isFinite(cap) || cap <= 0) return 100;
  return Math.min(100, Math.round((used / cap) * 100));
}

export type UsageLevel = "ok" | "warn" | "full";

/** Alert at 80 % (MIMT-MVP §6), full at 100 %. */
export function usageLevel(percent: number): UsageLevel {
  if (percent >= 100) return "full";
  if (percent >= 80) return "warn";
  return "ok";
}

export interface UsageRow {
  key: "outboundMinutes" | "inboundMinutes" | "messages";
  used: number;
  cap: number;
  percent: number;
  level: UsageLevel;
}

export function usageRows(
  plan: PlanCode,
  usage: { outboundMinutes: number; inboundMinutes: number; messages: number },
  multiplier = 1,
): UsageRow[] {
  const caps = PLANS[plan].caps;
  // A zero cap is not in the plan (Gratuit has no phone-network minutes or texts): no row for it.
  return (["outboundMinutes", "inboundMinutes", "messages"] as const)
    .filter((key) => caps[key] > 0)
    .map((key) => {
      const cap = caps[key] * multiplier;
      const percent = usagePercent(usage[key], cap);
      return { key, used: usage[key], cap, percent, level: usageLevel(percent) };
    });
}
