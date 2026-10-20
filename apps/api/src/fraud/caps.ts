import { TRIAL_CAPS, type PlanCaps, type PlanCode } from "@mimt/shared";
import { messagesUsed, type RiskTier, type Usage } from "../repo/types.js";
import { planOf } from "../plansConfig.js";
import { daysBetween } from "../lib/time.js";

export const NEW_ACCOUNT_DAYS = 14;

/**
 * Plan caps adjusted for risk: new accounts (first 14 days, or tier "new"/"high") get half the outbound caps.
 * `trialing`: the optional 7-day trial (TRIAL_ENABLED) gets TRIAL_CAPS whatever the plan.
 */
export function effectiveCaps(plan: PlanCode, riskTier: RiskTier, accountCreatedAt: Date, now: Date, trialing = false): PlanCaps {
  const caps = trialing ? TRIAL_CAPS : planOf(plan).caps;
  const young = daysBetween(accountCreatedAt, now) < NEW_ACCOUNT_DAYS && riskTier !== "trusted";
  if (!young && riskTier !== "new" && riskTier !== "high") return caps;
  return {
    ...caps,
    outboundMinutes: Math.floor(caps.outboundMinutes / 2),
    messages: Math.floor(caps.messages / 2),
    mms: Math.floor(caps.mms / 2),
    concurrentCalls: riskTier === "high" ? 1 : caps.concurrentCalls,
  };
}

export type CapResult = { ok: true; remaining: number } | { ok: false; reason: string };

export function checkVoiceCaps(input: { caps: PlanCaps; usage: Usage; activeCalls: number }): CapResult {
  const { caps, usage } = input;
  if (input.activeCalls >= caps.concurrentCalls) return { ok: false, reason: "too_many_calls" };
  const remaining = caps.outboundMinutes + usage.bonusMinutesOut - usage.minutesOut;
  if (remaining <= 0) return { ok: false, reason: "minutes_exhausted" };
  return { ok: true, remaining };
}

export function checkInboundCaps(input: { caps: PlanCaps; usage: Usage }): CapResult {
  const remaining = input.caps.inboundMinutes - input.usage.minutesIn;
  return remaining > 0 ? { ok: true, remaining } : { ok: false, reason: "inbound_minutes_exhausted" };
}

/** Messages count both directions (Twilio bills receiving). MMS also have their own, smaller cap. */
export function checkSmsCaps(input: { caps: PlanCaps; usage: Usage; segments: number; mms?: boolean }): CapResult {
  const remaining = input.caps.messages - messagesUsed(input.usage);
  if (remaining < input.segments) return { ok: false, reason: "sms_exhausted" };
  if (input.mms && input.usage.mmsOut >= input.caps.mms) return { ok: false, reason: "mms_exhausted" };
  return { ok: true, remaining: remaining - input.segments };
}

/**
 * App-to-app call minutes. Free plan: its own fair-use pool (onNetMinutes). Paid plans (onNetMinutes null): they draw
 * from outbound minutes, which cost more per minute, so the unit-economics rule still holds.
 */
export function checkOnNetCaps(input: { caps: PlanCaps; usage: Usage }): CapResult {
  const { caps, usage } = input;
  const remaining = caps.onNetMinutes === null ? caps.outboundMinutes + usage.bonusMinutesOut - usage.minutesOut : caps.onNetMinutes - usage.minutesOnNet;
  return remaining > 0 ? { ok: true, remaining } : { ok: false, reason: "on_net_minutes_exhausted" };
}

/** Daily spend guard: above the threshold, outbound is suspended until a human reviews it. */
export const exceedsDailySpend = (spendTodayCad: number, limitCad: number) => spendTodayCad > limitCad;
