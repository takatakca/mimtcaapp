import { PageHero, Shell } from "@/components/Shell";
import { GUIDES, guidePath, readingMinutes } from "@/lib/guides";
import { href, type Lang } from "@/lib/site";

/** /guides/: practical articles for people and small businesses in Québec. */
export function GuidesPage({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  return (
    <Shell lang={lang} page="guides">
      <PageHero
        eyebrow={fr ? "Guides pratiques" : "Practical guides"}
        title={fr ? "Guides : numéros, 9-1-1, arnaques et téléphonie d'affaires" : "Guides: numbers, 9-1-1, scams and business phones"}
        lead={
          fr
            ? "Des réponses claires aux questions que l'on se pose sur son numéro de téléphone au Québec. Chaque guide cite ses sources officielles."
            : "Clear answers to the questions people ask about their phone number in Québec. Every guide cites its official sources."
        }
      />
      <section className="section" aria-labelledby="guides-list">
        <div className="container">
          <h2 id="guides-list">{fr ? "Tous les guides" : "All guides"}</h2>
          <ul className="grid grid--3 features">
            {GUIDES.map((g) => {
              const c = g.copy(lang);
              return (
                <li className="card feature guide-card" key={g.id}>
                  <h3>
                    <a href={guidePath(g, lang)}>{c.h1}</a>
                  </h3>
                  <p>{c.summary}</p>
                  <p className="guide-card__meta">
                    {fr ? `Lecture : ${readingMinutes(g, lang)} min` : `${readingMinutes(g, lang)} min read`}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
      <section className="section section--tint" aria-labelledby="guides-how">
        <div className="container prose">
          <h2 id="guides-how">{fr ? "Comment nous écrivons ces guides" : "How we write these guides"}</h2>
          <p>
            {fr
              ? "Ces guides sont rédigés par l'équipe MIMT, à Montréal, en français d'abord. Ils expliquent des règles et des pratiques qui s'appliquent à tous les fournisseurs, pas seulement à MIMT. Quand une règle vient d'un organisme public, nous le nommons et nous donnons le lien vers sa page : le Conseil de la radiodiffusion et des télécommunications canadiennes (CRTC), la Commission des plaintes relatives aux services de télécom-télévision (CPRST), la Commission d'accès à l'information du Québec (CAI) ou le Centre antifraude du Canada."
              : "These guides are written by the MIMT team in Montréal, French first. They explain rules and practices that apply to every provider, not only to MIMT. When a rule comes from a public body, we name it and link to its page: the Canadian Radio-television and Telecommunications Commission (CRTC), the Commission for Complaints for Telecom-television Services (CCTS), Québec's Commission d'accès à l'information (CAI) or the Canadian Anti-Fraud Centre."}
          </p>
          <p>
            {fr
              ? "Chaque guide se termine par une courte section sur ce que fait MIMT, clairement séparée du reste. Les règles changent : la date de dernière révision est indiquée sur chaque guide. Ces guides donnent de l'information générale et ne remplacent pas un avis juridique."
              : "Each guide ends with a short section on what MIMT does, clearly separated from the rest. Rules change: the date of the last review is shown on every guide. These guides give general information and are not legal advice."}
          </p>
          <p>
            {fr ? "Une erreur, un sujet à proposer? " : "Spotted an error, have a topic to suggest? "}
            <a href={href(lang, "contact")}>{fr ? "Écrivez-nous" : "Write to us"}</a>
            {fr ? ". Pour une question sur votre compte, voyez l'" : ". For a question about your account, see the "}
            <a href={href(lang, "help")}>{fr ? "aide" : "help page"}</a>.
          </p>
        </div>
      </section>
    </Shell>
  );
}
