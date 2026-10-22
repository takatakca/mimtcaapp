// MIMT Affaires (business PBX, phase 2): shared types between apps/api and the admin portal.
// Source of truth: docs/MIMT-MVP.md §5 (data model), §6 (plans business / business_pro), §8 phase 2,
// and docs/MIMT-REGULATORY.md §6 (call recording notice). All dates are ISO 8601 strings in DTOs.

/** PBX time zone. Business hours and holidays are evaluated in this zone. */
export const BUSINESS_TIMEZONE = "America/Montreal";

export type BusinessRole = "owner" | "admin" | "member";
export type BusinessMemberStatus = "invited" | "active";
export type BusinessPlanCode = "business" | "business_pro";

/** Short internal extension: 3 or 4 digits, not starting with 0 and never an emergency/N11 code. */
export const EXTENSION_PATTERN = /^[1-9]\d{2,3}$/;

/** True for a valid extension number. 911, 933 (9-1-1 test) and other N11 codes are refused. */
export function isValidExtension(ext: string): boolean {
  if (!EXTENSION_PATTERN.test(ext)) return false;
  if (/^[2-9]11$/.test(ext) || ext === "933" || ext === "9911") return false;
  return true;
}

/** Bilingual text, French first (Charter of the French language). */
export interface BilingualText {
  fr: string;
  en: string;
}

// ------------------------------------------------------------------------------------- routing

/** Where a call goes. Stored as JSON in did_routes, ivr_options, business_hours and ring group overflow. */
export type RouteTarget =
  | { type: "extension"; extensionId: string }
  | { type: "ring_group"; ringGroupId: string }
  /** Voicemail box of an extension or a ring group (the business general box when both are absent). */
  | { type: "voicemail"; extensionId?: string; ringGroupId?: string }
  | { type: "ivr"; ivrMenuId: string }
  /** External number: Canada/US (NANP, non-premium) only. */
  | { type: "external"; number: string }
  /** Hands the call to the AI receptionist (owned by the AI module). */
  | { type: "ai_receptionist" }
  /** Dial-by-extension directory: the caller keys in an extension number. */
  | { type: "directory" }
  /** Business hours decide: open → hours.openTarget, closed/holiday → hours.closedTarget. */
  | { type: "schedule" }
  | { type: "hangup" };

export type RouteTargetType = RouteTarget["type"];

// ------------------------------------------------------------------------------------- objects

export interface CallRecordingPolicy {
  /** off: never. all: every external call, with the consent prompt. on_demand: users start/stop it (prompt still played). */
  mode: "off" | "all" | "on_demand";
  /** Played to the outside party before any recording is possible. French first. */
  consentPrompt: BilingualText;
  /** Recordings are deleted after this many days. */
  retentionDays: number;
}

export const DEFAULT_RECORDING_CONSENT: BilingualText = {
  fr: "Cet appel peut être enregistré à des fins de qualité et de formation.",
  en: "This call may be recorded for quality and training purposes.",
};

export const DEFAULT_RECORDING_POLICY: CallRecordingPolicy = {
  mode: "off",
  consentPrompt: DEFAULT_RECORDING_CONSENT,
  retentionDays: 90,
};

export interface Business {
  id: string;
  name: string;
  /** TAKATAK business_id (from the signed handoff), when the business was activated from TAKATAK. */
  takatakBusinessId: string | null;
  /** Telecom account that holds the business plan, numbers, usage and Stripe subscription. */
  telecomAccountId: string;
  /** Main number (E.164): default outbound caller ID. */
  mainNumber: string | null;
  locale: "fr-CA" | "en-CA";
  recordingPolicy: CallRecordingPolicy;
  createdAt: string;
}

export interface BusinessMember {
  id: string;
  businessId: string;
  /** null until an invited person signs in and claims the invitation. */
  userId: string | null;
  email: string | null;
  role: BusinessRole;
  status: BusinessMemberStatus;
  createdAt: string;
}

export interface ExtensionVoicemail {
  enabled: boolean;
  /** Custom greeting; the default bilingual greeting is used when null. */
  greeting: BilingualText | null;
}

