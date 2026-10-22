import { PageHero, Shell } from "@/components/Shell";
import { INACTIVITY_WARNING_DAYS, PLANS, QUARANTINE_DAYS, formatCad } from "@mimt/shared";
import { href, type Lang } from "@/lib/site";
import rivalData from "@/content/rivals.json";

type Row = { topic: string; mimt: string; typical: string };

// No competitor is named: the right-hand column describes what is common among free-number apps in general.
function rows(lang: Lang): Row[] {
  const fr = lang === "fr";
  const free = PLANS.free.caps;
  const lock = PLANS.lock;
  const premium = PLANS.premium;
  const [w1, w2] = INACTIVITY_WARNING_DAYS;
  return fr
    ? [
        { topic: "Numéro canadien", mimt: "Oui, choisi parmi les indicatifs offerts (Québec d'abord).", typical: "Souvent offert." },
        {
          topic: "Forfait gratuit",
          mimt: `Entre applications MIMT : textos illimités et ${free.onNetMinutes} minutes d'appels par mois. Pas de numéro de téléphone gratuit : le vrai numéro vient avec Essentiel (${formatCad(lock.monthlyPriceCents, lang)}/mois).`,
          typical: "Souvent illimités par Wi‑Fi, avec publicités.",
        },
        {
          topic: "Forfait payant",
          mimt: `Premium ${formatCad(premium.monthlyPriceCents, lang)}/mois : ${premium.caps.outboundMinutes} minutes sortantes, ${premium.caps.inboundMinutes} entrantes et ${premium.caps.messages} textos, sans publicité, transcription, IA.`,
          typical: "Varie : abonnements sans publicité ou forfaits de données, parfois facturés à la semaine.",
        },
        {
          topic: "Garder son numéro",
          mimt: `Le numéro reste à vous tant que le forfait est payé, même sans activité. Après un forfait annulé : avis aux jours ${w1} et ${w2}, puis ${QUARANTINE_DAYS} jours de quarantaine avant réattribution.`,
          typical: "Varie; la règle n'est pas toujours publiée en nombre de jours.",
        },
        { topic: "Langue", mimt: "Français d'abord partout (app, site, conditions, menus vocaux), anglais ensuite.", typical: "Varie selon l'application." },
        { topic: "Devise et taxes", mimt: "Dollars canadiens; taxes et taxe 9-1-1 du Québec indiquées.", typical: "Parfois en dollars américains." },
        {
          topic: "9-1-1",
          mimt: "Adresse enregistrée avant le premier appel; le 9-1-1 n'est jamais bloqué par le forfait ou le solde.",
          typical: "Varie selon l'application et le pays.",
        },
        {
          topic: "Lieu des données",
          mimt: "Base de données prévue au Canada; Loi 25 du Québec appliquée, transferts évalués.",
          typical: "Varie selon l'application.",
        },
        {
          topic: "Intelligence artificielle",
          mimt: "Facultative, avec consentement distinct : résumés vocaux, réponses suggérées, réceptionniste IA.",
          typical: "Varie.",
        },
        {
          topic: "Téléphonie d'entreprise",
          mimt: `MIMT Affaires : postes, menu bilingue, groupes, jours fériés du Québec, dès ${formatCad(PLANS.business.monthlyPriceCents, lang)}/ligne/mois.`,
          typical: "Parfois offerte séparément.",
        },
        { topic: "Internet et cellulaire", mimt: "Bientôt : exige une entente avec un fournisseur de réseau; aucune date ni aucun prix.", typical: "Parfois offerts, selon le pays." },
      ]
    : [
        { topic: "Canadian number", mimt: "Yes, picked from available area codes (Québec first).", typical: "Often offered." },
        {
          topic: "Free plan",
          mimt: `Between MIMT apps: unlimited texts and ${free.onNetMinutes} minutes of calls per month. No free phone number: the real number comes with Essential (${formatCad(lock.monthlyPriceCents, lang)}/month).`,
          typical: "Often unlimited over Wi‑Fi, with ads.",
        },
        {
          topic: "Paid plan",
          mimt: `Premium ${formatCad(premium.monthlyPriceCents, lang)}/month: ${premium.caps.outboundMinutes} outbound minutes, ${premium.caps.inboundMinutes} inbound and ${premium.caps.messages} texts, no ads, transcription, AI.`,
          typical: "Varies: ad-free subscriptions or data plans, sometimes billed weekly.",
        },
        {
          topic: "Keeping your number",
          mimt: `Your number stays yours as long as the plan is paid, even when inactive. After a cancelled plan: warnings on days ${w1} and ${w2}, then a ${QUARANTINE_DAYS}-day quarantine before reassignment.`,
          typical: "Varies; the rule isn't always published as a number of days.",
        },
        { topic: "Language", mimt: "French first everywhere (app, site, terms, voice menus), English second.", typical: "Varies by app." },
        { topic: "Currency and taxes", mimt: "Canadian dollars; taxes and the Québec 9-1-1 tax shown.", typical: "Sometimes in US dollars." },
        {
          topic: "9-1-1",
          mimt: "Address registered before the first call; 9-1-1 is never blocked by plan or balance.",
          typical: "Varies by app and country.",
        },
        {
          topic: "Where data is kept",
          mimt: "Database planned in Canada; Québec Law 25 applied, transfers assessed.",
          typical: "Varies by app.",
        },
        {
          topic: "Artificial intelligence",
          mimt: "Optional, with separate consent: voicemail summaries, suggested replies, AI receptionist.",
          typical: "Varies.",
        },
        {
          topic: "Business phone",
          mimt: `MIMT Business: extensions, bilingual menu, groups, Québec holidays, from ${formatCad(PLANS.business.monthlyPriceCents, lang)}/line/month.`,
          typical: "Sometimes offered separately.",
        },
        { topic: "Internet and mobile", mimt: "Coming soon: needs an agreement with a network provider; no date or price.", typical: "Sometimes offered, depending on the country." },
      ];
}

