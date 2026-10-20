import type { Metadata } from "next";

export type Lang = "fr" | "en";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://mimt.ca").replace(/\/$/, "");
export const CONTACT_EMAIL = "info@mimt.ca";
export const CCTS_URL = "https://www.ccts-cprst.ca";
/** The MIMT web app (softphone + business admin portal), apps/webphone. */
export const APP_URL = "https://app.mimt.ca";
/** MIMT API (public number search and holds; everything else goes through the app). */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "https://api.mimt.ca").replace(/\/$/, "");
/** Shown wherever the docs leave a legal or business fact blank. Never replace it with a guess. */
export const TBC = { fr: "[À confirmer par MIMT]", en: "[To be confirmed by MIMT]" } as const;

/** Every page, with its French and English path (trailing slash: static export writes folders). */
export const ROUTES = {
  home: { fr: "/", en: "/en/" },
  plans: { fr: "/forfaits/", en: "/en/plans/" },
  business: { fr: "/affaires/", en: "/en/business/" },
  ai: { fr: "/ia/", en: "/en/ai/" },
  webapp: { fr: "/app-web/", en: "/en/web-app/" },
  compare: { fr: "/comparer/", en: "/en/compare/" },
  soon: { fr: "/bientot/", en: "/en/coming-soon/" },
  e911: { fr: "/9-1-1/", en: "/en/9-1-1/" },
  help: { fr: "/aide/", en: "/en/help/" },
  complaints: { fr: "/plaintes/", en: "/en/complaints/" },
  privacy: { fr: "/confidentialite/", en: "/en/privacy/" },
  terms: { fr: "/conditions/", en: "/en/terms/" },
  accessibility: { fr: "/accessibilite/", en: "/en/accessibility/" },
  contact: { fr: "/contact/", en: "/en/contact/" },
  about: { fr: "/a-propos/", en: "/en/about/" },
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
  soon: { fr: "Bientôt", en: "Coming soon" },
  e911: { fr: "9-1-1", en: "9-1-1" },
  help: { fr: "Aide", en: "Help" },
  complaints: { fr: "Plaintes", en: "Complaints" },
  privacy: { fr: "Confidentialité", en: "Privacy" },
  terms: { fr: "Conditions", en: "Terms" },
  accessibility: { fr: "Accessibilité", en: "Accessibility" },
  contact: { fr: "Contact", en: "Contact" },
  about: { fr: "À propos", en: "About" },
};

export const MAIN_NAV: RouteKey[] = ["plans", "business", "ai", "soon", "help", "contact"];

/** Per-page metadata with canonical, hreflang (fr-CA / en-CA) and Open Graph. */
// The image is in French (French first); the alt text describes it as it is.
const OG_ALT = "MIMT par GROUPE TAKATAK : Votre numéro canadien, partout. MIMT Mobile, MIMT Affaires, fait au Québec.";

/** Pages with their own Open Graph card (public/og/<key>-<lang>.png, scripts/og-cards.mjs). Others use /og.png. */
export const OG_PAGES: readonly RouteKey[] = ["home", "plans", "business", "ai", "webapp", "compare", "soon", "help"];

export function ogImage(lang: Lang, key: RouteKey): string {
  return OG_PAGES.includes(key) ? `/og/${key}-${lang}.png` : "/og.png";
}

export function pageMeta(lang: Lang, key: RouteKey, title: string, description: string): Metadata {
  const url = SITE_URL + ROUTES[key][lang];
  const image = ogImage(lang, key);
  const alt = OG_PAGES.includes(key) ? `MIMT : ${title}` : OG_ALT;
  const fullTitle = key === "home" ? title : `${title} | MIMT`;
  return {
    metadataBase: new URL(SITE_URL),
    title: fullTitle,
    description,
    alternates: {
      canonical: url,
      languages: {
        "fr-CA": SITE_URL + ROUTES[key].fr,
        "en-CA": SITE_URL + ROUTES[key].en,
        "x-default": SITE_URL + ROUTES[key].fr,
      },
    },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      siteName: "MIMT",
      title: fullTitle,
      description,
      url,
      locale: lang === "fr" ? "fr_CA" : "en_CA",
      alternateLocale: lang === "fr" ? "en_CA" : "fr_CA",
      images: [{ url: image, width: 1200, height: 630, alt }],
    },
    twitter: { card: "summary_large_image", title: fullTitle, description, images: [{ url: image, alt }] },
    icons: { icon: "/favicon.svg" },
  };
}