export interface Extension {
  id: string;
  businessId: string;
  /** 3-4 digits, unique in the business. */
  number: string;
  /** User that rings on this extension (MIMT apps). null = no user (voicemail-only box or forward-only). */
  userId: string | null;
  displayName: string;
  voicemail: ExtensionVoicemail;
  /** Also ring this Canada/US mobile number, with a "press 1" whisper so carrier voicemail never answers. */
  forwardToMobile: string | null;
  /** Direct DID of this extension (E.164), used as caller ID when the user calls out from it. */
  did: string | null;
  ringTimeoutS: number;
  createdAt: string;
}

export type RingStrategy = "simultaneous" | "sequential";

export interface RingGroup {
  id: string;
  businessId: string;
  name: string;
  /** Optional dialable number for the group (3-4 digits). */
  number: string | null;
  strategy: RingStrategy;
  /** Extension ids, in ring order for "sequential". */
  memberExtensionIds: string[];
  /** Simultaneous: total ring time. Sequential: ring time per member. */
  timeoutS: number;
  /** Where unanswered calls go. null = the group's voicemail box. */
  overflow: RouteTarget | null;
  createdAt: string;
}

export interface IvrOption {
  /** "0"-"9", "*" or "#". */
  digit: string;
  target: RouteTarget;
}

export interface IvrMenu {
  id: string;
  businessId: string;
  name: string;
  /** Text read by text-to-speech, French first. Ignored when greetingRecordingUrl is set. */
  greeting: BilingualText;
  /** HTTPS URL of a recorded greeting (MP3/WAV), played instead of the text. */
  greetingRecordingUrl: string | null;
  options: IvrOption[];
  /** Seconds to wait for a key press. */
  timeoutS: number;
  /** How many times the menu is replayed after no input or an invalid key. */
  maxRetries: number;
  /** After the last retry with no input. null = polite goodbye and hang up. */
  timeoutTarget: RouteTarget | null;
  /** After the last retry with an invalid key. null = same as timeoutTarget. */
  invalidTarget: RouteTarget | null;
  createdAt: string;
}

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const WEEKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** "HH:MM" 24 h, local time in America/Montreal. `close` is exclusive. */
export interface TimeRange {
  open: string;
  close: string;
}

export type WeeklySchedule = Record<Weekday, TimeRange[]>;

export interface Holiday {
  /** YYYY-MM-DD (local date). */
  date: string;
  name: string;
}

export interface BusinessHours {
  businessId: string;
  timezone: typeof BUSINESS_TIMEZONE;
  weekly: WeeklySchedule;
  /** Custom closures (stored in the holidays table). */
  holidays: Holiday[];
  /** Also close on Quebec statutory holidays (computed for the current and next year). */
  quebecHolidays: boolean;
  openTarget: RouteTarget;
  closedTarget: RouteTarget;
}

/** Monday-Friday 9:00-17:00. */
export const DEFAULT_WEEKLY_SCHEDULE: WeeklySchedule = {
  mon: [{ open: "09:00", close: "17:00" }],
  tue: [{ open: "09:00", close: "17:00" }],
  wed: [{ open: "09:00", close: "17:00" }],
  thu: [{ open: "09:00", close: "17:00" }],
  fri: [{ open: "09:00", close: "17:00" }],
  sat: [],
  sun: [],
};

/** A business number (DID) and where its calls go. */
export interface DidRoute {
  id: string;
  businessId: string;
  phoneNumberId: string;
  e164: string;
  target: RouteTarget;
  createdAt: string;
}

export interface BusinessRecording {
  id: string;
  businessId: string;
  callSid: string;
  extensionId: string | null;
  source: "all" | "on_demand";
  fromNumber: string | null;
  toNumber: string | null;
  durationS: number | null;
  createdAt: string;
  deleteAfter: string;
}

// ---------------------------------------------------------------------------- Quebec holidays

/** Easter Sunday (Gregorian, anonymous algorithm) as [month 1-12, day]. */
export function easterSunday(year: number): [number, number] {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

const iso = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.toISOString().slice(0, 10);
};
const dow = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
/** n-th Monday (1-based) of a month. */
const nthMonday = (y: number, m: number, n: number) => {
  const first = dow(y, m, 1);
  return 1 + ((8 - first) % 7) + (n - 1) * 7;
};

/**
 * Quebec statutory holidays (Act respecting labour standards, s. 60, and the Fête nationale Act).
 * Good Friday is used by default; employers may choose Easter Monday instead.
 */
