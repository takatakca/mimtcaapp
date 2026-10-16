// Title and description of every page, French first. Used for <title>, meta description, Open Graph,
// Twitter cards and the WebPage JSON-LD node, so each page states the same thing everywhere.
// Titles stay under ~60 characters and descriptions under ~160 (search result snippets).

import type { Metadata } from "next";
import { pageMeta, type Lang, type RouteKey } from "./site.ts";

export const PAGE_META: Record<RouteKey, Record<Lang, { title: string; description: string }>> = {
  home: {
    fr: {
      title: "MIMT | Votre numéro canadien, partout",
      description:
        "Un vrai numéro canadien pour appeler et texter par Wi‑Fi ou données. Téléphonie d'affaires bilingue avec IA. Fait au Québec, en français d'abord.",
    },
    en: {
      title: "MIMT | Your Canadian number, anywhere",
      description:
        "A real Canadian number to call and text over Wi‑Fi or data. Bilingual business phone system with AI. Made in Québec, French first.",
    },
  },
  plans: {
    fr: {
      title: "Forfaits et prix",
      description: "Forfaits MIMT Mobile et MIMT Affaires : gratuit avec publicités, verrouillage du numéro, Premium et prix par ligne. Toutes les limites affichées.",
    },
    en: {
      title: "Plans and pricing",
      description: "MIMT Mobile and MIMT Business plans: free with ads, Number Lock, Premium and per-line pricing. Every limit shown up front.",
    },
  },
  business: {
    fr: {
      title: "MIMT Affaires : système téléphonique d'entreprise",
      description:
        "Postes, réceptionniste automatique bilingue, groupes de sonnerie, heures et jours fériés du Québec, enregistrement avec avis. Prix par ligne.",
    },
    en: {
      title: "MIMT Business: cloud business phone system",
      description:
        "Extensions, bilingual auto-attendant, ring groups, business hours and Québec holidays, call recording with notice. Per-line pricing.",
    },
  },
  ai: {
    fr: {
      title: "IA : résumés vocaux, réponses, réceptionniste",
      description:
        "Résumés de messages vocaux, réponses suggérées, étiquettes « Spam probable » et réceptionniste IA. Toujours avec votre consentement (Loi 25).",
    },
    en: {
      title: "AI: voicemail summaries, replies, receptionist",
      description:
        "Voicemail summaries, suggested replies, “Likely spam” labels and an AI receptionist. Always with your consent (Québec Law 25).",
    },
  },
  webapp: {
    fr: {
      title: "App Web app.mimt.ca",
      description: "Appelez, textez et écoutez vos messages vocaux dans le navigateur avec votre numéro MIMT. Portail administrateur pour MIMT Affaires.",
    },
    en: {
      title: "Web app app.mimt.ca",
      description: "Call, text and play voicemail in your browser with your MIMT number. Admin portal for MIMT Business.",
    },
  },
  compare: {
    fr: {
      title: "Comparer MIMT aux applis de numéro gratuit",
      description: "Ce que MIMT fait différemment des applications de numéro gratuit typiques, et ce qu'il ne fait pas encore. Une comparaison honnête.",
    },
    en: {
      title: "Compare MIMT with free-number apps",
      description: "What MIMT does differently from typical free-number apps, and what it doesn't do yet. An honest comparison.",
    },
  },
  soon: {
    fr: {
      title: "Bientôt : Internet et cellulaire",
      description: "Internet résidentiel, cellulaire et téléphone maison MIMT : en préparation, sans date ni prix annoncés. Inscrivez-vous pour être avisé.",
    },
    en: {
      title: "Coming soon: internet and mobile",
      description: "MIMT home internet, mobile and home phone: in preparation, with no date or price announced. Sign up to be notified.",
    },
  },
  e911: {
    fr: {
      title: "9-1-1 : limites du service par Internet",
      description: "Comment fonctionne le 9-1-1 avec MIMT, un service de téléphonie par Internet nomade, et quand il peut ne pas fonctionner. À lire avant d'utiliser MIMT.",
    },
    en: {
      title: "9-1-1: limits of internet phone service",
      description: "How 9-1-1 works with MIMT, a nomadic internet phone service, and when it may not work. Read this before using MIMT.",
    },
  },
  help: {
    fr: {
      title: "Aide et questions fréquentes",
      description: "Réponses courtes sur MIMT Mobile, MIMT Affaires, l'IA, les prix, le 9-1-1, la confidentialité et les plaintes.",
    },
    en: {
      title: "Help and frequently asked questions",
      description: "Short answers about MIMT Mobile, MIMT Business, AI, pricing, 9-1-1, privacy and complaints.",
    },
  },
  complaints: {
    fr: {
      title: "Plaintes et CPRST",
      description: "Comment déposer une plainte chez MIMT et vous adresser à la Commission des plaintes relatives aux services de télécom-télévision (CPRST).",
    },
    en: {
      title: "Complaints and the CCTS",
      description: "How to file a complaint with MIMT and reach the Commission for Complaints for Telecom-television Services (CCTS).",
    },
  },
  privacy: {
    fr: {
      title: "Politique de confidentialité",
      description: "Renseignements recueillis, consentement au traitement par l'IA, lieu des données et vos droits (Loi 25, LPRPDE).",
    },
    en: {
      title: "Privacy policy",
      description: "Information we collect, consent to AI processing, where data is kept and your rights (Québec Law 25, PIPEDA).",
    },
  },
  terms: {
    fr: { title: "Conditions d'utilisation", description: "Les conditions du service MIMT, en français d'abord : service, 9-1-1, forfaits, IA, enregistrement, plaintes." },
    en: { title: "Terms of service", description: "MIMT service terms, French version first: service, 9-1-1, plans, AI, recording, complaints." },
  },
  accessibility: {
    fr: { title: "Accessibilité", description: "Notre engagement en accessibilité, les services de relais et comment demander un format adapté." },
    en: { title: "Accessibility", description: "Our accessibility commitment, relay services and how to ask for an alternative format." },
  },
  contact: {
    fr: { title: "Nous joindre", description: "Écrivez à l'équipe MIMT en français ou en anglais : questions, démo MIMT Affaires, presse ou plainte." },
    en: { title: "Contact us", description: "Write to the MIMT team in French or English: questions, MIMT Business demo, press or complaint." },
  },
};

/** Next.js metadata (canonical, hreflang fr-CA/en-CA, Open Graph, Twitter) for one page. */
export function metadataFor(lang: Lang, key: RouteKey): Metadata {
  const m = PAGE_META[key][lang];
  return pageMeta(lang, key, m.title, m.description);
}
