// « Google Agenda » connector (docs/MIMT-CALENDAR.md): OAuth 2.0 with Google (PKCE, signed single-use state),
// encrypted refresh token, entitlement, the calendar_sync_jobs outbox and its worker.
//
// Plain fetch against Google's documented endpoints (no SDK):
//   authorization  https://accounts.google.com/o/oauth2/v2/auth
//   token          https://oauth2.googleapis.com/token        (code exchange, refresh)
//   revoke         https://oauth2.googleapis.com/revoke
//   events.insert  POST https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events
//
// Rules: never log a token or call content; the outbox holds references only; content goes to Google only with the
// user's opt-in (includeContent) AND their AI consent; one job and one deterministic event id per
// (user, source type, source id), so retries never duplicate an event.
import { createHash } from "node:crypto";
import {
  calendarIncludedIn,
  CALENDAR_RETURN_PATH,
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  GOOGLE_CALENDAR_SCOPES,
  SUBSCRIPTION_ADD_ONS,
  type CalendarEntitlementSource,
  type GoogleCalendarStatusResponse,
  type PlanCode,
} from "@mimt/shared";
import { callSummaryDto } from "../ai/callSummary.js";
import { hasAiConsent } from "../ai/service.js";
import { googleOAuthConfigured } from "../config.js";
import type { AppDeps } from "../deps.js";
import { randomToken, sha256Hex } from "../lib/crypto.js";
import type { CalendarConnectionRow, CalendarSourceType, CalendarSyncJobRow } from "../repo/calendar.js";
import type { RecordingRow } from "../repo/pbxTypes.js";
import type { Call, User, Voicemail } from "../repo/types.js";
import { getFeatures } from "./accounts.js";

type Log = { warn: (o: object, m: string) => void; error: (o: object, m: string) => void; info?: (o: object, m: string) => void };

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

/** Signed OAuth state lifetime. */
export const STATE_TTL_S = 5 * 60;
/** Worker: attempts on 429/5xx before a job is marked failed; backoff 1 min × 2^n, at most 6 h. */
export const CALENDAR_MAX_ATTEMPTS = 8;
/** A job waiting for a reconnect (or for a call to end) is dropped after this. */
export const CALENDAR_JOB_MAX_AGE_MS = 7 * 86_400_000;
/** Finished jobs (references only) are deleted after this. */
export const CALENDAR_JOB_RETENTION_MS = 30 * 86_400_000;
/** Queue delays: a call waits for its voicemail (missed or not), a voicemail for its transcript and AI summary. */
export const CALL_DELAY_S = 120;
export const VOICEMAIL_DELAY_S = 180;
/** Transcript excerpt length when the user opted in and there is no AI summary. */
export const EXCERPT_CHARS = 280;

export const calendarOn = (deps: Pick<AppDeps, "config">) => deps.config.CALENDAR === "on";
export const calendarConfigured = (deps: Pick<AppDeps, "config">) => googleOAuthConfigured(deps.config);
const gfetch = (deps: Pick<AppDeps, "googleFetch">): typeof fetch => deps.googleFetch ?? fetch;
const appUrl = (deps: Pick<AppDeps, "config">) => deps.config.APP_BASE_URL.replace(/\/$/, "");
export const calendarReturnUrl = (deps: Pick<AppDeps, "config">, outcome: "ok" | "error", reason?: string) =>
  `${appUrl(deps)}${CALENDAR_RETURN_PATH}?gc=${outcome}${reason ? `&reason=${encodeURIComponent(reason)}` : ""}`;

// ------------------------------------------------------------------------------------------- entitlement

export interface CalendarEntitlement {
  entitled: boolean;
  source: CalendarEntitlementSource | null;
  plan: PlanCode | null;
  /** The add-on can be bought on this plan (Essentiel, Premium) and the user is not entitled yet. */
  canBuy: boolean;
  /** No google_calendar add-on subscription was ever created on this account. */
  trialAvailable: boolean;
}

