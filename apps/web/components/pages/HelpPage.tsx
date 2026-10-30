import { PageHero, Shell } from "@/components/Shell";
import { FaqList } from "@/components/FaqList";
import { FAQ_TOPICS, faqItems, type FaqTopic } from "@/lib/faq";
import { GUIDES, guidePath } from "@/lib/guides";
import { faqPageLd } from "@/lib/seo";
import { CONTACT_EMAIL, href, type Lang } from "@/lib/site";

const ORDER: FaqTopic[] = ["general", "mobile", "business", "ai", "legal"];

export function HelpPage({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  const items = faqItems(lang);
  return (
    <Shell lang={lang} page="help" ld={[faqPageLd(lang, items)]}>
      <PageHero
        eyebrow={fr ? "Aide" : "Help"}
        title={fr ? "Questions fréquentes" : "Frequently asked questions"}
        lead={fr ? "Des réponses courtes et honnêtes." : "Short, honest answers."}
      />
      <section className="section">
        <div className="container prose">
          <nav aria-label={fr ? "Sujets" : "Topics"}>
            <ul className="link-list">
              {ORDER.map((t) => (
                <li key={t}>
                  <a href={`#${t}`}>{FAQ_TOPICS[t][lang]}</a>
                </li>
              ))}
              <li>
                <a href="#guides">{fr ? "Guides pratiques" : "Practical guides"}</a>
              </li>
            </ul>
          </nav>
          {ORDER.map((t) => (
            <section key={t} className="faq-group" aria-labelledby={t}>
              <h2 id={t}>{FAQ_TOPICS[t][lang]}</h2>
              <FaqList lang={lang} items={items.filter((i) => i.topic === t)} />
            </section>
          ))}
          <section className="faq-group" aria-labelledby="guides">
            <h2 id="guides">{fr ? "Guides pratiques" : "Practical guides"}</h2>
            <p>
              {fr
                ? "Pour aller plus loin que les questions fréquentes, nos guides expliquent en détail les sujets qui reviennent souvent, avec leurs sources officielles."
                : "To go further than the FAQ, our guides explain common topics in detail, with their official sources."}
            </p>
            <ul>
              {GUIDES.map((g) => (
                <li key={g.id}>
                  <a href={guidePath(g, lang)}>{g.copy(lang).h1}</a>
                </li>
              ))}
            </ul>
          </section>
          <p className="mt-l">
            {fr ? "Vous ne trouvez pas votre réponse? " : "Can't find your answer? "}
            <a href={href(lang, "contact")}>{fr ? "Écrivez-nous" : "Write to us"}</a> ({CONTACT_EMAIL}).
          </p>
        </div>
      </section>
    </Shell>
  );
}
