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

/** minutes: bonus minutes added to the current month; premium_month: the referral reward; free_month: the 12-for-11 yearly price. */
export type MissionRewardKind = "minutes" | "premium_month" | "free_month";

export interface MissionDef {
  id: MissionId;
  label: { fr: string; en: string };
  rewardKind: MissionRewardKind;
  /** Bonus minutes (0 for the referral and yearly missions, whose reward is the month itself). */
  minutes: number;
  /** True when completing it needs a purchase (by the user or the invited friend). */
  needsPurchase: boolean;
}

export const MISSIONS: readonly MissionDef[] = [
  { id: "verify_phone", label: { fr: "Vérifiez votre cellulaire", en: "Verify your mobile number" }, rewardKind: "minutes", minutes: 15, needsPurchase: false },
  { id: "choose_handle", label: { fr: "Choisissez votre @nom", en: "Choose your @name" }, rewardKind: "minutes", minutes: 30, needsPurchase: false },
  { id: "enable_push", label: { fr: "Activez les notifications", en: "Turn on notifications" }, rewardKind: "minutes", minutes: 15, needsPurchase: false },
  { id: "install_app", label: { fr: "Installez l'app mobile", en: "Install the mobile app" }, rewardKind: "minutes", minutes: 30, needsPurchase: false },
  { id: "first_number", label: { fr: "Obtenez votre numéro", en: "Get your number" }, rewardKind: "minutes", minutes: 60, needsPurchase: true },
  { id: "invite_friend", label: { fr: "Un ami s'abonne", en: "A friend subscribes" }, rewardKind: "premium_month", minutes: 0, needsPurchase: true },
  { id: "go_yearly", label: { fr: "Passez à l'annuel", en: "Go yearly" }, rewardKind: "free_month", minutes: 0, needsPurchase: true },
];

export const MISSION_IDS = MISSIONS.map((m) => m.id);

/** Most bonus minutes one account can ever earn from missions: the sum of the table (150). Checked by the API. */
export const MISSION_MINUTES_CAP = MISSIONS.reduce((sum, m) => sum + m.minutes, 0);

export function missionDef(id: MissionId): MissionDef {
  const def = MISSIONS.find((m) => m.id === id);
  if (!def) throw new Error(`unknown mission ${id}`);
  return def;
}

export function isMissionId(id: string): id is MissionId {
  return (MISSION_IDS as readonly string[]).includes(id);
}