/**
 * Plan Affaires / Affaires Pro, a live "google_calendar" add-on (trialing counts), or membership of a business whose
 * account includes it.
 */
export async function calendarEntitlement(deps: AppDeps, userId: string): Promise<CalendarEntitlement> {
  const { repo } = deps;
  const addOn = SUBSCRIPTION_ADD_ONS.google_calendar;
  const account = await repo.getAccountByOwner(userId);
  let plan: PlanCode | null = null;
  let source: CalendarEntitlementSource | null = null;
  let trialAvailable = true;
  if (account) {
    const f = await getFeatures(repo, account.id);
    plan = f.plan;
    if (calendarIncludedIn(f.plan)) source = "plan";
    else if (f.addOns.includes("google_calendar")) source = "addon";
    trialAvailable = !(await repo.listSubscriptions(account.id)).some((s) => s.kind === "addon" && s.code === "google_calendar");
  }
  if (!source) {
    for (const { business } of await repo.pbx.listBusinessesForUser(userId)) {
      if ((await getFeatures(repo, business.telecomAccountId)).features.has("calendar_sync")) {
        source = "business";
        break;
      }
    }
  }
  const canBuy = !source && plan !== null && (addOn.availableOn ?? []).includes(plan);
  return { entitled: source !== null, source, plan, canBuy, trialAvailable };
}

// ------------------------------------------------------------------------------------------- OAuth

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stateResource = (userId: string, nonce: string) => `gcal-oauth:${userId}:${nonce}`;
/** PKCE code_verifier: derived from the key and the state nonce, recomputed at the callback (nothing stored). */
export const pkceVerifier = (deps: Pick<AppDeps, "cipher">, nonce: string) => deps.cipher.derivedSecret("gcal-pkce", nonce);
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

/** Authorization URL with a signed, user-bound, single-use state (5 min) and PKCE S256. */
export async function createAuthUrl(deps: AppDeps, userId: string): Promise<string> {
  const nonce = randomToken(18);
  const { token } = await deps.sessions.signMedia(stateResource(userId, nonce), STATE_TTL_S);
  const state = `${userId}.${nonce}.${token}`;
  const params = new URLSearchParams({
    client_id: deps.config.GOOGLE_OAUTH_CLIENT_ID!,
    redirect_uri: deps.config.GOOGLE_OAUTH_REDIRECT_URI!,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    // A refresh token on every connection (offline + consent), so a reconnect always replaces a revoked one.
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: pkceChallenge(pkceVerifier(deps, nonce)),
    code_challenge_method: "S256",
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/** The user and nonce of a state if it is ours, unexpired and never used before; null otherwise. */
export async function consumeState(deps: AppDeps, state: string): Promise<{ userId: string; nonce: string } | null> {
  const [userId, nonce, ...rest] = state.split(".");
  const token = rest.join(".");
  if (!userId || !UUID.test(userId) || !nonce || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) || !token) return null;
  if (!(await deps.sessions.verifyMedia(token, stateResource(userId, nonce)))) return null;
  if (!(await deps.repo.useOnce(`gcal-state:${nonce}`, new Date(deps.now().getTime() + STATE_TTL_S * 1000)))) return null;
  return { userId, nonce };
}

/** Google said the grant is gone (invalid_grant, revoked, 401): the user must reconnect. */
export class GoogleReconnectNeeded extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "GoogleReconnectNeeded";
  }
}
/** Rate limit, server error or network: retry later. */
export class GoogleTransientError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "GoogleTransientError";
  }
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  error?: string;
}

async function tokenRequest(deps: AppDeps, form: Record<string, string>): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await gfetch(deps)(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: deps.config.GOOGLE_OAUTH_CLIENT_ID!, client_secret: deps.config.GOOGLE_OAUTH_CLIENT_SECRET!, ...form }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GoogleTransientError("token_network");
  }
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (res.ok) return body;
  if (body.error === "invalid_grant" || res.status === 401) throw new GoogleReconnectNeeded(body.error ?? `token_${res.status}`);
  if (res.status === 429 || res.status >= 500) throw new GoogleTransientError(`token_${res.status}`);
  // invalid_client, invalid_request…: our configuration; retried (an operator fixes the env), never a reconnect.
  throw new GoogleTransientError(body.error ? `token_${body.error}` : `token_${res.status}`);
}

