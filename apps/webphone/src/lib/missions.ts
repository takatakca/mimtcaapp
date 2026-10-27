// Missions MIMT on the web app: the API grants every reward itself (apps/api services/missions.ts); the app only
// shows them and celebrates. A grant arrives either in the response of the route that triggered it
// (`missionGranted`, e.g. PUT /v1/me/handle) or, for grants made elsewhere (SMS sign-in, Stripe webhook, a friend
// subscribing), as a mission newly done in GET /v1/missions, read by the toaster when the app opens. Each mission is
// celebrated once per browser (localStorage), whichever way it arrived.
import { MISSIONS, type MissionDto, type MissionGrantedDto, type MissionId } from "@mimt/shared";

export const MISSION_EVENT = "mimt:mission";
const SEEN_KEY = "mimt.missions.celebrated";

export interface MissionCelebration {
  id: MissionId;
  minutes: number;
  pending: boolean;
}

const seenKey = (c: Pick<MissionCelebration, "id" | "pending">) => `${c.id}:${c.pending ? "pending" : "done"}`;

function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/** True the first time a celebration is seen in this browser (and remembers it). */
export function firstTimeSeen(c: MissionCelebration): boolean {
  const seen = readSeen();
  const key = seenKey(c);
  if (seen.has(key)) return false;
  seen.add(key);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    // Private mode or storage blocked: the toast may show again, nothing else breaks.
  }
  return true;
}

/** Asks the toaster (components/MissionToaster.tsx) to celebrate; it shows each mission once. */
export function celebrateMission(c: MissionCelebration): void {
  window.dispatchEvent(new CustomEvent<MissionCelebration>(MISSION_EVENT, { detail: c }));
}

/** From a route response's `missionGranted`. */
export function celebrateGrant(granted: MissionGrantedDto | undefined | null): void {
  if (granted) celebrateMission({ id: granted.id, minutes: granted.minutes, pending: granted.status === "pending" });
}

/** From GET /v1/missions: every mission done or pending (the toaster skips those already celebrated). */
export function celebrationsOf(missions: readonly MissionDto[]): MissionCelebration[] {
  return missions.filter((m) => m.status !== "todo").map((m) => ({ id: m.id, minutes: m.minutes, pending: m.status === "pending" }));
}

export const missionLabel = (id: MissionId, lang: "fr" | "en") => MISSIONS.find((m) => m.id === id)?.label[lang] ?? id;

/**
 * Where each mission is completed: a screen of the app, the invite box of the Missions page, or mimt.ca. Null for
 * verify_phone: it happens at sign-in (code by text), which a signed-in user reaches by signing in again.
 */
export function missionTarget(id: MissionId, lang: "fr" | "en"): { to: string; external?: boolean } | null {
  switch (id) {
    case "verify_phone":
      return null;
    case "choose_handle":
      return { to: "/compte#nom" };
    case "enable_push":
      return { to: "/compte#notifications" };
    case "install_app":
      return { to: lang === "fr" ? "https://mimt.ca/bientot" : "https://mimt.ca/en/coming-soon", external: true };
    case "first_number":
    case "go_yearly":
      return { to: "/compte#forfait" };
    case "invite_friend":
      return { to: "#inviter" };
  }
}

/** Missions done (pending counts: the mission itself is done, only its minutes wait). */
export function missionProgress(missions: readonly MissionDto[]): { done: number; total: number; percent: number } {
  const done = missions.filter((m) => m.status !== "todo").length;
  const total = missions.length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}
