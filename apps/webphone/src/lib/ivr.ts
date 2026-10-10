// Validation for the IVR menu builder (Réceptionniste) and other routing forms. Pure, unit-tested.
// The API validates again; this gives immediate, translated feedback.
import { isEmergencyNumber, type IvrMenuRequest, type RouteTarget, type TimeRange, type WeeklySchedule, WEEKDAYS } from "@mimt/shared";
import { isNanpE164, toDialable } from "./dial";

export const IVR_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "*", "#"] as const;

export type ValidationCode =
  | "required"
  | "greeting_fr_required"
  | "no_options"
  | "invalid_digit"
  | "duplicate_digit"
  | "external_not_nanp"
  | "external_emergency"
  | "unknown_target"
  | "self_reference"
  | "timeout_range"
  | "retries_range"
  | "time_format"
  | "time_order"
  | "time_overlap";

export interface ValidationIssue {
  /** "name", "greeting.fr", "options.2.digit", "options.2.target", "timeoutS"… */
  field: string;
  code: ValidationCode;
}

export interface TargetContext {
  extensionIds: readonly string[];
  ringGroupIds: readonly string[];
  ivrMenuIds: readonly string[];
  /** The menu being edited (an option may not loop to itself). */
  selfIvrId?: string | null;
}

/** Normalises what an admin typed for an external target: "514 555-0123" → "+15145550123". */
export function normalizeExternal(raw: string): string | null {
  if (isEmergencyNumber(raw)) return null;
  const d = toDialable(raw);
  return d && isNanpE164(d) ? d : null;
}

export function validateTarget(target: RouteTarget | null | undefined, ctx: TargetContext, field: string): ValidationIssue[] {
  if (!target) return [{ field, code: "required" }];
  switch (target.type) {
    case "external":
      if (isEmergencyNumber(target.number)) return [{ field, code: "external_emergency" }];
      return isNanpE164(target.number) ? [] : [{ field, code: "external_not_nanp" }];
    case "extension":
      return ctx.extensionIds.includes(target.extensionId) ? [] : [{ field, code: "unknown_target" }];
    case "ring_group":
      return ctx.ringGroupIds.includes(target.ringGroupId) ? [] : [{ field, code: "unknown_target" }];
    case "ivr":
      if (ctx.selfIvrId && target.ivrMenuId === ctx.selfIvrId) return [{ field, code: "self_reference" }];
      return ctx.ivrMenuIds.includes(target.ivrMenuId) ? [] : [{ field, code: "unknown_target" }];
    case "voicemail":
      if (target.extensionId && !ctx.extensionIds.includes(target.extensionId)) return [{ field, code: "unknown_target" }];
      if (target.ringGroupId && !ctx.ringGroupIds.includes(target.ringGroupId)) return [{ field, code: "unknown_target" }];
      return [];
    default:
      return [];
  }
}

export function validateIvrMenu(menu: IvrMenuRequest, ctx: TargetContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!menu.name.trim()) issues.push({ field: "name", code: "required" });
  if (!menu.greeting.fr.trim() && !menu.greetingRecordingUrl) issues.push({ field: "greeting.fr", code: "greeting_fr_required" });
  if (menu.options.length === 0) issues.push({ field: "options", code: "no_options" });
  const seen = new Set<string>();
  menu.options.forEach((o, i) => {
    if (!(IVR_DIGITS as readonly string[]).includes(o.digit)) issues.push({ field: `options.${i}.digit`, code: "invalid_digit" });
    else if (seen.has(o.digit)) issues.push({ field: `options.${i}.digit`, code: "duplicate_digit" });
    seen.add(o.digit);
    issues.push(...validateTarget(o.target, ctx, `options.${i}.target`));
  });
  if (menu.timeoutS !== undefined && (menu.timeoutS < 3 || menu.timeoutS > 30)) issues.push({ field: "timeoutS", code: "timeout_range" });
  if (menu.maxRetries !== undefined && (menu.maxRetries < 0 || menu.maxRetries > 5)) issues.push({ field: "maxRetries", code: "retries_range" });
  if (menu.timeoutTarget) issues.push(...validateTarget(menu.timeoutTarget, ctx, "timeoutTarget"));
  if (menu.invalidTarget) issues.push(...validateTarget(menu.invalidTarget, ctx, "invalidTarget"));
  return issues;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Weekly grid: HH:MM, open before close, no overlapping ranges on the same day. */
export function validateWeekly(weekly: WeeklySchedule): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const day of WEEKDAYS) {
    const ranges: TimeRange[] = weekly[day] ?? [];
    ranges.forEach((r, i) => {
      const field = `weekly.${day}.${i}`;
      if (!HHMM.test(r.open) || !HHMM.test(r.close)) issues.push({ field, code: "time_format" });
      else if (r.open >= r.close) issues.push({ field, code: "time_order" });
    });
    const sorted = [...ranges].filter((r) => HHMM.test(r.open) && HHMM.test(r.close)).sort((a, b) => a.open.localeCompare(b.open));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.open < sorted[i - 1]!.close) issues.push({ field: `weekly.${day}`, code: "time_overlap" });
    }
  }
  return issues;
}

export function issueFor(issues: readonly ValidationIssue[], field: string): ValidationIssue | undefined {
  return issues.find((i) => i.field === field);
}
