import type { Metadata } from "next";

export type Lang = "fr" | "en";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://mimt.ca").replace(/\/$/, "");
export const CONTACT_EMAIL = "info@mimt.ca";
export const CCTS_URL = "https://www.ccts-cprst.ca";
/** The MIMT web app (softphone + business admin portal), apps/webphone. */
export const APP_URL = "https://app.mimt.ca";
/** MIMT API (public number search and holds; everything else goes through the app). */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "https://api.mimt.ca").replace(/\/$/, "");
/**
 * Company facts the owner has not given yet. Pages render a line only when its value is not null, and never a
 * placeholder: write sentences that read well without them. Never fill one with a guess.
 */
export interface CompanyFacts {
  /** Raison sociale of the entity that operates MIMT. */
  legalName: string | null;
  /** Postal address (one line). */
  address: string | null;
  /** Business phone number, as it should be dialled (e.g. "+1 514 555 0100"). */
  phone: string | null;
  /** Founding date or year, as it should be shown. */
  founded: string | null;
  /** Name of GROUPE TAKATAK's president, if the owner wants it published. */
  president: string | null;
}

/**
 * Operator of MIMT, from the Registraire des entreprises du Québec (REQ, consulted 2026-10-30; owner: « même que
 * Quadro Holdings Ltée », 2026-10-31). Phone: MIMT's main line in Twilio (owner, 2026-10-31). President stays null until the owner says otherwise.
 */
export const COMPANY: CompanyFacts = {
  legalName: "Quadro Holdings Ltée (NEQ 1176760537)",
  address: "5837, rue Jean-Talon Est, Montréal (Québec) H1S 1M4",
  phone: "+1 579 999-6789",
  founded: "2021-07-15",
  president: null,
};

/** Law 25 « responsable de la protection des renseignements personnels »: the president of GROUPE TAKATAK. */
export const PRIVACY_OFFICER = {
  fr: "le président de GROUPE TAKATAK",
  en: "the president of GROUPE TAKATAK",
} as const;

/** Date shown as « Dernière mise à jour » on the privacy policy, the terms and the 9-1-1 notice. */
export const LEGAL_UPDATED = { iso: "2026-10-30", fr: "30 octobre 2026", en: "October 30, 2026" } as const;

/** Every page, with its French and English path (trailing slash: static export writes folders). */
export const ROUTES = {
  home: { fr: "/", en: "/en/" },
  plans: { fr: "/forfaits/", en: "/en/plans/" },
  business: { fr: "/affaires/", en: "/en/business/" },
  ai: { fr: "/ia/", en: "/en/ai/" },
  webapp: { fr: "/app-web/", en: "/en/web-app/" },
  compare: { fr: "/comparer/", en: "/en/compare/" },
  e911: { fr: "/9-1-1/", en: "/en/9-1-1/" },
  help: { fr: "/aide/", en: "/en/help/" },
  complaints: { fr: "/plaintes/", en: "/en/complaints/" },
  privacy: { fr: "/confidentialite/", en: "/en/privacy/" },
  terms: { fr: "/conditions/", en: "/en/terms/" },
  accessibility: { fr: "/accessibilite/", en: "/en/accessibility/" },
  contact: { fr: "/contact/", en: "/en/contact/" },
  about: { fr: "/a-propos/", en: "/en/about/" },
  rewards: { fr: "/recompenses/", en: "/en/rewards/" },
  affiliates: { fr: "/affilies/", en: "/en/affiliates/" },
  cityMontreal: { fr: "/numero-virtuel-montreal/", en: "/en/virtual-number-montreal/" },
  cityQuebec: { fr: "/numero-virtuel-quebec/", en: "/en/virtual-number-quebec-city/" },
  cityLaval: { fr: "/numero-virtuel-laval/", en: "/en/virtual-number-laval/" },
  cityGatineau: { fr: "/numero-virtuel-gatineau/", en: "/en/virtual-number-gatineau/" },
  cityToronto: { fr: "/numero-virtuel-toronto/", en: "/en/virtual-number-toronto/" },
  useVirtual: { fr: "/numero-virtuel/", en: "/en/virtual-phone-number/" },
  useSecond: { fr: "/deuxieme-numero/", en: "/en/second-phone-number/" },
  useVoip: { fr: "/telephonie-ip-affaires/", en: "/en/business-voip/" },
  guides: { fr: "/guides/", en: "/en/guides/" },
} as const;

export type RouteKey = keyof typeof ROUTES;

