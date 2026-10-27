import type { ReactNode } from "react";
import { ConsentBanner, ConsentLink } from "@/components/ConsentBanner";
import { AiLauncher } from "@/components/AiLauncher";
import { DownloadPrompt } from "@/components/DownloadPrompt";
import { OfferTicker } from "@/components/OfferTicker";
import { PromoModal } from "@/components/PromoModal";
import { SiteEffects } from "@/components/SiteEffects";
import { PAGE_META } from "@/lib/meta";
import { breadcrumbLd, graph, jsonLdString, organizationLd, webPageLd, websiteLd, type JsonLdObject } from "@/lib/seo";
import { APP_URL, CCTS_URL, LABELS, MAIN_NAV, ROUTES, href, type Lang, type RouteKey } from "@/lib/site";

/** schema.org data for search engines and AI assistants. */
export function JsonLd({ data }: { data: JsonLdObject }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}

function Wordmark({ lang }: { lang: Lang }) {
  return (
    <a className="wordmark" href={href(lang, "home")} aria-label={lang === "fr" ? "MIMT, accueil" : "MIMT, home"}>
      <span className="wordmark__name" aria-hidden="true">
        MIMT
      </span>
      <span className="wordmark__by" aria-hidden="true">
        {lang === "fr" ? "par GROUPE TAKATAK" : "by GROUPE TAKATAK"}
      </span>
    </a>
  );
}

function LangSwitch({ lang, page }: { lang: Lang; page: RouteKey }) {
  const other: Lang = lang === "fr" ? "en" : "fr";
  return (
    <a
      className="langswitch"
      href={ROUTES[page][other]}
      hrefLang={other === "fr" ? "fr-CA" : "en-CA"}
      lang={other === "fr" ? "fr-CA" : "en-CA"}
    >
      <span aria-hidden="true">{other.toUpperCase()}</span>
      <span className="sr-only">{other === "fr" ? "Version française" : "English version"}</span>
    </a>
  );
}

function NavLinks({ lang, page }: { lang: Lang; page: RouteKey }) {
  return (
    <ul>
      {MAIN_NAV.map((key) => (
        <li key={key}>
          <a href={href(lang, key)} aria-current={key === page ? "page" : undefined}>
            {LABELS[key][lang]}
          </a>
        </li>
      ))}
    </ul>
  );
}

function Header({ lang, page }: { lang: Lang; page: RouteKey }) {
  const fr = lang === "fr";
  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Wordmark lang={lang} />
        <nav className="nav-desktop" aria-label={fr ? "Navigation principale" : "Main navigation"}>
          <NavLinks lang={lang} page={page} />
        </nav>
        <div className="site-header__actions">
          <LangSwitch lang={lang} page={page} />
          <a className="btn btn--primary btn--sm hide-sm" href={href(lang, "home", "numero")}>
            {fr ? "Obtenir mon numéro" : "Get my number"}
          </a>
          <details className="nav-mobile">
            <summary aria-label={fr ? "Menu" : "Menu"}>
              <span className="burger" aria-hidden="true" />
              <span className="nav-mobile__label">Menu</span>
            </summary>
            <nav aria-label={fr ? "Navigation mobile" : "Mobile navigation"}>
              <NavLinks lang={lang} page={page} />
              <a className="btn btn--primary" href={APP_URL} rel="noopener">
                {fr ? "Essayer l'app Web" : "Try the web app"}
              </a>
              <a className="btn btn--outline-light" href={href(lang, "webapp")} data-download="">
                {fr ? "Télécharger l'app" : "Get the app"}
              </a>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

function Footer({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  const year = new Date().getFullYear();
  const cols: { title: string; keys: RouteKey[] }[] = [
    { title: fr ? "Produits" : "Products", keys: ["home", "business", "ai", "webapp", "plans", "compare", "soon"] },
    { title: fr ? "Numéros" : "Numbers", keys: ["useVirtual", "useSecond", "useVoip", "cityMontreal", "cityQuebec", "cityLaval", "cityGatineau", "cityToronto"] },
    { title: fr ? "Soutien" : "Support", keys: ["about", "help", "contact", "complaints"] },
    { title: fr ? "Légal" : "Legal", keys: ["e911", "privacy", "terms", "accessibility"] },
  ];
  const footerLabel = (key: RouteKey): string => {
    if (key === "home") return "MIMT Mobile";
    if (key === "business") return fr ? "MIMT Affaires" : "MIMT Business";
    if (key === "ai") return fr ? "Intelligence artificielle" : "Artificial intelligence";
    if (key === "help") return fr ? "Aide et FAQ" : "Help and FAQ";
    if (key === "e911") return fr ? "Limites du 9-1-1" : "9-1-1 limitations";
    if (key === "privacy") return fr ? "Confidentialité (Loi 25)" : "Privacy (Law 25)";
    return LABELS[key][lang];
  };
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="site-footer__grid">
          <div className="site-footer__brand">
            <Wordmark lang={lang} />
            <p>
              {fr
                ? "Mobile Innovation Modern Telecommunications. Votre numéro canadien, partout."
                : "Mobile Innovation Modern Telecommunications. Your Canadian number, anywhere."}
            </p>
            <p className="site-footer__911">
              {fr ? (
                <>
                  Le 9-1-1 par Internet a des limites. <a href={href(lang, "e911")}>À lire avant d'utiliser MIMT</a>.
                </>
              ) : (
                <>
                  9-1-1 over the internet has limits. <a href={href(lang, "e911")}>Read this before using MIMT</a>.
                </>
              )}
            </p>
          </div>
          {cols.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h2 className="site-footer__title">{col.title}</h2>
              <ul>
                {col.keys.map((key) => (
                  <li key={key}>
                    <a href={href(lang, key)}>{footerLabel(key)}</a>
                  </li>
                ))}
                {col.keys.includes("complaints") ? (
                  <li>
                    <a href={CCTS_URL} rel="noopener">
                      {fr ? "CPRST (plaintes télécom)" : "CCTS (telecom complaints)"}
                    </a>
                  </li>
                ) : null}
                {col.keys.includes("webapp") ? (
                  <li>
                    <a href={APP_URL} rel="noopener">
                      app.mimt.ca
                    </a>
                  </li>
                ) : null}
              </ul>
            </nav>
          ))}
        </div>
        <div className="site-footer__bottom">
          <p>
            {fr ? "Un membre de l'écosystème GROUPE TAKATAK — " : "A member of the GROUPE TAKATAK ecosystem — "}
            <a href="https://takatak.ca" rel="noopener">
              takatak.ca
            </a>
            <span className="site-footer__tagline"> · Digital Solutions. Real Results.</span>
          </p>
          <p>
            © {year} MIMT. {fr ? "Tous droits réservés." : "All rights reserved."} · <ConsentLink lang={lang} />
          </p>
        </div>
      </div>
    </footer>
  );
}

