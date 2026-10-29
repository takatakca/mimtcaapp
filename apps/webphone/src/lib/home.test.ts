import { DEFAULT_CALL_SETTINGS, type CallRecord, type ConversationDto, type VoicemailDto } from "@mimt/shared";
import { describe, expect, it } from "vitest";
import { accountAlerts, availability, buildTodo, firstName, formatHhmm, routeSummary } from "./home";

const NOW = new Date("2026-10-29T15:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const vm = (over: Partial<VoicemailDto>): VoicemailDto => ({
  id: "vm",
  from: "+15145550111",
  durationS: 10,
  transcript: "Rappelez-moi.",
  createdAt: ago(1),
  listened: false,
  audioUrl: null,
  audioUrlExpiresAt: null,
  ...over,
});
const call = (over: Partial<CallRecord>): CallRecord => ({
  id: "c",
  direction: "inbound",
  kind: "pstn",
  peer: "+15145550122",
  ourNumber: "+15145550100",
  status: "no-answer",
  startedAt: ago(2),
  endedAt: null,
  durationS: null,
  missed: true,
  ...over,
});
const conv = (over: Partial<ConversationDto>): ConversationDto => ({
  peer: "+15145550133",
  ourNumber: "+15145550100",
  lastMessageAt: ago(3),
  lastMessage: { id: "m", direction: "inbound", preview: "Salut" },
  ...over,
});

describe("buildTodo (« À traiter »)", () => {
  it("lists unheard voicemails with the AI summary first, missed calls and unanswered texts, newest first", () => {
    const { items, counts } = buildTodo(
      {
        voicemails: [
          vm({ id: "a", ai: { summary: "Livraison jeudi", locale: "fr-CA", callerIntent: "livraison", urgency: "high", callbackSuggested: true, spamLikelihood: 0 } }),
          vm({ id: "heard", listened: true }),
        ],
        calls: [call({ id: "m1" })],
        conversations: [conv({}), conv({ peer: "+15145550144", lastMessage: { id: "x", direction: "outbound", preview: "Ok" } })],
      },
      NOW,
    );
    expect(items.map((i) => i.key)).toEqual(["vm:a", "call:m1", "text:+15145550100:+15145550133"]);
    expect(items[0]).toMatchObject({ snippet: "Livraison jeudi", ai: true, urgent: true });
    expect(counts).toEqual({ voicemail: 1, missed: 1, text: 1 });
  });

  it("drops missed calls already called back, left as a voicemail, spam, 9-1-1 or older than 7 days", () => {
    const { items } = buildTodo(
      {
        voicemails: [vm({ from: "+15145550155" })],
        calls: [
          call({ id: "back", peer: "+15145550122", startedAt: ago(5) }),
          call({ id: "later", peer: "+15145550122", direction: "outbound", missed: false, startedAt: ago(1) }),
          call({ id: "vm", peer: "+15145550155" }),
          call({ id: "spam", peer: "+15145550166", spamLabel: "spam" }),
          call({ id: "old", peer: "+15145550177", startedAt: ago(24 * 8) }),
        ],
      },
      NOW,
    );
    expect(items.map((i) => i.kind)).toEqual(["voicemail"]);
  });

  it("is empty when there is nothing", () => {
    expect(buildTodo({}, NOW)).toEqual({ items: [], counts: { voicemail: 0, missed: 0, text: 0 } });
  });
});

describe("routeSummary and availability", () => {
  it("summarises forwarding and do not disturb", () => {
    expect(routeSummary(DEFAULT_CALL_SETTINGS, NOW)).toEqual({ kind: "apps" });
    const fwd = { ...DEFAULT_CALL_SETTINGS, forwarding: { mode: "no_answer" as const, target: "+15145550199", timeoutS: 25 } };
    expect(routeSummary(fwd, NOW)).toEqual({ kind: "no_answer", target: "+15145550199", timeoutS: 25 });
    expect(routeSummary({ ...fwd, dnd: { enabled: true, schedule: null } }, NOW)).toEqual({ kind: "dnd" });
    expect(availability({ ...fwd, dnd: { enabled: true, schedule: null } }, NOW)).toEqual({ dnd: true, schedule: null });
  });

  it("reports quiet hours without treating them as on outside the range", () => {
    const range = [{ open: "22:00", close: "07:00" }];
    const schedule = { mon: range, tue: range, wed: range, thu: range, fri: range, sat: range, sun: range };
    // 11:00 in Montréal.
    const a = availability({ ...DEFAULT_CALL_SETTINGS, dnd: { enabled: true, schedule } }, NOW);
    expect(a).toEqual({ dnd: false, schedule: { from: "22:00", to: "07:00", now: false } });
  });

  it("formats hours and first names", () => {
    expect(formatHhmm("22:00", "fr")).toBe("22 h");
    expect(formatHhmm("07:30", "fr")).toBe("7 h 30");
    expect(formatHhmm("22:00", "en")).toBe("10:00 p.m.");
    expect(firstName("Camille Tremblay")).toBe("Camille");
    expect(firstName("  ")).toBeNull();
  });
});

describe("accountAlerts", () => {
  const ok = { e911: { addressRegistered: true, noticeAccepted: true, noticeVersion: "v1" }, account: { id: "a", kind: "consumer" as const, plan: "free" as const, status: "active" }, numbers: [{ id: "n", e164: "+15145550100", state: "active" as const }] };
  it("is empty for a healthy account", () => {
    expect(accountAlerts(ok, 0)).toEqual([]);
  });
  it("puts a missing 9-1-1 address first, then the rest", () => {
    const alerts = accountAlerts({ ...ok, e911: { ...ok.e911, addressRegistered: false }, account: { ...ok.account, status: "past_due" }, numbers: [] }, 50);
    expect(alerts.map((a) => a.key)).toEqual(["e911", "status", "number", "owed"]);
    expect(alerts[0]).toMatchObject({ tone: "error", to: "/compte#e911" });
  });
});
