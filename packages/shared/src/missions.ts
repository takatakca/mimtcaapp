// « Missions MIMT »: one-time rewards for setting up the account. Every reward is granted by the API itself when it
// sees the event happen (apps/api/src/services/missions.ts), at most once per account (and per phone or device),
// logged in mission_rewards (supabase/migrations/0017_missions.sql) and in the audit log.
//
// Legal lines that are never crossed (docs/MIMT-MISSIONS.md):
//  - no reward for reviews or ratings (Apple, Google, Competition Bureau);
//  - no reward for likes, follows or shares on social networks (Meta forbids incentivised likes);
//  - no chance, draw or random prize (Quebec contest rules, Criminal Code s. 206): every reward is fixed and known.
// Sharing is rewarded only through the existing referral conversion (a friend subscribes, routes/referrals.ts).

export type MissionId = "verify_phone" | "choose_handle" | "enable_push" | "install_app" | "first_number" | "invite_friend" | "go_yearly";

/**
 * points: MIMT Points (docs/MIMT-POINTS.md, 10 points = 1 minute equivalent); premium_month: the referral reward (the
 * referrer also earns REFERRAL_POINTS, points.ts); free_month: the 12-for-11 yearly price. "minutes" is the reward of
 * missions granted before 2026-10-28 (bonus minutes added to that month); those grants keep their minutes.
 */
export type MissionRewardKind = "points" | "minutes" | "premium_month" | "free_month";

export interface MissionDef {
  id: MissionId;
  label: { fr: string; en: string };
  rewardKind: MissionRewardKind;
  /** MIMT Points (0 for the referral and yearly missions, whose reward is the month itself). */
  points: number;
  /**
   * Minute equivalent of the points (points / 10: what they buy as bonus minutes in the points catalog). Kept for
   * mimt.ca's missions page (apps/web), which still says « +30 minutes »; new grants give points, never minutes.
   */
  minutes: number;
  /** True when completing it needs a purchase (by the user or the invited friend). */
  needsPurchase: boolean;
}

export const MISSIONS: readonly MissionDef[] = [
  { id: "verify_phone", label: { fr: "Vérifiez votre cellulaire", en: "Verify your mobile number" }, rewardKind: "points", points: 150, minutes: 15, needsPurchase: false },
  { id: "choose_handle", label: { fr: "Choisissez votre @nom", en: "Choose your @name" }, rewardKind: "points", points: 300, minutes: 30, needsPurchase: false },
  { id: "enable_push", label: { fr: "Activez les notifications", en: "Turn on notifications" }, rewardKind: "points", points: 150, minutes: 15, needsPurchase: false },
  { id: "install_app", label: { fr: "Installez l'app mobile", en: "Install the mobile app" }, rewardKind: "points", points: 300, minutes: 30, needsPurchase: false },
  { id: "first_number", label: { fr: "Obtenez votre numéro", en: "Get your number" }, rewardKind: "points", points: 600, minutes: 60, needsPurchase: true },
  { id: "invite_friend", label: { fr: "Un ami s'abonne", en: "A friend subscribes" }, rewardKind: "premium_month", points: 0, minutes: 0, needsPurchase: true },
  { id: "go_yearly", label: { fr: "Passez à l'annuel", en: "Go yearly" }, rewardKind: "free_month", points: 0, minutes: 0, needsPurchase: true },
];

export const MISSION_IDS = MISSIONS.map((m) => m.id);

/** Most points one account can ever earn from missions: the sum of the table (1 500). Checked by the API. */
export const MISSION_POINTS_CAP = MISSIONS.reduce((sum, m) => sum + m.points, 0);

/**
 * Most bonus minutes one account could earn from missions before they switched to points (2026-10-28). Missions
 * granted as minutes keep them; a new grant is in points and never adds minutes. 10 points = 1 minute equivalent.
 */
export const MISSION_MINUTES_CAP = MISSIONS.reduce((sum, m) => sum + m.minutes, 0);

export function missionDef(id: MissionId): MissionDef {
  const def = MISSIONS.find((m) => m.id === id);
  if (!def) throw new Error(`unknown mission ${id}`);
  return def;
}

export function isMissionId(id: string): id is MissionId {
  return (MISSION_IDS as readonly string[]).includes(id);
}
