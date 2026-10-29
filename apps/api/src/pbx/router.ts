// MIMT Affaires call routing engine. Pure: given a snapshot of a business's PBX configuration, the time and
// a target, it returns TwiML. No database or network access, so every branch is unit-tested (test/pbx.router.test.ts).
// The webhooks in ./webhooks.ts load the snapshot and call these functions.

import {
  BUSINESS_TIMEZONE,
  quebecHolidaysCurrentAndNext,
  type BilingualText,
  type BusinessHours,
  type RouteTarget,
  type Weekday,
} from "@mimt/shared";
import type twilio from "twilio";
import { classifyDestination } from "../lib/phone.js";
import type { BusinessRow, ExtensionRow, IvrMenuRow, RingGroupRow } from "../repo/pbxTypes.js";
import { VoiceResponse } from "../routes/twiml.js";

type VR = twilio.twiml.VoiceResponse;
type DialAttrs = Parameters<VR["dial"]>[0];

/** Path of the AI receptionist webhook (owned by the AI module); the PBX only redirects there. */
export const AI_RECEPTIONIST_PATH = "/webhooks/twilio/ai/receptionist";
export const PBX_PATH = "/webhooks/twilio/pbx";
export const VOICEMAIL_MAX_S = 180;
/** Hard ceiling on a forwarded call to an external number. */
export const EXTERNAL_FORWARD_MAX_S = 2 * 3600;
const MAX_HOPS = 8;

export const PROMPTS = {
  invalid: { fr: "Ce choix n'est pas valide.", en: "That is not a valid choice." },
  goodbye: { fr: "Merci d'avoir appelé. Au revoir.", en: "Thank you for calling. Goodbye." },
  unavailable: { fr: "Cette personne n'est pas disponible. Veuillez rappeler plus tard.", en: "This person is not available. Please call back later." },
  directory: { fr: "Entrez le numéro de poste, suivi du carré.", en: "Enter the extension number, followed by the pound key." },
  notAllowed: { fr: "Ce transfert n'est pas permis.", en: "This transfer is not allowed." },
  whisper: { fr: "Appel MIMT Affaires, appuyez sur 1.", en: "MIMT Business call, press 1 to accept." },
} satisfies Record<string, BilingualText>;

export function defaultVoicemailGreeting(name: string | null): BilingualText {
  return name
    ? {
        fr: `Vous avez joint la boîte vocale de ${name}. Laissez votre message après le signal.`,
        en: `You have reached the voicemail of ${name}. Please leave a message after the tone.`,
      }
    : {
        fr: "Vous avez joint notre boîte vocale. Laissez votre message après le signal.",
        en: "You have reached our voicemail. Please leave a message after the tone.",
      };
}

/** Everything the router needs about one business. */
export interface PbxSnapshot {
  business: Pick<BusinessRow, "id" | "name" | "recordingPolicy">;
  extensions: ExtensionRow[];
  ringGroups: RingGroupRow[];
  ivrMenus: IvrMenuRow[];
  hours: BusinessHours | null;
  /** Plan feature call_recording (Affaires Pro). Recording and its prompt are skipped without it. */
  canRecord: boolean;
  /** Plan feature vm_transcription. */
  transcribe: boolean;
  /**
   * « MIMT Connect » partner business (PARTNERS=on): each member leg reports to the leg webhook, so we know who
   * answered and for how long (services/partners.ts). Absent or false: TwiML is unchanged.
   */
  legEvents?: boolean;
}

export interface RouteContext {
  snap: PbxSnapshot;
  now: Date;
  /** PUBLIC_BASE_URL without trailing slash. */
  base: string;
  /** Business number (phone_numbers.id) that was called; voicemails are filed under it. */
  numberId: string;
  /** Caller ID for <Dial> legs when the call comes from an app (PSTN callers keep their own number). */
  callerId?: string;
}

// ----------------------------------------------------------------------------------------- time

