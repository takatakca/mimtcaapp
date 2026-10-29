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
  key: "outboundMinutes" | "inboundMinutes" | "messages" | "onNetMinutes";
  used: number;
  cap: number;
  percent: number;
  level: UsageLevel;
}

export interface MonthUsage {
  outboundMinutes: number;
  inboundMinutes: number;
  messages: number;
  /** App-to-app minutes (the free plan's own pool). */
  onNetMinutes?: number;
  /** Extra minutes of this month (Missions MIMT, rewarded ads, minute packs): they raise this month's cap. */
  bonusOutboundMinutes?: number;
  bonusOnNetMinutes?: number;
  /** Extra texts of this month (MIMT Points): they raise this month's messages cap. */
  bonusMessages?: number;
}

export function usageRows(plan: PlanCode, usage: MonthUsage, multiplier = 1): UsageRow[] {
  const caps = PLANS[plan].caps;
  const row = (key: UsageRow["key"], used: number, cap: number): UsageRow => {
    const percent = usagePercent(used, cap);
    return { key, used, cap, percent, level: usageLevel(percent) };
  };
  // A zero cap is not in the plan (Gratuit has no phone-network minutes or texts): no row for it.
  const rows = (["outboundMinutes", "inboundMinutes", "messages"] as const)
    .filter((key) => caps[key] > 0)
    .map((key) => row(key, usage[key], caps[key] * multiplier + (key === "outboundMinutes" ? (usage.bonusOutboundMinutes ?? 0) : key === "messages" ? (usage.bonusMessages ?? 0) : 0)));
  // The free plan's app-to-app pool (paid plans draw app-to-app calls from outbound minutes).
  if (caps.onNetMinutes !== null) rows.push(row("onNetMinutes", usage.onNetMinutes ?? 0, caps.onNetMinutes * multiplier + (usage.bonusOnNetMinutes ?? 0)));
  return rows;
}
