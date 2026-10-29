// Accueil « Centre de contrôle » (pages/Home.tsx): pure helpers, unit-tested. Everything is read from existing routes
// (GET /v1/me, /v1/calls, /v1/voicemails, /v1/conversations); nothing here calls the API.
import {
  dndActive,
  inQuietHours,
  WEEKDAYS,
  type CallRecord,
  type CallSettings,
  type ConversationDto,
  type MeResponse,
  type VoicemailDto,
} from "@mimt/shared";
import type { TKey } from "../i18n/core";

/** How far back « À traiter » looks for missed calls and unanswered texts. Unheard voicemails stay until heard. */
export const TODO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const TODO_LIMIT = 6;

export type TodoKind = "voicemail" | "missed" | "text";

export interface TodoItem {
  kind: TodoKind;
  /** Stable React key. */
  key: string;
  /** E.164, @handle, or null for a hidden number. */
  peer: string | null;
  at: string;
  /** AI summary, else transcript (voicemail), or the last text's preview. */
  snippet: string | null;
  ai: boolean;
  urgent: boolean;
}

export interface TodoCounts {
  voicemail: number;
  missed: number;
  text: number;
}

const time = (iso: string) => new Date(iso).getTime() || 0;

/**
 * « À traiter »: unheard voicemails, missed calls not followed by a call with the same person (and not already a
 * voicemail in the list), and conversations whose last message came from the other person. Likely spam is left out.
 */
export function buildTodo(
  input: { voicemails?: readonly VoicemailDto[]; calls?: readonly CallRecord[]; conversations?: readonly ConversationDto[] },
  now = new Date(),
): { items: TodoItem[]; counts: TodoCounts } {
  const since = now.getTime() - TODO_WINDOW_MS;
  const items: TodoItem[] = [];

  const unheard = (input.voicemails ?? []).filter((v) => !v.listened);
  for (const v of unheard) {
    items.push({
      kind: "voicemail",
      key: `vm:${v.id}`,
      peer: v.from,
      at: v.createdAt,
      snippet: v.ai?.summary ?? v.transcript,
      ai: Boolean(v.ai?.summary),
      urgent: v.ai?.urgency === "high",
    });
  }
  const voicemailPeers = new Set(unheard.map((v) => v.from).filter(Boolean));

  const calls = [...(input.calls ?? [])].sort((a, b) => time(b.startedAt) - time(a.startedAt));
  const seen = new Set<string>();
  for (const c of calls) {
    if (seen.has(c.peer)) continue;
    // The newest call with this person decides: answered or placed since, nothing to do.
    seen.add(c.peer);
    if (!c.missed || c.direction !== "inbound" || c.kind === "emergency" || c.spamLabel) continue;
    if (time(c.startedAt) < since || voicemailPeers.has(c.peer)) continue;
    items.push({ kind: "missed", key: `call:${c.id}`, peer: c.peer, at: c.startedAt, snippet: null, ai: false, urgent: false });
  }

  for (const conv of input.conversations ?? []) {
    if (conv.lastMessage.direction !== "inbound" || time(conv.lastMessageAt) < since) continue;
    items.push({
      kind: "text",
      key: `text:${conv.ourNumber}:${conv.peer}`,
      peer: conv.peer,
      at: conv.lastMessageAt,
      snippet: conv.lastMessage.preview,
      ai: false,
      urgent: false,
    });
  }

  items.sort((a, b) => time(b.at) - time(a.at));
  const counts: TodoCounts = { voicemail: 0, missed: 0, text: 0 };
  for (const i of items) counts[i.kind === "voicemail" ? "voicemail" : i.kind === "missed" ? "missed" : "text"] += 1;
  return { items, counts };
}

export type RouteSummary =
  | { kind: "dnd" }
  | { kind: "apps" }
  | { kind: "always"; target: string }
  | { kind: "no_answer"; target: string; timeoutS: number };

/** « Vos appels vont vers… »: what an inbound call does right now. */
export function routeSummary(settings: CallSettings, now = new Date()): RouteSummary {
  if (dndActive(settings.dnd, now)) return { kind: "dnd" };
  const f = settings.forwarding;
  if (f.mode === "always" && f.target) return { kind: "always", target: f.target };
  if (f.mode === "no_answer" && f.target) return { kind: "no_answer", target: f.target, timeoutS: f.timeoutS };
  return { kind: "apps" };
}

export interface Availability {
  /** What callers get right now. */
  dnd: boolean;
  /** Quiet hours set in the call settings (the home toggle does not edit them), as shown there: first range found. */
  schedule: { from: string; to: string; now: boolean } | null;
}

export function availability(settings: CallSettings, now = new Date()): Availability {
  const { dnd } = settings;
  const first = dnd.enabled && dnd.schedule ? WEEKDAYS.map((d) => dnd.schedule?.[d]?.[0]).find(Boolean) : undefined;
  return {
    dnd: dndActive(dnd, now),
    schedule: first && dnd.schedule ? { from: first.open, to: first.close, now: inQuietHours(dnd.schedule, now) } : null,
  };
}

/** "22:00" → "22 h" (fr) / "10:00 p.m." (en). */
export function formatHhmm(hhmm: string, lang: "fr" | "en"): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  if (lang === "fr") return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
  const suffix = h % 24 < 12 ? "a.m." : "p.m.";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** First name for the greeting ("Camille Tremblay" → "Camille"). */
export function firstName(displayName: string | null | undefined): string | null {
  const name = displayName?.trim().split(/\s+/)[0];
  return name ? name : null;
}

const CELEBRATED_KEY = "mimt.home.setupCelebrated";

/** True once the « Démarrage » checklist has been celebrated in this browser (then the card goes away). */
export function setupCelebrated(): boolean {
  try {
    return localStorage.getItem(CELEBRATED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markSetupCelebrated(): void {
  try {
    localStorage.setItem(CELEBRATED_KEY, "1");
  } catch {
    // Storage blocked: the celebration may show again, nothing else breaks.
  }
}

export interface AccountAlert {
  key: "e911" | "notice" | "status" | "number" | "owed";
  tone: "error" | "warn";
  text: TKey;
  action: TKey;
  to: string;
}

/** « Alertes du compte », most serious first: 9-1-1 address, 9-1-1 notice, account status, no number, points owed. */
export function accountAlerts(me: Pick<MeResponse, "e911" | "account" | "numbers">, pointsOwed: number): AccountAlert[] {
  const out: AccountAlert[] = [];
  if (!me.e911.addressRegistered) out.push({ key: "e911", tone: "error", text: "home.alert.e911", action: "home.alert.e911Action", to: "/compte#e911" });
  else if (!me.e911.noticeAccepted) out.push({ key: "notice", tone: "warn", text: "home.alert.notice", action: "home.alert.noticeAction", to: "/compte#e911" });
  if (me.account.status !== "active") out.push({ key: "status", tone: "warn", text: "home.alert.status", action: "home.alert.statusAction", to: "/compte#forfait" });
  if (!me.numbers.length) out.push({ key: "number", tone: "warn", text: "home.alert.noNumber", action: "home.alert.noNumberAction", to: "/compte#forfait" });
  if (pointsOwed > 0) out.push({ key: "owed", tone: "warn", text: "home.alert.owed", action: "home.alert.owedAction", to: "/points" });
  return out;
}