export function href(lang: Lang, key: RouteKey, hash?: string): string {
  return ROUTES[key][lang] + (hash ? `#${hash}` : "");
}

export const LABELS: Record<RouteKey, { fr: string; en: string }> = {
  home: { fr: "Accueil", en: "Home" },
  plans: { fr: "Forfaits", en: "Plans" },
  business: { fr: "Affaires", en: "Business" },
  ai: { fr: "IA", en: "AI" },
  webapp: { fr: "App Web", en: "Web app" },
  compare: { fr: "Comparer", en: "Compare" },
  e911: { fr: "9-1-1", en: "9-1-1" },
  help: { fr: "Aide", en: "Help" },
  complaints: { fr: "Plaintes", en: "Complaints" },
  privacy: { fr: "Confidentialité", en: "Privacy" },
  terms: { fr: "Conditions", en: "Terms" },
  accessibility: { fr: "Accessibilité", en: "Accessibility" },
  contact: { fr: "Contact", en: "Contact" },
  about: { fr: "À propos", en: "About" },
  rewards: { fr: "Récompenses", en: "Rewards" },
  affiliates: { fr: "Agents affiliés", en: "Affiliate agents" },
  cityMontreal: { fr: "Montréal", en: "Montréal" },
  cityQuebec: { fr: "Québec", en: "Québec City" },
  cityLaval: { fr: "Laval", en: "Laval" },
  cityGatineau: { fr: "Gatineau", en: "Gatineau" },
  cityToronto: { fr: "Toronto", en: "Toronto" },
  useVirtual: { fr: "Numéro virtuel", en: "Virtual number" },
  useSecond: { fr: "Deuxième numéro", en: "Second number" },
  useVoip: { fr: "Téléphonie IP d'affaires", en: "Business VoIP" },
  guides: { fr: "Guides", en: "Guides" },
};

export const MAIN_NAV: RouteKey[] = ["plans", "business", "ai", "guides", "help", "contact"];
/** Nav items shown on the desktop bar only on wide screens (always in the mobile menu), so the bar never wraps. */
export const WIDE_ONLY_NAV: RouteKey[] = [];

/** Per-page metadata with canonical, hreflang (fr-CA / en-CA) and Open Graph. */
// The image is in French (French first); the alt text describes it as it is.
const OG_ALT = "MIMT par GROUPE TAKATAK : Votre numéro canadien, partout. MIMT Mobile, MIMT Affaires, fait au Québec.";

/** Pages with their own Open Graph card (public/og/<key>-<lang>.png, scripts/og-cards.mjs). Others use /og.png. */
export const OG_PAGES: readonly RouteKey[] = ["home", "plans", "business", "ai", "webapp", "compare", "help"];

export function ogImage(lang: Lang, key: RouteKey): string {
  return OG_PAGES.includes(key) ? `/og/${key}-${lang}.png` : "/og.png";
}

export function pageMeta(lang: Lang, key: RouteKey, title: string, description: string): Metadata {
  const image = ogImage(lang, key);
  const alt = OG_PAGES.includes(key) ? `MIMT : ${title}` : OG_ALT;
  const fullTitle = key === "home" ? title : `${title} | MIMT`;
  return pathMeta(lang, ROUTES[key], fullTitle, description, { url: image, alt }, "website");
}

/** Same as pageMeta for a page outside ROUTES (a guide article): its own French and English paths. */
export function pathMeta(
  lang: Lang,
  paths: Record<Lang, string>,
  fullTitle: string,
  description: string,
  image: { url: string; alt: string } = { url: "/og.png", alt: OG_ALT },
  type: "website" | "article" = "website",
): Metadata {
  const url = SITE_URL + paths[lang];
  return {
    metadataBase: new URL(SITE_URL),
    title: fullTitle,
    description,
    alternates: {
      canonical: url,
      languages: {
        "fr-CA": SITE_URL + paths.fr,
        "en-CA": SITE_URL + paths.en,
        "x-default": SITE_URL + paths.fr,
      },
    },
    robots: { index: true, follow: true },
    openGraph: {
      type,
      siteName: "MIMT",
      title: fullTitle,
      description,
      url,
      locale: lang === "fr" ? "fr_CA" : "en_CA",
      alternateLocale: lang === "fr" ? "en_CA" : "fr_CA",
      images: [{ url: image.url, width: 1200, height: 630, alt: image.alt }],
    },
    twitter: { card: "summary_large_image", title: fullTitle, description, images: [{ url: image.url, alt: image.alt }] },
    icons: { icon: "/favicon.svg" },
  };
}
