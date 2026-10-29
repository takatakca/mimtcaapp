import { ADD_ONS, PLANS, SUBSCRIPTION_ADD_ONS, formatCad, type Feature, type Plan, type PlanCode } from "@mimt/shared";
import type { Lang } from "./site";

export { ADD_ONS, PLANS, SUBSCRIPTION_ADD_ONS, formatCad };
export type { Feature, Plan, PlanCode };

export const CONSUMER_PLANS: PlanCode[] = ["free", "lock", "premium"];
export const BUSINESS_PLANS: PlanCode[] = ["business", "business_pro"];
export const ALL_PLANS: PlanCode[] = [...CONSUMER_PLANS, ...BUSINESS_PLANS];

const nf = (lang: Lang) => new Intl.NumberFormat(lang === "fr" ? "fr-CA" : "en-CA");
export const num = (n: number, lang: Lang) => nf(lang).format(n);

export function price(plan: Plan, lang: Lang): { amount: string; unit: string } {
  if (plan.monthlyPriceCents === 0) return { amount: formatCad(0, lang), unit: lang === "fr" ? "pour toujours" : "forever" };
  const unit = plan.perLine
    ? lang === "fr" ? "/ligne/mois" : "/line/month"
    : lang === "fr" ? "/mois" : "/month";
  return { amount: formatCad(plan.monthlyPriceCents, lang), unit };
}

export function yearly(plan: Plan, lang: Lang): string | null {
  if (!plan.yearlyPriceCents) return null;
  const free = plan.yearlyPriceCents <= plan.monthlyPriceCents * 11;
  if (lang === "fr") return `ou ${formatCad(plan.yearlyPriceCents, lang)}/an${free ? " : 1 mois gratuit" : ""}`;
  return `or ${formatCad(plan.yearlyPriceCents, lang)}/year${free ? ": 1 month free" : ""}`;
}

export const FEATURE_LABELS: Record<Feature, { fr: string; en: string }> = {
  no_ads: { fr: "Sans publicité", en: "No ads" },
  number_lock: { fr: "Numéro conservé même sans activité", en: "Number kept even when inactive" },
  vm_transcription: { fr: "Transcription de la messagerie vocale", en: "Voicemail transcription" },
  intl_calling: { fr: "Appels internationaux", en: "International calling" },
  extra_number: { fr: "Numéro supplémentaire", en: "Extra number" },
  mms: { fr: "Messages photo (MMS)", en: "Picture messages (MMS)" },
  call_forwarding: { fr: "Renvoi d'appel", en: "Call forwarding" },
  call_recording: { fr: "Enregistrement des appels", en: "Call recording" },
  auto_attendant: { fr: "Réceptionniste automatique", en: "Auto-attendant" },
  ring_groups: { fr: "Groupes de sonnerie", en: "Ring groups" },
  admin_portal: { fr: "Portail administrateur", en: "Admin portal" },
  ai_assist: { fr: "Fonctions IA, avec consentement (résumés vocaux, réponses suggérées)", en: "AI features, with consent (voicemail summaries, suggested replies)" },
  vm_greeting: { fr: "Message d'accueil personnalisé", en: "Custom voicemail greeting" },
  vm_email: { fr: "Messages vocaux par courriel", en: "Voicemail to email" },
  video_meetings: { fr: "Réunions vidéo (partage d'écran, invités par lien)", en: "Video meetings (screen sharing, guest links)" },
  calendar_sync: { fr: "Google Agenda (appels et messages vocaux dans votre agenda)", en: "Google Calendar (calls and voicemails in your calendar)" },
};

/**
 * Features in PLANS whose service is not live yet: shown with « bientôt » / "coming soon".
 * Remove a feature from this list on the day it ships.
 */
// calendar_sync: behind CALENDAR=off until Google's OAuth verification (docs/MIMT-CALENDAR.md).
export const SOON_FEATURES: readonly Feature[] = ["video_meetings", "calendar_sync"];

export function featureLabel(f: Feature, lang: Lang): string {
  const base = FEATURE_LABELS[f][lang];
  return SOON_FEATURES.includes(f) ? `${base} — ${lang === "fr" ? "bientôt" : "coming soon"}` : base;
}

/** Honest, capped bullet points for a plan card. */
export function capLines(plan: Plan, lang: Lang): string[] {
  const c = plan.caps;
  const fr = lang === "fr";
  const pooled = plan.perLine ? (fr ? " par ligne" : " per line") : "";
  if (!c.hasNumber) {
    // Gratuit: MIMT-to-MIMT only (docs/MIMT-UNIT-ECONOMICS.md), no phone-network number.
    return [
      fr ? "Pas de numéro de téléphone : seulement entre applications MIMT" : "No phone number: MIMT app to MIMT app only",
      fr ? "Textos illimités entre applications MIMT" : "Unlimited texts between MIMT apps",
      fr
        ? `${num(c.onNetMinutes ?? 0, lang)} minutes d'appels entre applications MIMT/mois`
        : `${num(c.onNetMinutes ?? 0, lang)} minutes of MIMT app-to-app calls/month`,
    ];
  }
  const lines = [
    fr ? "Votre numéro canadien, payé d'avance et attribué tout de suite" : "Your Canadian number, paid up front and assigned right away",
    fr
      ? `${num(c.outboundMinutes, lang)} minutes sortantes/mois${pooled} (Canada et É.-U.)`
      : `${num(c.outboundMinutes, lang)} outbound minutes/month${pooled} (Canada & US)`,
    fr
      ? `${num(c.inboundMinutes, lang)} minutes entrantes/mois${pooled}`
      : `${num(c.inboundMinutes, lang)} inbound minutes/month${pooled}`,
    fr
      ? `${num(c.messages, lang)} textos/mois${pooled}, envoyés et reçus`
      : `${num(c.messages, lang)} texts/month${pooled}, sent and received`,
  ];
  if (c.mms > 0) lines.push(fr ? `Dont ${num(c.mms, lang)} messages photo (MMS) envoyés` : `Including ${num(c.mms, lang)} picture messages (MMS) sent`);
  if (c.transcriptionMinutes > 0) {
    lines.push(fr ? `${num(c.transcriptionMinutes, lang)} minutes de transcription vocale/mois` : `${num(c.transcriptionMinutes, lang)} minutes of voicemail transcription/month`);
  }
  if (c.recordingMinutes > 0) {
    lines.push(fr ? `${num(c.recordingMinutes, lang)} minutes d'enregistrement/mois${pooled}` : `${num(c.recordingMinutes, lang)} recording minutes/month${pooled}`);
  }
  lines.push(fr ? "Appels entre applications MIMT compris dans les minutes sortantes" : "MIMT app-to-app calls count as outbound minutes");
  if (c.inactivityDays !== null) {
    lines.push(
      fr
        ? `Numéro récupéré après ${c.inactivityDays} jours sans activité (avis avant)`
        : `Number reclaimed after ${c.inactivityDays} days without activity (with warnings)`,
    );
  }
  return lines;
}
