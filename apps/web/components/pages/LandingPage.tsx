import { PageHero, Shell } from "@/components/Shell";
import { FaqList } from "@/components/FaqList";
import { cityName, isCity, landingCopy, type LandingKey } from "@/lib/landing";
import { PAGE_META } from "@/lib/meta";
import { faqPageLd, landingServiceLd } from "@/lib/seo";
import { LABELS, href, type Lang } from "@/lib/site";

/** Real photograph for each landing page (public/photos/CREDITS.md). */
function landingPhoto(page: LandingKey, fr: boolean): { name: string; alt: string } {
  if (page === "useVoip") return { name: "commerce-cafe", alt: fr ? "Un propriétaire de café au téléphone derrière son comptoir" : "A café owner on the phone behind his counter" };
  if (page === "useSecond") return { name: "studio-design", alt: fr ? "Une designer au téléphone dans son atelier" : "A designer on the phone in her studio" };
  if (page === "useVirtual") return { name: "artisan-atelier", alt: fr ? "Un artisan content regarde son téléphone dans son atelier" : "A happy craftsman looks at his phone in his workshop" };
  return { name: "hero-cafe", alt: fr ? "Une femme sourit en lisant un texto dans un café" : "A woman smiles as she reads a text in a café" };
}

/** Local (city) and use-case landing pages. One clear action: get a number with the live picker. */
export function LandingPage({ lang, page }: { lang: Lang; page: LandingKey }) {
  const fr = lang === "fr";
  const c = landingCopy(page, lang);
  const city = isCity(page) ? cityName(page, lang) : undefined;
  const business = page === "useVoip";
  const meta = PAGE_META[page][lang];
  const ld = [
    landingServiceLd(lang, page, { name: c.h1, description: meta.description, business, ...(city ? { city } : {}) }),
    faqPageLd(lang, c.faq, page),
  ];
  const cta = business ? href(lang, "business", "numero") : href(lang, "home", "numero");
  const button = (
    <p className="landing__cta">
      <a className="btn btn--primary btn--lg" href={cta}>
        {fr ? "Obtenir mon numéro" : "Get my number"}
      </a>
    </p>
  );
  return (
    <Shell lang={lang} page={page} ld={ld}>
      <PageHero eyebrow={c.eyebrow} title={c.h1} lead={c.lead} photo={landingPhoto(page, fr)} />
      <section className="section">
        <div className="container prose">
          {button}
          {c.sections.map((s) => (
            <section key={s.h2}>
              <h2>{s.h2}</h2>
              <p>{s.p}</p>
            </section>
          ))}
          <h2>{fr ? "Questions fréquentes" : "Frequently asked questions"}</h2>
          <FaqList lang={lang} items={c.faq} />
          <p className="landing__links">
            {c.related.map((r, i) => (
              <span key={r}>
                {i ? " · " : ""}
                <a href={href(lang, r)}>{LABELS[r][lang]}</a>
              </span>
            ))}
          </p>
          {button}
        </div>
      </section>
    </Shell>
  );
}