export function quebecStatutoryHolidays(year: number, opts: { easter?: "good_friday" | "easter_monday" } = {}): Holiday[] {
  const [em, ed] = easterSunday(year);
  const easter = Date.UTC(year, em - 1, ed);
  const easterShift = opts.easter === "easter_monday" ? 1 : -2;
  const easterHoliday = new Date(easter + easterShift * 86_400_000).toISOString().slice(0, 10);
  // Journée nationale des patriotes: the Monday before May 25.
  const may25 = dow(year, 5, 25);
  const patriotes = 25 - (((may25 + 6) % 7) || 7);
  // Fête nationale: June 24, or June 25 when the 24th is a Sunday. Canada Day: July 1, or July 2 when the 1st is a Sunday.
  const fete = dow(year, 6, 24) === 0 ? 25 : 24;
  const canada = dow(year, 7, 1) === 0 ? 2 : 1;
  return [
    { date: iso(year, 1, 1), name: "Jour de l'An" },
    { date: easterHoliday, name: opts.easter === "easter_monday" ? "Lundi de Pâques" : "Vendredi saint" },
    { date: iso(year, 5, patriotes), name: "Journée nationale des patriotes" },
    { date: iso(year, 6, fete), name: "Fête nationale du Québec" },
    { date: iso(year, 7, canada), name: "Fête du Canada" },
    { date: iso(year, 9, nthMonday(year, 9, 1)), name: "Fête du Travail" },
    { date: iso(year, 10, nthMonday(year, 10, 2)), name: "Action de grâces" },
    { date: iso(year, 12, 25), name: "Noël" },
  ];
}

/** Quebec statutory holidays for `year` and `year + 1` (what the PBX checks). */
export function quebecHolidaysCurrentAndNext(year: number): Holiday[] {
  return [...quebecStatutoryHolidays(year), ...quebecStatutoryHolidays(year + 1)];
}

// ----------------------------------------------------------------------------- admin API types

/** POST /v1/business → 201 BusinessResponse. `takatakBusinessId` must match the signed TAKATAK handoff. */
export interface CreateBusinessRequest {
  name: string;
  takatakBusinessId?: string;
  locale?: "fr-CA" | "en-CA";
}
/** PATCH /v1/business/:id */
export interface UpdateBusinessRequest {
  name?: string;
  /** E.164 of a number held by the business, or null. */
  mainNumber?: string | null;
  locale?: "fr-CA" | "en-CA";
}
/**
 * Stripe lifecycle of the business plan subscription (same names as Stripe). past_due = payment needs
 * attention (service continues); canceled/unpaid = business outbound calls blocked, inbound and 9-1-1 kept.
 */
export type BusinessBillingStatus = "active" | "trialing" | "past_due" | "canceled" | "incomplete" | "unpaid";
export interface BusinessResponse {
  business: Business;
  /** Role of the caller in this business. */
  role: BusinessRole;
  /** Lines; mirrors the quantity of the Stripe business subscription (Stripe is the source of truth). */
  seats: number;
  /** Null when no business plan was ever bought. */
  billingStatus?: BusinessBillingStatus | null;
}
/** GET /v1/business */
export interface BusinessesResponse {
  businesses: BusinessResponse[];
}

/** POST /v1/business/:id/members (invite by email; the invited person claims it after sign-in). */
export interface InviteMemberRequest {
  email: string;
  role: Exclude<BusinessRole, "owner">;
}
/** PATCH /v1/business/:id/members/:memberId */
export interface UpdateMemberRequest {
  role: Exclude<BusinessRole, "owner">;
}
export interface MembersResponse {
  members: BusinessMember[];
}
/** POST /v1/business/invites/claim */
export interface ClaimInvitesResponse {
  claimed: Array<{ businessId: string; memberId: string; role: BusinessRole }>;
}

/** POST /v1/business/:id/extensions and PATCH .../extensions/:extId (all fields optional on PATCH). */
export interface ExtensionRequest {
  number: string;
  displayName: string;
  userId?: string | null;
  voicemail?: ExtensionVoicemail;
  forwardToMobile?: string | null;
  did?: string | null;
  ringTimeoutS?: number;
}
export interface ExtensionsResponse {
  extensions: Extension[];
}

