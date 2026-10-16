// Réunions MIMT on mobile (pure, unit-tested). Native video comes later: for now the app lists meetings
// and opens the meeting page of app.mimt.ca in the browser (docs/MIMT-VIDEO.md).
import type { Meeting } from "@mimt/shared";

export const MEETINGS_WEB_URL = "https://app.mimt.ca/reunions";

/** Live first, then upcoming by date; ended meetings are left out of the phone list. */
export function activeMeetings(list: Meeting[]): Meeting[] {
  const when = (m: Meeting) => new Date(m.scheduledStart ?? m.createdAt).getTime();
  return list
    .filter((m) => m.status !== "ended")
    .sort((a, b) => (a.status === "live" ? 0 : 1) - (b.status === "live" ? 0 : 1) || when(a) - when(b));
}

/** Only https links of app.mimt.ca are opened (the API builds joinUrl from APP_BASE_URL). */
export function meetingWebUrl(m: Pick<Meeting, "id" | "joinUrl">): string {
  try {
    const u = new URL(m.joinUrl);
    if (u.protocol === "https:" && u.hostname === "app.mimt.ca") return u.toString();
  } catch {
    // Fall through to the canonical URL.
  }
  return `${MEETINGS_WEB_URL}/${encodeURIComponent(m.id)}`;
}
