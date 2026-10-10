import { PageHero, Shell } from "@/components/Shell";
import { FaqList } from "@/components/FaqList";
import { FAQ_TOPICS, faqItems, type FaqTopic } from "@/lib/faq";
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
            </ul>
          </nav>
          {ORDER.map((t) => (
            <section key={t} className="faq-group" aria-labelledby={t}>
              <h2 id={t}>{FAQ_TOPICS[t][lang]}</h2>
              <FaqList lang={lang} items={items.filter((i) => i.topic === t)} />
            </section>
          ))}
          <p className="mt-l">
            {fr ? "Vous ne trouvez pas votre réponse? " : "Can't find your answer? "}
            <a href={href(lang, "contact")}>{fr ? "Écrivez-nous" : "Write to us"}</a> ({CONTACT_EMAIL}).
          </p>
        </div>
      </section>
    </Shell>
  );
}