const WEEKDAY_BY_SHORT: Record<string, Weekday> = { Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat", Sun: "sun" };
const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

/** Local date/time in America/Montreal. */
export function localTime(at: Date): { date: string; year: number; weekday: Weekday; minutes: number } {
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    year: Number(parts.year),
    weekday: WEEKDAY_BY_SHORT[parts.weekday ?? ""] ?? "mon",
    minutes: hour * 60 + Number(parts.minute),
  };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Holiday name when `at` falls on a closure day (custom or Quebec statutory), else null. */
export function holidayAt(hours: BusinessHours, at: Date): string | null {
  const t = localTime(at);
  const custom = hours.holidays.find((h) => h.date === t.date);
  if (custom) return custom.name;
  if (hours.quebecHolidays) {
    const qc = quebecHolidaysCurrentAndNext(t.year).find((h) => h.date === t.date);
    if (qc) return qc.name;
  }
  return null;
}

/** True when the business is open at `at` (weekly schedule in America/Montreal, minus holidays). */
export function isOpen(hours: BusinessHours, at: Date): boolean {
  if (holidayAt(hours, at)) return false;
  const t = localTime(at);
  return (hours.weekly[t.weekday] ?? []).some((r) => t.minutes >= toMinutes(r.open) && t.minutes < toMinutes(r.close));
}

// ----------------------------------------------------------------------------------------- urls

export function pbxUrl(base: string, step: string, params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
  return `${base}${PBX_PATH}/${step}?${q.toString()}`;
}

// --------------------------------------------------------------------------------------- helpers

export function say(vr: { say: VR["say"] }, text: BilingualText) {
  vr.say({ language: "fr-CA" }, text.fr);
  vr.say({ language: "en-CA" }, text.en);
}

/** External numbers: Canada/US only, never premium-rate or Caribbean/high-cost NANP. */
export const externalAllowed = (e164: string) => {
  const zone = classifyDestination(e164);
  return zone === "ca" || zone === "us";
};

const recordingOn = (snap: PbxSnapshot) => snap.canRecord && snap.business.recordingPolicy.mode === "all";

/** Consent prompt (French first) whenever a call to this business may be recorded. */
export function consentPrompt(vr: VR, snap: PbxSnapshot) {
  if (snap.canRecord && snap.business.recordingPolicy.mode !== "off") say(vr, snap.business.recordingPolicy.consentPrompt);
}

function recordAttrs(ctx: RouteContext, extensionId?: string): DialAttrs {
  const caller: DialAttrs = ctx.callerId ? { callerId: ctx.callerId } : {};
  if (!recordingOn(ctx.snap)) return caller;
  return {
    ...caller,
    record: "record-from-answer-dual",
    recordingStatusCallback: pbxUrl(ctx.base, "recording", { b: ctx.snap.business.id, s: "all", x: extensionId }),
    recordingStatusCallbackMethod: "POST",
    recordingStatusCallbackEvent: ["completed"],
  };
}

const ringable = (e: ExtensionRow) => Boolean(e.userId || (e.forwardToMobile && externalAllowed(e.forwardToMobile)));

/**
 * Status callbacks of a member leg (partner businesses only). App legs report "answered"; mobile legs report only
 * "completed", their answer is the press-1 of the whisper (a carrier voicemail picking up is not an answer).
 */
function legCallbacks(ctx: RouteContext, ext: ExtensionRow, events: Array<"answered" | "completed">) {
  if (!ctx.snap.legEvents) return {};
  return {
    statusCallback: pbxUrl(ctx.base, "leg", { b: ctx.snap.business.id, x: ext.id }),
    statusCallbackMethod: "POST" as const,
    statusCallbackEvent: events,
  };
}

/** Adds the user's apps and (optionally) their mobile with the press-1 whisper to a <Dial>. */
function addLegs(ctx: RouteContext, dial: ReturnType<VR["dial"]>, ext: ExtensionRow) {
  if (ext.userId) {
    if (ctx.snap.legEvents) dial.client(legCallbacks(ctx, ext, ["answered", "completed"]), ext.userId);
    else dial.client(ext.userId);
  }
  if (ext.forwardToMobile && externalAllowed(ext.forwardToMobile)) {
    const whisperUrl = pbxUrl(ctx.base, "whisper", { b: ctx.snap.business.id, ...(ctx.snap.legEvents ? { x: ext.id } : {}) });
    dial.number({ url: whisperUrl, method: "POST", ...legCallbacks(ctx, ext, ["completed"]) }, ext.forwardToMobile);
  }
}

// ---------------------------------------------------------------------------------------- steps

export function voicemail(ctx: RouteContext, box: { extensionId?: string; ringGroupId?: string }, vr: VR = new VoiceResponse()): VR {
  const ext = box.extensionId ? ctx.snap.extensions.find((e) => e.id === box.extensionId) : undefined;
  const group = box.ringGroupId ? ctx.snap.ringGroups.find((g) => g.id === box.ringGroupId) : undefined;
  if (ext && !ext.voicemail.enabled) {
    say(vr, PROMPTS.unavailable);
    vr.hangup();
    return vr;
  }
  say(vr, ext?.voicemail.greeting ?? defaultVoicemailGreeting(ext?.displayName ?? group?.name ?? ctx.snap.business.name));
  vr.record({
    maxLength: VOICEMAIL_MAX_S,
    playBeep: true,
    action: `${ctx.base}/webhooks/twilio/voice/hangup`,
    method: "POST",
    recordingStatusCallback: pbxUrl(ctx.base, "voicemail-recorded", { b: ctx.snap.business.id, n: ctx.numberId, x: ext?.id, g: group?.id }),
    recordingStatusCallbackMethod: "POST",
    recordingStatusCallbackEvent: ["completed"],
    ...(ctx.snap.transcribe ? { transcribe: true, transcribeCallback: `${ctx.base}/webhooks/twilio/voice/transcription` } : {}),
  });
  return vr;
}

export function dialExtension(ctx: RouteContext, ext: ExtensionRow, vr: VR = new VoiceResponse()): VR {
  if (!ringable(ext)) return voicemail(ctx, { extensionId: ext.id }, vr);
  const dial = vr.dial({
    timeout: ext.ringTimeoutS,
    answerOnBridge: true,
    action: pbxUrl(ctx.base, "dial-result", { b: ctx.snap.business.id, n: ctx.numberId, k: "ext", id: ext.id }),
    method: "POST",
    ...recordAttrs(ctx, ext.id),
  });
  addLegs(ctx, dial, ext);
  return vr;
}

/**
 * Ring group. Simultaneous: one <Dial> with every member. Sequential: member `index` only; the dial-result
 * webhook moves to index + 1, and past the last member to the overflow target (default: the group's voicemail).
 */
export function dialRingGroup(ctx: RouteContext, group: RingGroupRow, index = 0, vr: VR = new VoiceResponse(), hops = 0): VR {
  const members = group.memberExtensionIds
    .map((id) => ctx.snap.extensions.find((e) => e.id === id))
    .filter((e): e is ExtensionRow => Boolean(e && ringable(e)));
  const action = (i: number) => pbxUrl(ctx.base, "dial-result", { b: ctx.snap.business.id, n: ctx.numberId, k: "rg", id: group.id, i });

  if (group.strategy === "simultaneous") {
    if (!members.length || index > 0) return overflow(ctx, group, vr, hops);
    const dial = vr.dial({ timeout: group.timeoutS, answerOnBridge: true, action: action(0), method: "POST", ...recordAttrs(ctx) });
    for (const m of members) addLegs(ctx, dial, m);
    return vr;
  }
  const member = members[index];
  if (!member) return overflow(ctx, group, vr, hops);
  const dial = vr.dial({ timeout: group.timeoutS, answerOnBridge: true, action: action(index), method: "POST", ...recordAttrs(ctx, member.id) });
  addLegs(ctx, dial, member);
  return vr;
}

export function overflow(ctx: RouteContext, group: RingGroupRow, vr: VR = new VoiceResponse(), hops = 0): VR {
  return group.overflow ? route(ctx, group.overflow, vr, hops + 1) : voicemail(ctx, { ringGroupId: group.id }, vr);
}

export function ivrMenu(ctx: RouteContext, menu: IvrMenuRow, attempt = 0, vr: VR = new VoiceResponse()): VR {
  const gather = vr.gather({
    numDigits: 1,
    timeout: menu.timeoutS,
    action: pbxUrl(ctx.base, "ivr-input", { b: ctx.snap.business.id, n: ctx.numberId, m: menu.id, a: attempt }),
    method: "POST",
    actionOnEmptyResult: true,
  });
  if (menu.greetingRecordingUrl) gather.play(menu.greetingRecordingUrl);
  else say(gather, menu.greeting);
  return vr;
}

/** Key press (or none) on an IVR menu. */
export function ivrInput(ctx: RouteContext, menu: IvrMenuRow, digits: string | undefined, attempt: number): VR {
  const vr = new VoiceResponse();
  const pressed = (digits ?? "").slice(0, 1);
  if (pressed) {
    const option = menu.options.find((o) => o.digit === pressed);
    if (option) return route(ctx, option.target, vr);
    say(vr, PROMPTS.invalid);
    if (attempt < menu.maxRetries) return ivrMenu(ctx, menu, attempt + 1, vr);
    const fallback = menu.invalidTarget ?? menu.timeoutTarget;
    return fallback ? route(ctx, fallback, vr) : goodbye(vr);
  }
  if (attempt < menu.maxRetries) return ivrMenu(ctx, menu, attempt + 1, vr);
  return menu.timeoutTarget ? route(ctx, menu.timeoutTarget, vr) : goodbye(vr);
}

export function directory(ctx: RouteContext, vr: VR = new VoiceResponse()): VR {
  const gather = vr.gather({
    finishOnKey: "#",
    timeout: 6,
    action: pbxUrl(ctx.base, "directory-input", { b: ctx.snap.business.id, n: ctx.numberId }),
    method: "POST",
  });
  say(gather, PROMPTS.directory);
  return goodbye(vr);
}

export function directoryInput(ctx: RouteContext, digits: string | undefined): VR {
  const ext = ctx.snap.extensions.find((e) => e.number === (digits ?? "").replace(/#$/, ""));
  if (ext) return dialExtension(ctx, ext);
  const group = ctx.snap.ringGroups.find((g) => g.number && g.number === digits);
  if (group) return dialRingGroup(ctx, group);
  const vr = new VoiceResponse();
  say(vr, PROMPTS.invalid);
  return directory(ctx, vr);
}

function goodbye(vr: VR): VR {
  say(vr, PROMPTS.goodbye);
  vr.hangup();
  return vr;
}

/** Routes the call to `target`, appending to `vr`. */
export function route(ctx: RouteContext, target: RouteTarget, vr: VR = new VoiceResponse(), hops = 0): VR {
  if (hops > MAX_HOPS) return goodbye(vr);
  const { snap } = ctx;
  switch (target.type) {
    case "schedule": {
      if (!snap.hours) return voicemail(ctx, {}, vr);
      return route(ctx, isOpen(snap.hours, ctx.now) ? snap.hours.openTarget : snap.hours.closedTarget, vr, hops + 1);
    }
    case "extension": {
      const ext = snap.extensions.find((e) => e.id === target.extensionId);
      return ext ? dialExtension(ctx, ext, vr) : voicemail(ctx, {}, vr);
    }
    case "ring_group": {
      const group = snap.ringGroups.find((g) => g.id === target.ringGroupId);
      return group ? dialRingGroup(ctx, group, 0, vr, hops) : voicemail(ctx, {}, vr);
    }
    case "voicemail":
      return voicemail(ctx, { extensionId: target.extensionId, ringGroupId: target.ringGroupId }, vr);
    case "ivr": {
      const menu = snap.ivrMenus.find((m) => m.id === target.ivrMenuId);
      return menu ? ivrMenu(ctx, menu, 0, vr) : voicemail(ctx, {}, vr);
    }
    case "external": {
      // Checked again here (not only when saved): forwarding is paid outbound PSTN.
      if (!externalAllowed(target.number)) {
        say(vr, PROMPTS.notAllowed);
        vr.hangup();
        return vr;
      }
      vr.dial({ timeLimit: EXTERNAL_FORWARD_MAX_S, answerOnBridge: true, ...recordAttrs(ctx) }).number(target.number);
      return vr;
    }
    case "ai_receptionist":
      vr.redirect({ method: "POST" }, `${ctx.base}${AI_RECEPTIONIST_PATH}?${new URLSearchParams({ b: snap.business.id, n: ctx.numberId })}`);
      return vr;
    case "directory":
      return directory(ctx, vr);
    case "hangup":
      return goodbye(vr);
  }
}

/** Entry point for a call to a business DID: consent prompt (if recording is possible), then the DID's target. */
export function inbound(ctx: RouteContext, target: RouteTarget): VR {
  const vr = new VoiceResponse();
  consentPrompt(vr, ctx.snap);
  return route(ctx, target, vr);
}

/** <Dial action> result for an extension or a ring group. */
export function dialResult(ctx: RouteContext, kind: "ext" | "rg", id: string, index: number, dialStatus: string | undefined): VR {
  const vr = new VoiceResponse();
  if (dialStatus === "completed" || dialStatus === "answered") {
    vr.hangup();
    return vr;
  }
  if (kind === "ext") return voicemail(ctx, { extensionId: id }, vr);
  const group = ctx.snap.ringGroups.find((g) => g.id === id);
  if (!group) return voicemail(ctx, {}, vr);
  return group.strategy === "sequential" ? dialRingGroup(ctx, group, index + 1, vr) : overflow(ctx, group, vr);
}

/** Played to the mobile leg of a forwarded call: press 1 to accept, so carrier voicemail never takes the call. */
export function whisper(base: string, businessId: string, extensionId?: string): VR {
  const vr = new VoiceResponse();
  const gather = vr.gather({ numDigits: 1, timeout: 8, action: pbxUrl(base, "whisper-input", { b: businessId, x: extensionId }), method: "POST" });
  say(gather, PROMPTS.whisper);
  vr.hangup();
  return vr;
}

export function whisperInput(digits: string | undefined): VR {
  const vr = new VoiceResponse();
  // An empty response connects the call; anything else drops this leg only.
  if (digits !== "1") vr.hangup();
  return vr;
}