export function Shell({
  lang,
  page,
  children,
  ld = [],
}: {
  lang: Lang;
  page: RouteKey;
  children: ReactNode;
  /** Extra JSON-LD nodes for this page (Service, FAQPage…), added to the site-wide graph. */
  ld?: JsonLdObject[];
}) {
  const meta = PAGE_META[page][lang];
  const data = graph([organizationLd(lang), websiteLd(lang), webPageLd(lang, page, meta.title, meta.description), breadcrumbLd(lang, page), ...ld]);
  return (
    <>
      <JsonLd data={data} />
      <a className="skip-link" href="#contenu">
        {lang === "fr" ? "Aller au contenu" : "Skip to content"}
      </a>
      <Header lang={lang} page={page} />
      <OfferTicker lang={lang} />
      <main id="contenu" tabIndex={-1}>
        {children}
      </main>
      <Footer lang={lang} />
      <MobileCtaBar lang={lang} />
      {/* The download modal still opens from any data-download button; the one automatic pop-up is the promo. */}
      <DownloadPrompt lang={lang} auto={false} />
      {NO_AUTO_PROMPT.includes(page) ? null : <PromoModal lang={lang} />}
      <AiLauncher lang={lang} />
      <ConsentBanner lang={lang} />
      <SiteEffects />
      <div className="scroll-progress" aria-hidden="true" />
    </>
  );
}

/** Legal and complaint pages never get the automatic promo pop-up. */
const NO_AUTO_PROMPT: RouteKey[] = ["about", "e911", "privacy", "terms", "complaints", "accessibility", "contact"];

/** Sticky call-to-action bar on phones; appears once the page has scrolled (see home.css). */
function MobileCtaBar({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  return (
    <div className="mobile-cta" role="complementary" aria-label={fr ? "Actions rapides" : "Quick actions"}>
      <a className="btn btn--primary btn--sm" href={href(lang, "home", "numero")}>
        {fr ? "Obtenir mon numéro" : "Get my number"}
      </a>
      <a className="btn btn--outline-light btn--sm" href={APP_URL} rel="noopener">
        {fr ? "App Web" : "Web app"}
      </a>
    </div>
  );
}

/** Dark page header used on inner pages. */
export function PageHero({
  eyebrow,
  title,
  lead,
  photo,
}: {
  eyebrow?: string;
  title: string;
  lead?: ReactNode;
  /** A real photograph from public/photos (base name, e.g. "commerce-cafe") and its alt text. */
  photo?: { name: string; alt: string };
}) {
  return (
    <section className={`page-hero${photo ? " page-hero--photo" : ""}`}>
      <div className="hero-glow" aria-hidden="true" />
      <div className="container page-hero__inner">
        <div className="page-hero__copy">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1>{title}</h1>
          {lead ? <p className="lead">{lead}</p> : null}
        </div>
        {photo ? (
          <img
            className="page-hero__photo"
            src={`/photos/${photo.name}-800.webp`}
            srcSet={`/photos/${photo.name}-800.webp 800w, /photos/${photo.name}-1600.webp 1600w`}
            sizes="(min-width: 900px) 460px, 92vw"
            width={1600}
            height={1067}
            alt={photo.alt}
            fetchPriority="high"
          />
        ) : null}
      </div>
    </section>
  );
}