/** Email claim of an ID token received directly from Google's token endpoint over TLS (OIDC §3.1.3.7 allows skipping the signature). */
export function idTokenEmail(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: unknown; email_verified?: unknown };
    return typeof payload.email === "string" && payload.email.length <= 254 && payload.email_verified !== false ? payload.email : null;
  } catch {
    return null;
  }
}

export interface ExchangedTokens {
  refreshToken: string | null;
  accessToken: string | null;
  expiresInS: number;
  scope: string;
  email: string | null;
}

/** Authorization code → tokens (PKCE). */
export async function exchangeCode(deps: AppDeps, code: string, verifier: string): Promise<ExchangedTokens> {
  const t = await tokenRequest(deps, { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: deps.config.GOOGLE_OAUTH_REDIRECT_URI! });
  return { refreshToken: t.refresh_token ?? null, accessToken: t.access_token ?? null, expiresInS: t.expires_in ?? 3600, scope: t.scope ?? "", email: idTokenEmail(t.id_token) };
}

export const hasEventsScope = (scope: string) => scope.split(/\s+/).includes(GOOGLE_CALENDAR_EVENTS_SCOPE);

/** Revokes a token at Google. Best effort: false when Google did not confirm. */
export async function revokeToken(deps: AppDeps, token: string): Promise<boolean> {
  try {
    const res = await gfetch(deps)(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    // 400 invalid_token: already revoked or expired, which is what we want.
    return res.ok || res.status === 400;
  } catch {
    return false;
  }
}

// Short-lived access tokens, in memory only (one API instance; never stored, never logged).
const accessCache = new Map<string, { token: string; expiresAt: number }>();
const cacheKey = (c: CalendarConnectionRow) => `${c.userId}:${sha256Hex(c.refreshTokenEncrypted).slice(0, 16)}`;
export const clearAccessCache = (userId?: string) => {
  if (!userId) return accessCache.clear();
  for (const k of accessCache.keys()) if (k.startsWith(`${userId}:`)) accessCache.delete(k);
};

async function accessToken(deps: AppDeps, conn: CalendarConnectionRow, now: Date): Promise<string> {
  const key = cacheKey(conn);
  const hit = accessCache.get(key);
  if (hit && hit.expiresAt > now.getTime() + 60_000) return hit.token;
  let refresh: string;
  try {
    refresh = deps.cipher.decrypt(conn.refreshTokenEncrypted);
  } catch {
    throw new GoogleReconnectNeeded("undecryptable");
  }
  const t = await tokenRequest(deps, { grant_type: "refresh_token", refresh_token: refresh });
  if (!t.access_token) throw new GoogleTransientError("token_no_access_token");
  accessCache.set(key, { token: t.access_token, expiresAt: now.getTime() + (t.expires_in ?? 3600) * 1000 });
  return t.access_token;
}

/** Connection + revocation at Google + pending jobs removed. False when there was no connection. */
export async function disconnectCalendar(deps: AppDeps, userId: string, log?: Log): Promise<boolean> {
  const conn = await deps.repo.calendar.getConnection(userId);
  if (!conn) return false;
  let revoked = false;
  try {
    revoked = await revokeToken(deps, deps.cipher.decrypt(conn.refreshTokenEncrypted));
  } catch {
    revoked = false;
  }
  if (!revoked) log?.warn({ revoked: false }, "google calendar token revocation not confirmed; connection removed anyway");
  clearAccessCache(userId);
  return deps.repo.calendar.deleteConnection(userId);
}

// ------------------------------------------------------------------------------------------- status

export async function calendarStatus(deps: AppDeps, userId: string): Promise<GoogleCalendarStatusResponse> {
  const [ent, conn] = await Promise.all([calendarEntitlement(deps, userId), deps.repo.calendar.getConnection(userId)]);
  return {
    configured: calendarConfigured(deps),
    entitled: ent.entitled,
    entitlement: ent.source,
    trialAvailable: ent.trialAvailable,
    canBuy: ent.canBuy,
    connected: conn !== null,
    status: conn?.status ?? null,
    email: conn?.googleEmail ?? null,
    calendarId: conn?.calendarId ?? null,
    connectedAt: conn?.connectedAt.toISOString() ?? null,
    lastSyncAt: conn?.lastSyncAt?.toISOString() ?? null,
    settings: {
      syncCalls: conn?.syncCalls ?? true,
      syncMissedCalls: conn?.syncMissedCalls ?? true,
      syncVoicemails: conn?.syncVoicemails ?? true,
      syncSummaries: conn?.syncSummaries ?? true,
      includeContent: conn?.includeContent ?? false,
      calendar: "primary",
    },
  };
}

// ------------------------------------------------------------------------------------------- event ids

const BASE32HEX = "0123456789abcdefghijklmnopqrstuv";

/** RFC 4648 base32hex, lowercase, no padding: the alphabet Google Calendar accepts for event ids (a-v, 0-9). */
export function base32hex(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32HEX[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32HEX[(value << (5 - bits)) & 31];
  return out;
}

/** Deterministic Google event id of a (user, source type, source id): 32 base32hex characters. */
export function calendarEventId(userId: string, sourceType: CalendarSourceType, sourceId: string): string {
  return base32hex(createHash("sha256").update(`mimt-calendar:v1:${userId}:${sourceType}:${sourceId}`).digest().subarray(0, 20));
}

// ------------------------------------------------------------------------------------------- queue (hooks)

/** Calendar hooks run on the call path: they never throw (a calendar problem must not change a call). */
async function safe(log: Log | undefined, name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    log?.error({ err: err instanceof Error ? { name: err.name, message: err.message } : String(err), hook: name }, "calendar hook failed");
  }
}

/** Queues one job when CALENDAR=on and the user has a Google Calendar connection. Idempotent per source. */
export async function queueCalendarSync(deps: AppDeps, input: { userId: string; sourceType: CalendarSourceType; sourceId: string; delayS?: number }): Promise<CalendarSyncJobRow | null> {
  if (!calendarOn(deps)) return null;
  if (!(await deps.repo.calendar.getConnection(input.userId))) return null;
  return deps.repo.calendar.enqueueJob({
    userId: input.userId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    notBefore: new Date(deps.now().getTime() + (input.delayS ?? 0) * 1000),
  });
}

async function accountOwner(deps: AppDeps, telecomAccountId: string | null): Promise<string | null> {
  if (!telecomAccountId) return null;
  return (await deps.repo.getAccount(telecomAccountId))?.ownerUserId ?? null;
}

/** A call reached a final status (twilioVoice /status). Business calls go to the member who had it, else the account owner. */
export function calendarCallEnded(deps: AppDeps, log: Log | undefined, call: Call) {
  return safe(log, "call", async () => {
    if (!calendarOn(deps) || call.kind === "emergency") return;
    const userId = call.userId ?? (await accountOwner(deps, call.telecomAccountId));
    if (userId) await queueCalendarSync(deps, { userId, sourceType: "call", sourceId: call.twilioCallSid, delayS: CALL_DELAY_S });
  });
}

/** A voicemail was recorded (personal box or business box). */
export function calendarVoicemailRecorded(deps: AppDeps, log: Log | undefined, vm: Pick<Voicemail, "id" | "telecomAccountId">) {
  return safe(log, "voicemail", async () => {
    if (!calendarOn(deps)) return;
    const userId = await accountOwner(deps, vm.telecomAccountId);
    if (userId) await queueCalendarSync(deps, { userId, sourceType: "voicemail", sourceId: vm.id, delayS: VOICEMAIL_DELAY_S });
  });
}

/** An AI call summary was saved (ai/callSummary.ts): the member who had the call, else the business account owner. */
export function calendarSummarySaved(deps: AppDeps, log: Log | undefined, recording: Pick<RecordingRow, "id" | "userId">, accountOwnerId: string) {
  return safe(log, "call_summary", async () => {
    if (!calendarOn(deps)) return;
    await queueCalendarSync(deps, { userId: recording.userId ?? accountOwnerId, sourceType: "call_summary", sourceId: recording.id });
  });
}

// ------------------------------------------------------------------------------------------- event content

export interface CalendarEventBody {
  id: string;
  summary: string;
  description: string;
  start: { dateTime: string };
  end: { dateTime: string };
  transparency: "transparent";
  reminders: { useDefault: false };
  source: { title: string; url: string };
}

type Built =
  | { kind: "event"; setting: keyof Pick<CalendarConnectionRow, "syncCalls" | "syncMissedCalls" | "syncVoicemails" | "syncSummaries">; event: CalendarEventBody }
  | { kind: "skip"; reason: string }
  | { kind: "wait"; reason: string };

/** "+15145550123" → "(514) 555-0123"; anything else as is (or « numéro inconnu »). */
export function displayNumber(n: string | null | undefined, fr: boolean): string {
  if (!n) return fr ? "numéro inconnu" : "unknown number";
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(n);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : n;
}

const minutes = (s: number | null | undefined) => Math.max(1, Math.round((s ?? 0) / 60));
const MIN_EVENT_MS = 60_000;

function timeRange(start: Date, end: Date | null): { start: { dateTime: string }; end: { dateTime: string } } {
  const endMs = Math.max(end?.getTime() ?? start.getTime(), start.getTime() + MIN_EVENT_MS);
  return { start: { dateTime: start.toISOString() }, end: { dateTime: new Date(endMs).toISOString() } };
}

function description(fr: boolean, lines: string[], content: string | null, link: string): string {
  const parts = [lines.join("\n")];
  if (content) parts.push(content);
  parts.push(`${fr ? "Voir dans MIMT" : "Open in MIMT"} : ${link}`);
  parts.push(fr ? "Ajouté par MIMT. Réglages : Compte › Intégrations." : "Added by MIMT. Settings: Account › Integrations.");
  return parts.join("\n\n").replace(/ : /g, fr ? " : " : ": ");
}

const excerpt = (text: string) => (text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS).trimEnd()}…` : text);

/** Content allowed in the description: the user's opt-in AND their AI consent (Law 25: metadata only by default). */
async function contentAllowed(deps: AppDeps, conn: CalendarConnectionRow): Promise<boolean> {
  return conn.includeContent && (await hasAiConsent(deps.repo, conn.userId));
}

async function buildCallEvent(deps: AppDeps, conn: CalendarConnectionRow, user: User, job: CalendarSyncJobRow): Promise<Built> {
  const fr = user.locale !== "en-CA";
  const call = await deps.repo.getCallBySid(job.sourceId);
  if (!call) return { kind: "skip", reason: "source_gone" };
  if (call.kind === "emergency") return { kind: "skip", reason: "emergency" };
  if (!call.endedAt) return { kind: "wait", reason: "call_not_ended" };
  const inbound = call.direction === "inbound";
  const voicemailLeft = inbound && call.telecomAccountId ? (await deps.repo.listVoicemails(call.telecomAccountId)).some((v) => v.callSid === call.twilioCallSid) : false;
  const missed = inbound && (call.status !== "completed" || voicemailLeft);
  const peer = displayNumber(inbound ? call.fromNumber : call.toNumber, fr);
  const dur = `${minutes(call.durationS)} min`;
  const summary = missed
    ? fr ? `Appel manqué de ${peer}` : `Missed call from ${peer}`
    : inbound
      ? fr ? `Appel de ${peer} — ${dur}` : `Call from ${peer} — ${dur}`
      : fr ? `Appel à ${peer} — ${dur}` : `Call to ${peer} — ${dur}`;
  const lines = missed
    ? [fr ? `Appel manqué${voicemailLeft ? " (message vocal laissé)" : ""}` : `Missed call${voicemailLeft ? " (voicemail left)" : ""}`, `${fr ? "Numéro" : "Number"} : ${peer}`]
    : [fr ? `${inbound ? "Appel entrant" : "Appel sortant"} · ${dur}` : `${inbound ? "Inbound call" : "Outbound call"} · ${dur}`, `${fr ? "Numéro" : "Number"} : ${peer}`];
  const link = `${appUrl(deps)}/appels`;
  return {
    kind: "event",
    setting: missed ? "syncMissedCalls" : "syncCalls",
    event: {
      id: calendarEventId(conn.userId, "call", job.sourceId),
      summary,
      description: description(fr, lines, null, link),
      ...timeRange(call.startedAt, missed ? null : call.endedAt),
      transparency: "transparent",
      reminders: { useDefault: false },
      source: { title: "MIMT", url: link },
    },
  };
}

async function buildVoicemailEvent(deps: AppDeps, conn: CalendarConnectionRow, user: User, job: CalendarSyncJobRow): Promise<Built> {
  const fr = user.locale !== "en-CA";
  const vm = await deps.repo.getVoicemail(job.sourceId);
  if (!vm) return { kind: "skip", reason: "source_gone" };
  const peer = displayNumber(vm.fromNumber, fr);
  const durS = vm.durationS ?? 0;
  const dur = durS < 60 ? `${durS} s` : `${minutes(durS)} min`;
  let content: string | null = null;
  if (await contentAllowed(deps, conn)) {
    const insight = deps.ai ? (await deps.ai.store.getVoicemailInsights([vm.id])).get(vm.id) : undefined;
    if (insight?.summary) content = `${fr ? "Résumé IA" : "AI summary"} : ${insight.summary}`;
    else if (vm.transcript?.trim()) content = `${fr ? "Extrait de la transcription" : "Transcript excerpt"} : « ${excerpt(vm.transcript.trim())} »`;
  }
  const link = `${appUrl(deps)}/messagerie`;
  return {
    kind: "event",
    setting: "syncVoicemails",
    event: {
      id: calendarEventId(conn.userId, "voicemail", vm.id),
      summary: fr ? `Message vocal de ${peer} — ${dur}` : `Voicemail from ${peer} — ${dur}`,
      description: description(fr, [fr ? `Message vocal · ${dur}` : `Voicemail · ${dur}`, `${fr ? "Numéro" : "Number"} : ${peer}`], content, link),
      ...timeRange(new Date(vm.createdAt.getTime() - durS * 1000), vm.createdAt),
      transparency: "transparent",
      reminders: { useDefault: false },
      source: { title: "MIMT", url: link },
    },
  };
}

async function buildSummaryEvent(deps: AppDeps, conn: CalendarConnectionRow, user: User, job: CalendarSyncJobRow): Promise<Built> {
  const fr = user.locale !== "en-CA";
  const rec = await deps.repo.pbx.getRecording(job.sourceId);
  if (!rec) return { kind: "skip", reason: "source_gone" };
  const stored = (await deps.repo.pbx.getCallSummaries([rec.id])).get(rec.id);
  const s = callSummaryDto(deps, stored);
  if (!s) return { kind: "skip", reason: "no_summary" };
  const call = await deps.repo.getCallBySid(rec.callSid);
  const peer = displayNumber(call ? (call.direction === "inbound" ? call.fromNumber : call.toNumber) : rec.fromNumber, fr);
  const durS = rec.durationS ?? call?.durationS ?? 0;
  let content: string;
  if (await contentAllowed(deps, conn)) {
    const items = s.actionItems.length ? `\n${fr ? "Suivis" : "Follow-ups"} :\n${s.actionItems.map((a) => `• ${a}`).join("\n")}` : "";
    content = `${fr ? "Résumé IA" : "AI summary"} : ${s.text}${items}`;
  } else {
    content = fr ? "Un résumé IA de cet appel est disponible dans MIMT." : "An AI summary of this call is available in MIMT.";
  }
  const link = `${appUrl(deps)}/affaires/${encodeURIComponent(rec.businessId)}/enregistrements`;
  const start = call?.startedAt ?? new Date(rec.createdAt.getTime() - durS * 1000);
  return {
    kind: "event",
    setting: "syncSummaries",
    event: {
      id: calendarEventId(conn.userId, "call_summary", rec.id),
      summary: fr ? `Résumé IA — appel avec ${peer}` : `AI summary — call with ${peer}`,
      description: description(fr, [fr ? `Appel enregistré · ${minutes(durS)} min` : `Recorded call · ${minutes(durS)} min`, `${fr ? "Numéro" : "Number"} : ${peer}`], content, link),
      ...timeRange(start, call?.endedAt ?? rec.createdAt),
      transparency: "transparent",
      reminders: { useDefault: false },
      source: { title: "MIMT", url: link },
    },
  };
}

export function buildCalendarEvent(deps: AppDeps, conn: CalendarConnectionRow, user: User, job: CalendarSyncJobRow): Promise<Built> {
  switch (job.sourceType) {
    case "call":
      return buildCallEvent(deps, conn, user, job);
    case "voicemail":
      return buildVoicemailEvent(deps, conn, user, job);
    case "call_summary":
      return buildSummaryEvent(deps, conn, user, job);
  }
}

// ------------------------------------------------------------------------------------------- worker

export const backoffMs = (attempts: number) => Math.min(60_000 * 2 ** attempts, 6 * 3600_000);

type InsertResult = "created" | "exists" | "unauthorized" | "rate_limited" | "server_error" | "forbidden" | "bad_request";

async function insertEvent(deps: AppDeps, token: string, calendarId: string, event: CalendarEventBody): Promise<InsertResult> {
  let res: Response;
  try {
    res = await gfetch(deps)(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return "server_error";
  }
  if (res.ok) return "created";
  // The same id was inserted before (a retry after a lost response): the event is there, nothing to do.
  if (res.status === 409) return "exists";
  if (res.status === 401) return "unauthorized";
  if (res.status === 429 || res.status >= 500) return "rate_limited";
  if (res.status === 403) {
    const text = await res.text().catch(() => "");
    return /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/.test(text) ? "rate_limited" : "forbidden";
  }
  return "bad_request";
}

export interface CalendarSyncResult {
  sent: number;
  skipped: number;
  failed: number;
  retried: number;
  reconnect: number;
}

/** Marks the connection needs_reconnect; the user is told once (push « Reconnectez Google Agenda »). */
async function needsReconnect(deps: AppDeps, userId: string, log: Log) {
  clearAccessCache(userId);
  if (await deps.repo.calendar.markNeedsReconnect(userId, deps.now())) {
    await deps.repo.audit({ actorUserId: null, action: "calendar.needs_reconnect", targetType: "user", targetId: userId });
    await deps.notifier.notify(userId, "calendar_reconnect", {}).catch(() => log.warn({ template: "calendar_reconnect" }, "calendar reconnect notice failed"));
  }
}

/**
 * Sends due jobs to Google Calendar (server.ts every minute). Does nothing while CALENDAR=off or without OAuth
 * credentials. One API instance (same poller model as the partner webhooks).
 */
export async function runCalendarSync(deps: AppDeps, log: Log, opts: { limit?: number } = {}): Promise<CalendarSyncResult> {
  const out: CalendarSyncResult = { sent: 0, skipped: 0, failed: 0, retried: 0, reconnect: 0 };
  if (!calendarOn(deps) || !calendarConfigured(deps)) return out;
  const { repo } = deps;
  const now = deps.now();
  await repo.calendar.purgeFinishedJobs(new Date(now.getTime() - CALENDAR_JOB_RETENTION_MS));
  const jobs = await repo.calendar.listDueJobs(now, opts.limit ?? 50);
  for (const job of jobs) {
    const done = (status: "sent" | "skipped" | "failed", extra: { error?: string; googleEventId?: string } = {}) =>
      repo.calendar.finishJob(job.id, { status, at: now, ...extra });
    const later = (ms: number, error: string, countAttempt: boolean) =>
      repo.calendar.finishJob(job.id, { status: "pending", at: now, nextAttemptAt: new Date(now.getTime() + ms), error, countAttempt });
    const tooOld = now.getTime() - job.createdAt.getTime() > CALENDAR_JOB_MAX_AGE_MS;
    try {
      const conn = await repo.calendar.getConnection(job.userId);
      if (!conn) {
        await done("skipped", { error: "not_connected" });
        out.skipped++;
        continue;
      }
      if (conn.status === "needs_reconnect") {
        if (tooOld) {
          await done("failed", { error: "expired_needs_reconnect" });
          out.failed++;
        } else {
          await later(3600_000, "needs_reconnect", false);
          out.retried++;
        }
        continue;
      }
      const user = await repo.getUser(job.userId);
      if (!user || user.status === "deleted" || user.status === "pending_deletion") {
        await done("skipped", { error: "user_gone" });
        out.skipped++;
        continue;
      }
      if (!(await calendarEntitlement(deps, job.userId)).entitled) {
        await done("skipped", { error: "not_entitled" });
        out.skipped++;
        continue;
      }
      const built = await buildCalendarEvent(deps, conn, user, job);
      if (built.kind === "wait") {
        if (tooOld) {
          await done("skipped", { error: built.reason });
          out.skipped++;
        } else {
          await later(CALL_DELAY_S * 1000, built.reason, false);
          out.retried++;
        }
        continue;
      }
      if (built.kind === "skip") {
        await done("skipped", { error: built.reason });
        out.skipped++;
        continue;
      }
      if (!conn[built.setting]) {
        await done("skipped", { error: "disabled_by_user" });
        out.skipped++;
        continue;
      }
      let result = await insertEvent(deps, await accessToken(deps, conn, now), conn.calendarId, built.event);
      if (result === "unauthorized") {
        // The cached access token may have been revoked early: one fresh token, then a reconnect.
        clearAccessCache(job.userId);
        result = await insertEvent(deps, await accessToken(deps, conn, now), conn.calendarId, built.event);
      }
      if (result === "created" || result === "exists") {
        await done("sent", { googleEventId: built.event.id });
        await repo.calendar.updateConnection(job.userId, { lastSyncAt: now });
        out.sent++;
      } else if (result === "unauthorized" || result === "forbidden") {
        throw new GoogleReconnectNeeded(result);
      } else if (result === "rate_limited" || result === "server_error") {
        throw new GoogleTransientError(result);
      } else {
        await done("failed", { error: result });
        out.failed++;
        log.warn({ jobId: job.id, result }, "google calendar refused the event");
      }
    } catch (err) {
      if (err instanceof GoogleReconnectNeeded) {
        await needsReconnect(deps, job.userId, log);
        await later(3600_000, "needs_reconnect", false);
        out.reconnect++;
      } else {
        const reason = err instanceof GoogleTransientError ? err.message : "error";
        if (job.attempts + 1 >= CALENDAR_MAX_ATTEMPTS) {
          await done("failed", { error: reason });
          out.failed++;
        } else {
          await later(backoffMs(job.attempts), reason, true);
          out.retried++;
        }
        if (!(err instanceof GoogleTransientError)) log.error({ jobId: job.id, err: err instanceof Error ? { name: err.name, message: err.message } : "error" }, "calendar sync job failed");
      }
    }
  }
  return out;
}
