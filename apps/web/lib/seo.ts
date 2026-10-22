// schema.org JSON-LD builders. Every fact comes from the repo: prices from @mimt/shared, contact from site.ts.
// No LocalBusiness: the repo has no street address for MIMT (only "Montréal, Québec"), so none is invented
// (scripts/verify-out.mjs enforces it). Local pages target their city with Service.areaServed instead.

import { PLANS, type PlanCode } from "@mimt/shared";
import { APP_URL, CONTACT_EMAIL, LABELS, ROUTES, SITE_URL, type Lang, type RouteKey } from "./site.ts";
import type { FaqItem } from "./faq.ts";

export type JsonLdObject = Record<string, unknown>;

const inLanguage = (lang: Lang) => (lang === "fr" ? "fr-CA" : "en-CA");
export const ORG_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;
const abs = (path: string) => SITE_URL + path;

export function organizationLd(lang: Lang): JsonLdObject {
  const fr = lang === "fr";
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: "MIMT",
    alternateName: "Mobile Innovation Modern Telecommunications",
    url: abs("/"),
    logo: abs("/favicon.svg"),
    image: abs("/og.png"),
    email: CONTACT_EMAIL,
    description: fr
      ? "Service de téléphonie par Internet conçu à Montréal, en français d'abord : un numéro canadien dans une app (MIMT Mobile) et un système téléphonique d'entreprise par ligne (MIMT Affaires)."
      : "Internet phone service built in Montréal, French first: a Canadian number in an app (MIMT Mobile) and a per-line business phone system (MIMT Business).",
    address: { "@type": "PostalAddress", addressLocality: "Montréal", addressRegion: "QC", addressCountry: "CA" },
    areaServed: { "@type": "Country", name: "Canada" },
    knowsLanguage: ["fr-CA", "en-CA"],
    parentOrganization: { "@type": "Organization", name: "GROUPE TAKATAK", url: "https://takatak.ca" },
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "customer service",
        email: CONTACT_EMAIL,
        availableLanguage: ["French", "English"],
        areaServed: "CA",
      },
    ],
  };
}

export function websiteLd(lang: Lang): JsonLdObject {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: abs("/"),
    name: "MIMT",
    inLanguage: ["fr-CA", "en-CA"],
    publisher: { "@id": ORG_ID },
    description:
      lang === "fr"
        ? "Votre numéro canadien, partout. Téléphonie par Internet pour particuliers et entreprises."
        : "Your Canadian number, anywhere. Internet phone service for people and businesses.",
  };
}

export function webPageLd(lang: Lang, key: RouteKey, name: string, description: string): JsonLdObject {
  return {
    "@type": "WebPage",
    "@id": `${abs(ROUTES[key][lang])}#webpage`,
    url: abs(ROUTES[key][lang]),
    name,
    description,
    inLanguage: inLanguage(lang),
    isPartOf: { "@id": WEBSITE_ID },
    publisher: { "@id": ORG_ID },
  };
}

export function breadcrumbLd(lang: Lang, key: RouteKey): JsonLdObject | null {
  if (key === "home") return null;
  return {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "MIMT", item: abs(ROUTES.home[lang]) },
      { "@type": "ListItem", position: 2, name: LABELS[key][lang], item: abs(ROUTES[key][lang]) },
    ],
  };
}

/** One Offer per plan. Prices: CAD before taxes, straight from PLANS. */
export function planOfferLd(code: PlanCode, lang: Lang): JsonLdObject {
  const fr = lang === "fr";
  const p = PLANS[code];
  const price = (p.monthlyPriceCents / 100).toFixed(2);
  const page = p.perLine ? ROUTES.business[lang] : ROUTES.plans[lang];
  const specs: JsonLdObject[] = [
    {
      "@type": "UnitPriceSpecification",
      price,
      priceCurrency: "CAD",
      valueAddedTaxIncluded: false,
      unitCode: "MON",
      unitText: p.perLine ? (fr ? "par ligne par mois" : "per line per month") : fr ? "par mois" : "per month",
    },
  ];
  if (p.yearlyPriceCents) {
    specs.push({
      "@type": "UnitPriceSpecification",
      price: (p.yearlyPriceCents / 100).toFixed(2),
      priceCurrency: "CAD",
      valueAddedTaxIncluded: false,
      unitCode: "ANN",
      unitText: fr ? "par an" : "per year",
    });
  }
  return {
    "@type": "Offer",
    name: p.name[lang],
    url: `${abs(page)}#plan-${code}`,
    price,
    priceCurrency: "CAD",
    priceSpecification: specs,
    eligibleRegion: { "@type": "Country", name: "Canada" },
    description: fr
      ? "Prix proposé pour le lancement, avant taxes (TPS/TVQ) et taxe municipale 9-1-1 du Québec."
      : "Proposed launch price, before taxes (GST/QST) and the Québec 9-1-1 municipal tax.",
    seller: { "@id": ORG_ID },
  };
}