/** POST /v1/business/:id/ring-groups and PUT .../ring-groups/:rgId */
export interface RingGroupRequest {
  name: string;
  number?: string | null;
  strategy: RingStrategy;
  memberExtensionIds: string[];
  timeoutS?: number;
  overflow?: RouteTarget | null;
}
export interface RingGroupsResponse {
  ringGroups: RingGroup[];
}

/** POST /v1/business/:id/ivr and PUT .../ivr/:menuId */
export interface IvrMenuRequest {
  name: string;
  greeting: BilingualText;
  greetingRecordingUrl?: string | null;
  options: IvrOption[];
  timeoutS?: number;
  maxRetries?: number;
  timeoutTarget?: RouteTarget | null;
  invalidTarget?: RouteTarget | null;
}
export interface IvrMenusResponse {
  menus: IvrMenu[];
}

/** PUT /v1/business/:id/hours */
export type BusinessHoursRequest = Omit<BusinessHours, "businessId" | "timezone">;
/** GET /v1/business/:id/hours (`open`: whether the business is open right now). */
export interface BusinessHoursResponse {
  hours: BusinessHours;
  open: boolean;
}

/** PUT /v1/business/:id/dids (upsert by number). */
export interface DidRouteRequest {
  e164: string;
  target: RouteTarget;
}
export interface DidRoutesResponse {
  routes: DidRoute[];
}

/** POST /v1/business/:id/numbers/claim */
export interface BusinessClaimNumberRequest {
  e164: string;
}

/** PUT /v1/business/:id/recording-policy (all / on_demand need Affaires Pro). */
export interface RecordingPolicyRequest {
  mode: CallRecordingPolicy["mode"];
  consentPrompt?: BilingualText;
  retentionDays?: number;
}

/** GET /v1/business/:id/calls?cursor&limit (owner/admin: everyone; member: own calls). */
export interface BusinessCallRecord {
  id: string;
  direction: "inbound" | "outbound";
  kind: "pstn" | "app" | "emergency";
  userId: string | null;
  from: string;
  to: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationS: number | null;
}
export interface BusinessCallsResponse {
  calls: BusinessCallRecord[];
  nextCursor: string | null;
}

/** GET /v1/business/:id/recordings (each with a 15-min signed `audioUrl`). */
/** AI summary of a recorded business call (Affaires Pro, with the owner's AI consent). */
export interface CallSummary {
  text: string;
  /** Follow-ups promised or asked for during the call; may be empty. */
  actionItems: string[];
  locale: "fr-CA" | "en-CA";
}
export interface BusinessRecordingDto extends BusinessRecording {
  audioUrl: string;
  audioUrlExpiresAt: string;
  summary: CallSummary | null;
}
export interface BusinessRecordingsResponse {
  recordings: BusinessRecordingDto[];
}

/** GET /v1/business/:id/usage: pooled minutes (per-line cap × seats) for the current month. */
export interface BusinessUsageResponse {
  plan: BusinessPlanCode | null;
  seats: number;
  periodStart: string;
  perLine: { outboundMinutes: number; inboundMinutes: number; messages: number; concurrentCalls: number };
  pooled: {
    outboundMinutes: { used: number; cap: number };
    inboundMinutes: { used: number; cap: number };
    /** Texts sent and received (both are billed by the carrier). */
    messages: { used: number; cap: number };
    concurrentCalls: { cap: number };
  };
  byUser: Array<{ userId: string; outboundMinutes: number; inboundMinutes: number }>;
}

/**
 * POST /v1/business/:id/seats (owner/admin) → updates the Stripe subscription quantity, prorated.
 * Optional `Idempotency-Key` header (8-128 chars [A-Za-z0-9_-]) makes a double submit safe.
 */
export interface SeatsRequest {
  count: number;
  /** Plan to buy when the business has no Stripe subscription yet (default "business"). */
  plan?: BusinessPlanCode;
}
export interface SeatsResponse {
  seats: number;
  /** Set when the business has no subscription yet: Stripe Checkout with quantity = count. Seats sync after payment. */
  checkoutUrl?: string;
  billingStatus?: BusinessBillingStatus | null;
}

/** POST /v1/calls/:sid/recording (Affaires Pro, recording policy all or on_demand). */
export interface CallRecordingRequest {
  action: "start" | "stop";
}
export interface CallRecordingResponse {
  callSid: string;
  recording: "started" | "stopped";
}
