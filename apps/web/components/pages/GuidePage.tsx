import { PageHero, Shell } from "@/components/Shell";
import { RichText } from "@/components/RichText";
import { GUIDES, guidePath, readingMinutes, type Guide } from "@/lib/guides";
import { guideLd } from "@/lib/seo";
import { LABELS, href, type Lang } from "@/lib/site";

function longDate(iso: string, lang: Lang): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/** One guide article (lib/guides.ts). */
export function GuidePage({ lang, guide }: { lang: Lang; guide: Guide }) {
  const fr = lang === "fr";
  const c = guide.copy(lang);
  const paths = { fr: guidePath(guide, "fr"), en: guidePath(guide, "en") };
  const others = GUIDES.filter((g) => g.id !== guide.id);
  return (
    <Shell lang={lang} page="guides" paths={paths} pageLd={guideLd(lang, paths[lang], c.h1, c.description, guide.updated)}>
      <PageHero eyebrow={fr ? "Guide pratique" : "Practical guide"} title={c.h1} lead={c.intro} />
      <section className="section">
        <article className="container prose guide">
          <p className="guide__meta">
            <a href={href(lang, "guides")}>{LABELS.guides[lang]}</a>
            {" · "}
            {fr ? "Révisé le " : "Reviewed "}
            <time dateTime={guide.updated}>{longDate(guide.updated, lang)}</time>
            {" · "}
            {fr ? `Lecture : ${readingMinutes(guide, lang)} min` : `${readingMinutes(guide, lang)} min read`}
          </p>
          {c.body.map((b) => (
            <section key={b.h2}>
              <h2>{b.h2}</h2>
              {b.p?.map((t) => (
                <p key={t.slice(0, 40)}>
                  <RichText text={t} />
                </p>
              ))}
              {b.ul ? (
                <ul>
                  {b.ul.map((t) => (
                    <li key={t.slice(0, 40)}>
                      <RichText text={t} />
                    </li>
                  ))}
                </ul>
              ) : null}
              {b.ol ? (
                <ol>
                  {b.ol.map((t) => (
                    <li key={t.slice(0, 40)}>
                      <RichText text={t} />
                    </li>
                  ))}
                </ol>
              ) : null}
            </section>
          ))}
          <aside className="guide__sources" aria-labelledby="guide-sources">
            <h2 id="guide-sources">{fr ? "Sources officielles" : "Official sources"}</h2>
            <ul>
              {c.sources.map((s) => (
                <li key={s.url + s.label}>
                  <a href={s.url} rel="noopener">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
            <p className="fineprint">
              {fr
                ? "Information générale, à jour à la date de révision indiquée. Elle ne remplace pas un avis juridique; en cas de doute, consultez l'organisme concerné."
                : "General information, current as of the review date shown. It is not legal advice; when in doubt, check with the body concerned."}
            </p>
          </aside>
          <nav className="guide__more" aria-labelledby="guide-more">
            <h2 id="guide-more">{fr ? "Autres guides" : "More guides"}</h2>
            <ul>
              {others.map((g) => (
                <li key={g.id}>
                  <a href={guidePath(g, lang)}>{g.copy(lang).h1}</a>
                </li>
              ))}
            </ul>
            <p>
              {guide.related.map((k, i) => (
                <span key={k}>
                  {i ? " · " : ""}
                  <a href={href(lang, k)}>{LABELS[k][lang]}</a>
                </span>
              ))}
            </p>
          </nav>
        </article>
      </section>
    </Shell>
  );
}