export function ComparePage({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  const notYet = fr
    ? [
        "Appels illimités sur le forfait gratuit : non, le forfait gratuit garde une limite pour couvrir les coûts et prévenir la fraude.",
        "Messagerie vocale par courriel, appels conférence et textos de groupe : prévus après le lancement.",
        "Textos internationaux : pas offerts pour le moment.",
        "Internet et cellulaire : bientôt seulement.",
      ]
    : [
        "Unlimited calling on the free plan: no, the free plan keeps a limit to cover costs and prevent fraud.",
        "Voicemail to email, conference calls and group texts: planned after launch.",
        "International texts: not offered for now.",
        "Internet and mobile: coming soon only.",
      ];
  return (
    <Shell lang={lang} page="compare">
      <PageHero
        eyebrow={fr ? "Comparer" : "Compare"}
        title={fr ? "MIMT et les applications de numéro gratuit" : "MIMT and free-number apps"}
        lead={
          fr
            ? "Une comparaison honnête : ce que MIMT fait autrement, et ce qu'il ne fait pas encore. La colonne de droite décrit ce qui est courant dans ce type d'applications, sans viser une entreprise en particulier."
            : "An honest comparison: what MIMT does differently, and what it doesn't do yet. The right-hand column describes what is common in this type of app, without targeting any company."
        }
      />
      <section className="section" aria-labelledby="cmp-title">
        <div className="container">
          <h2 id="cmp-title">{fr ? "Point par point" : "Point by point"}</h2>
          <div className="table-wrap" role="region" aria-labelledby="cmp-title" tabIndex={0}>
            <table className="compare compare--2">
              <caption className="sr-only">
                {fr ? "Comparaison de MIMT avec les applications de numéro gratuit typiques" : "Comparison of MIMT with typical free-number apps"}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{fr ? "Sujet" : "Topic"}</th>
                  <th scope="col">MIMT</th>
                  <th scope="col">{fr ? "Applis de numéro gratuit typiques" : "Typical free-number apps"}</th>
                </tr>
              </thead>
              <tbody>
                {rows(lang).map((r) => (
                  <tr key={r.topic}>
                    <th scope="row">{r.topic}</th>
                    <td>{r.mimt}</td>
                    <td>{r.typical}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="fineprint">
            {fr
              ? "Prix MIMT avant taxes. Les offres des autres applications changent souvent : vérifiez-les sur leur site."
              : "MIMT prices before taxes. Other apps' offers change often: check them on their own sites."}
          </p>
        </div>
      </section>
      <section className="section" aria-labelledby="cmp-named">
        <div className="container prose">
          <h2 id="cmp-named">{rivalData.title[lang]}</h2>
          <p>
            {fr
              ? `Seulement ce que ces entreprises écrivent elles-mêmes sur leur site, avec le lien. Vérifié le ${rivalData.checked}.`
              : `Only what these companies state on their own sites, with the link. Checked on ${rivalData.checked}.`}
          </p>
          {rivalData.rivals.map((r) => (
            <div key={r.name}>
              <h3>{r.name}</h3>
              <ul>
                {r.facts.map((f) => (
                  <li key={f.source + f.en}>
                    {f[lang]}{" "}
                    <a href={f.source} rel="nofollow noopener" target="_blank">
                      source
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p>
            {fr
              ? "Chez MIMT, le numéro reste à vous tant que le forfait est payé, même sans activité, et aucune option n'est nécessaire pour le garder."
              : "With MIMT, your number stays yours as long as the plan is paid, even when inactive, and no add-on is needed to keep it."}
          </p>
          <p>
            <a className="btn btn--primary" href={href(lang, "home", "numero")}>
              {fr ? "Obtenir mon numéro" : "Get my number"}
            </a>
          </p>
        </div>
      </section>
      <section className="section section--tint" aria-labelledby="cmp-not-yet">
        <div className="container prose">
          <h2 id="cmp-not-yet">{fr ? "Ce que MIMT ne fait pas (encore)" : "What MIMT doesn't do (yet)"}</h2>
          <ul>
            {notYet.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <p>
            <a className="btn" href={href(lang, "plans")}>
              {fr ? "Voir les forfaits" : "See plans"}
            </a>
          </p>
        </div>
      </section>
    </Shell>
  );
}
