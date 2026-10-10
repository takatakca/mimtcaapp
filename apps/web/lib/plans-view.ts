import { ADD_ONS, PLANS, formatCad, type Feature, type Plan, type PlanCode } from "@mimt/shared";
import type { Lang } from "./site";

export { ADD_ONS, PLANS, formatCad };
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
  return lang === "fr"
    ? `ou ${formatCad(plan.yearlyPriceCents, lang)}/an`
    : `or ${formatCad(plan.yearlyPriceCents, lang)}/year`;
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
  ai_assist: { fr: "Assistance IA (réponses suggérées, réceptionniste virtuel)", en: "AI assist (suggested replies, virtual receptionist)" },
};

/** Honest, capped bullet points for a plan card. */
export function capLines(plan: Plan, lang: Lang): string[] {
  const c = plan.caps;
  const fr = lang === "fr";
  const pooled = plan.perLine ? (fr ? " par ligne" : " per line") : "";
  const lines = [
    fr
      ? `${num(c.outboundMinutes, lang)} minutes sortantes/mois${pooled} (Canada et É.-U.)`
      : `${num(c.outboundMinutes, lang)} outbound minutes/month${pooled} (Canada & US)`,
    fr
      ? `${num(c.inboundMinutes, lang)} minutes entrantes/mois${pooled}`
      : `${num(c.inboundMinutes, lang)} inbound minutes/month${pooled}`,
    fr
      ? `${num(c.outboundSms, lang)} textos sortants/mois${pooled}`
      : `${num(c.outboundSms, lang)} outbound texts/month${pooled}`,
  ];
  if (c.inactivityDays !== null) {
    lines.push(
      fr
        ? `Numéro récupéré après ${c.inactivityDays} jours sans activité (avis avant)`
        : `Number reclaimed after ${c.inactivityDays} days without activity (with warnings)`,
    );
  }
  return lines;
}
