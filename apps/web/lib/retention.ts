// Retention periods shown in the privacy policy. Every value is one the code applies; shared values are imported,
// API-only values are copied here and test/legal.test.ts checks them against the API source, so the policy can
// never drift from what the jobs do.

import {
  DEFAULT_RECORDING_POLICY,
  GRACE_DAYS,
  INACTIVITY_WARNING_DAYS,
  MMS_RETENTION_DAYS,
  PENDING_UPLOAD_TTL_HOURS,
  PLANS,
  QUARANTINE_DAYS,
  VOICEMAIL_EMAIL_LINK_TTL_S,
} from "@mimt/shared";
import type { Lang } from "./site.ts";

/** apps/api/src/jobs/accountDeletion.ts DELETION_DELAY_DAYS: purge after a deletion request. */
export const ACCOUNT_PURGE_DAYS = 30;
/** apps/api/src/jobs/sessionRetention.ts SESSION_RETENTION_DAYS: revoked or idle sign-in sessions. */
export const SESSION_RETENTION_DAYS = 90;
/** apps/api/src/services/affiliates.ts REJECTED_RETENTION_DAYS: rejected affiliate applications. */
export const AFFILIATE_REJECTED_DAYS = 90;
/** apps/api/src/services/calendar.ts CALENDAR_JOB_RETENTION_MS (30 days): finished Google Calendar sync jobs. */
export const CALENDAR_JOB_DAYS = 30;

export const RETENTION = {
  accountPurgeDays: ACCOUNT_PURGE_DAYS,
  sessionDays: SESSION_RETENTION_DAYS,
  affiliateRejectedDays: AFFILIATE_REJECTED_DAYS,
  calendarJobDays: CALENDAR_JOB_DAYS,
  quarantineDays: QUARANTINE_DAYS,
  graceDays: GRACE_DAYS,
  warningDays: INACTIVITY_WARNING_DAYS,
  freeInactivityDays: PLANS.free.caps.inactivityDays,
  mmsDays: MMS_RETENTION_DAYS,
  pendingUploadHours: PENDING_UPLOAD_TTL_HOURS,
  voicemailLinkDays: VOICEMAIL_EMAIL_LINK_TTL_S / 86_400,
  recordingDays: DEFAULT_RECORDING_POLICY.retentionDays,
} as const;

export interface RetentionRow {
  what: string;
  how: string;
}

/** Rows of the « Combien de temps nous les gardons » table, French first. */
export function retentionRows(lang: Lang): RetentionRow[] {
  const R = RETENTION;
  const [w1, w2] = R.warningDays;
  if (lang === "fr") {
    return [
      { what: "Compte (nom, courriel, numéro de téléphone vérifié, langue)", how: `Tant que le compte est ouvert. Effacés ${R.accountPurgeDays} jours après une demande de suppression du compte.` },
      { what: "Textos, messages vocaux, transcriptions et résumés par IA", how: `Jusqu'à ce que vous les supprimiez, tant que le compte est ouvert. Supprimés ${R.accountPurgeDays} jours après une demande de suppression du compte, ou quand le numéro concerné est libéré.` },
      { what: "Photos envoyées ou reçues par texto (MMS)", how: `${R.mmsDays} jours, puis supprimées de notre stockage. Un fichier téléversé mais jamais envoyé est supprimé après ${R.pendingUploadHours} heures.` },
      { what: "Lien d'écoute d'un message vocal envoyé par courriel", how: `Valide ${R.voicemailLinkDays} jours.` },
      { what: "Adresse 9-1-1, @nom, appareils, consentements, données d'IA", how: `Tant que le compte est ouvert. Supprimés ${R.accountPurgeDays} jours après une demande de suppression du compte.` },
      { what: "Sessions de connexion (type d'appareil, réseau approximatif)", how: `Supprimées ${R.sessionDays} jours après leur révocation ou leur dernière utilisation.` },
      { what: "Numéro inactif d'un compte revenu au forfait Gratuit (sans forfait payant)", how: `Après ${R.freeInactivityDays} jours sans activité et deux rappels (jours ${w1} et ${w2}), ${R.graceDays} jours de grâce, puis ${R.quarantineDays} jours de quarantaine pendant lesquels le numéro n'est donné à personne d'autre. À sa libération, ses textos et messages vocaux sont supprimés.` },
      { what: "Numéros d'un compte supprimé", how: `${R.quarantineDays} jours de quarantaine avant toute réattribution.` },
      { what: "Enregistrements d'appels (Affaires Pro)", how: `Chaque enregistrement reçoit une date de suppression : ${R.recordingDays} jours par défaut, ou le délai choisi par l'entreprise.` },
      { what: "Tâches de synchronisation Google Agenda terminées", how: `${R.calendarJobDays} jours.` },
      { what: "Candidatures au programme d'agents affiliés refusées", how: `${R.affiliateRejectedDays} jours après le refus.` },
      { what: "Factures, abonnements, registres d'appels, acceptation de l'avis 9-1-1, journaux de sécurité et de fraude", how: "Gardés après la suppression du compte, pour la durée exigée par la loi (par exemple 6 ans pour les registres comptables)." },
    ];
  }
  return [
    { what: "Account (name, email, verified phone number, language)", how: `While the account is open. Erased ${R.accountPurgeDays} days after an account deletion request.` },
    { what: "Texts, voicemails, transcripts and AI summaries", how: `Until you delete them, while the account is open. Deleted ${R.accountPurgeDays} days after an account deletion request, or when the number they belong to is released.` },
    { what: "Photos sent or received by text (MMS)", how: `${R.mmsDays} days, then deleted from our storage. A file uploaded but never sent is deleted after ${R.pendingUploadHours} hours.` },
    { what: "Voicemail listening link sent by email", how: `Valid for ${R.voicemailLinkDays} days.` },
    { what: "9-1-1 address, @name, devices, consents, AI data", how: `While the account is open. Deleted ${R.accountPurgeDays} days after an account deletion request.` },
    { what: "Sign-in sessions (device type, approximate network)", how: `Deleted ${R.sessionDays} days after they are revoked or last used.` },
    { what: "Inactive number on an account back on the Free plan (no paid plan)", how: `After ${R.freeInactivityDays} days without activity and two reminders (days ${w1} and ${w2}), a ${R.graceDays}-day grace period, then a ${R.quarantineDays}-day quarantine during which the number is given to no one else. When it is released, its texts and voicemails are deleted.` },
    { what: "Numbers of a deleted account", how: `${R.quarantineDays}-day quarantine before any reassignment.` },
    { what: "Call recordings (Business Pro)", how: `Each recording gets a deletion date: ${R.recordingDays} days by default, or the period the business chooses.` },
    { what: "Finished Google Calendar sync jobs", how: `${R.calendarJobDays} days.` },
    { what: "Rejected affiliate agent applications", how: `${R.affiliateRejectedDays} days after the rejection.` },
    { what: "Invoices, subscriptions, call records, 9-1-1 notice acceptance, security and fraud logs", how: "Kept after account deletion, for the period the law requires (for example 6 years for accounting records)." },
  ];
}
