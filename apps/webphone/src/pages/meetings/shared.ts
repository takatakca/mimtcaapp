// Pure helpers for the Réunions pages (unit-tested in Meetings.test.tsx).
import { PLANS, type BusinessResponse, type Meeting, type MeResponse } from "@mimt/shared";

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

/** "a@x.ca, b@y.ca\nc@z.ca" → valid (lowercased, unique) and invalid entries. */
export function parseEmails(raw: string): { valid: string[]; invalid: string[] } {
  const parts = raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const valid = [...new Set(parts.filter((p) => EMAIL.test(p)).map((p) => p.toLowerCase()))];
  return { valid, invalid: parts.filter((p) => !EMAIL.test(p)) };
}

/** Who may create meetings: their own plan has video_meetings, or they administer a business. */
export function meetingScopes(me: MeResponse | null, businesses: BusinessResponse[]) {
  const personal = me ? PLANS[me.account.plan]?.features.includes("video_meetings") ?? false : false;
  const adminOf = businesses.filter((b) => b.role === "owner" || b.role === "admin");
  return { personal, adminOf, any: personal || adminOf.length > 0, member: businesses.length > 0 };
}

/** Upcoming and live first (live, then soonest), ended last (most recent first). */
export function splitMeetings(list: Meeting[]): { upcoming: Meeting[]; past: Meeting[] } {
  const when = (m: Meeting) => new Date(m.scheduledStart ?? m.createdAt).getTime();
  const upcoming = list
    .filter((m) => m.status !== "ended")
    .sort((a, b) => (a.status === "live" ? 0 : 1) - (b.status === "live" ? 0 : 1) || when(a) - when(b));
  const past = list.filter((m) => m.status === "ended").sort((a, b) => new Date(b.endedAt ?? b.createdAt).getTime() - new Date(a.endedAt ?? a.createdAt).getTime());
  return { upcoming, past };
}

/** "jeu. 16 oct., 10 h 00 – 11 h 00" */
export function formatMeetingWhen(m: Pick<Meeting, "scheduledStart" | "scheduledEnd">, locale: string): string | null {
  if (!m.scheduledStart) return null;
  const start = new Date(m.scheduledStart);
  const day = start.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
  const time = (d: Date) => d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return m.scheduledEnd ? `${day}, ${time(start)} – ${time(new Date(m.scheduledEnd))}` : `${day}, ${time(start)}`;
}

/** Copies text; false when the Clipboard API is blocked (the UI then shows the link to copy by hand). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** `datetime-local` value (local time, no zone) → ISO with offset; "" → null. */
export function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