export function serviceLd(lang: Lang, line: "mobile" | "business"): JsonLdObject {
  const fr = lang === "fr";
  const codes: PlanCode[] = line === "mobile" ? ["free", "lock", "premium"] : ["business", "business_pro"];
  const route = line === "mobile" ? ROUTES.plans[lang] : ROUTES.business[lang];
  return {
    "@type": "Service",
    "@id": `${abs(route)}#service`,
    name: line === "mobile" ? "MIMT Mobile" : fr ? "MIMT Affaires" : "MIMT Business",
    serviceType: line === "mobile" ? (fr ? "Téléphonie par Internet (VoIP)" : "Internet phone service (VoIP)") : fr ? "Système téléphonique d'entreprise infonuagique" : "Cloud business phone system",
    description:
      line === "mobile"
        ? fr
          ? "Un vrai numéro canadien dans une app pour appeler et texter par Wi‑Fi ou données mobiles, avec messagerie vocale et 9-1-1 avec adresse enregistrée."
          : "A real Canadian number in an app to call and text over Wi‑Fi or mobile data, with voicemail and 9-1-1 with a registered address."
        : fr
          ? "Téléphonie d'affaires par ligne : postes, réceptionniste automatique bilingue, groupes de sonnerie, heures d'ouverture et jours fériés du Québec, enregistrement des appels avec avis, réceptionniste IA."
          : "Per-line business phone: extensions, bilingual auto-attendant, ring groups, business hours and Québec holidays, call recording with notice, AI receptionist.",
    provider: { "@id": ORG_ID },
    areaServed: { "@type": "Country", name: "Canada" },
    availableLanguage: ["fr-CA", "en-CA"],
    url: abs(route),
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: line === "mobile" ? (fr ? "Forfaits MIMT Mobile" : "MIMT Mobile plans") : fr ? "Forfaits MIMT Affaires" : "MIMT Business plans",
      itemListElement: codes.map((c) => planOfferLd(c, lang)),
    },
  };
}

export function faqPageLd(lang: Lang, items: FaqItem[], page: RouteKey = "help"): JsonLdObject {
  return {
    "@type": "FAQPage",
    "@id": `${abs(ROUTES[page][lang])}#faq`,
    inLanguage: inLanguage(lang),
    mainEntity: items.map((i) => ({
      "@type": "Question",
      name: i.q,
      acceptedAnswer: { "@type": "Answer", text: i.a },
    })),
  };
}

/**
 * The MIMT app (web app today; iPhone and Android apps announced, not published). Offers come from
 * PLANS. No aggregateRating / review: MIMT has no published ratings, and none is ever invented.
 */
export function softwareApplicationLd(lang: Lang): JsonLdObject {
  const fr = lang === "fr";
  const codes: PlanCode[] = ["free", "lock", "premium"];
  return {
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#app`,
    name: "MIMT",
    applicationCategory: "CommunicationApplication",
    applicationSubCategory: fr ? "Téléphonie par Internet (VoIP)" : "Internet phone (VoIP)",
    operatingSystem: fr ? "Navigateur Web (iOS et Android : bientôt)" : "Web browser (iOS and Android: coming soon)",
    url: APP_URL,
    installUrl: APP_URL,
    inLanguage: ["fr-CA", "en-CA"],
    description: fr
      ? "Un numéro de téléphone canadien dans une app : appels et textos par Wi‑Fi ou données, messagerie vocale, transfert de numéro sans frais MIMT."
      : "A Canadian phone number in an app: calls and texts over Wi‑Fi or data, voicemail, number transfer with no MIMT fee.",
    publisher: { "@id": ORG_ID },
    offers: codes.map((c) => planOfferLd(c, lang)),
  };
}

/** Service node for a landing page: the product the page sells, with its offers and where it is served. */
export function landingServiceLd(lang: Lang, key: RouteKey, opts: { name: string; description: string; business: boolean; city?: string }): JsonLdObject {
  const codes: PlanCode[] = opts.business ? ["business", "business_pro"] : ["lock", "premium"];
  return {
    "@type": "Service",
    "@id": `${abs(ROUTES[key][lang])}#service`,
    name: opts.name,
    description: opts.description,
    serviceType: opts.business ? (lang === "fr" ? "Téléphonie IP d'affaires" : "Business VoIP") : lang === "fr" ? "Numéro de téléphone virtuel" : "Virtual phone number",
    provider: { "@id": ORG_ID },
    areaServed: opts.city ? { "@type": "City", name: opts.city } : { "@type": "Country", name: "Canada" },
    availableLanguage: ["fr-CA", "en-CA"],
    url: abs(ROUTES[key][lang]),
    offers: codes.map((c) => planOfferLd(c, lang)),
  };
}

/** Wraps several nodes in one @graph document. */
export function graph(nodes: (JsonLdObject | null | undefined)[]): JsonLdObject {
  return { "@context": "https://schema.org", "@graph": nodes.filter(Boolean) };
}

/** JSON for a <script type="application/ld+json">: "<" escaped so text can never close the script tag. */
export function jsonLdString(data: JsonLdObject): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
