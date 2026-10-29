import { PageHero, Shell } from "@/components/Shell";
import { ShareButton } from "@/components/ShareButton";
import { MISSIONS, formatPoints, missionPointsTotal, yearlyOfferLive } from "@/lib/growth";
import { APP_URL, href, type Lang } from "@/lib/site";

/** Missions and rewards: every reward is verified by the server, once per account, with no draw. */
export function RewardsPage({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  const total = formatPoints(missionPointsTotal(), lang);
  return (
    <Shell lang={lang} page="rewards">
      <PageHero
        photo={{ name: "artisan-atelier", alt: fr ? "Un artisan content regarde son téléphone dans son atelier" : "A happy craftsman looks at his phone in his workshop" }}
        eyebrow={fr ? "Missions MIMT" : "MIMT missions"}
        title={fr ? `Jusqu'à ${total} points, juste pour bien démarrer` : `Up to ${total} points, just for getting started`}
        lead={
          fr
            ? "Chaque étape de configuration de votre compte vous donne des points, à échanger contre des minutes, des textos ou une semaine sans pub. Un ami s'abonne avec votre lien : vous recevez tous les deux 1 mois Premium."
            : "Each step of setting up your account earns you points, to trade for minutes, texts or an ad-free week. A friend subscribes with your link: you both get 1 month of Premium."
        }
      />
      <section className="section hud-tint" aria-labelledby="missions-title">
        <div className="container">
          <div className="section-head" data-reveal="">
            <p className="kicker hud-code">{fr ? "Vos missions" : "Your missions"}</p>
            <h2 id="missions-title">{fr ? "Faites-les dans l'ordre que vous voulez" : "Do them in any order"}</h2>
          </div>
          <ol className="missions">
            {MISSIONS.map((m, i) => (
              <li key={m.id} className="mission hud-card" data-reveal="">
                <p className="mission__step hud-code">{`M-${String(i + 1).padStart(2, "0")}`}</p>
                <h3>{fr ? m.title.fr : m.title.en}</h3>
                <p>{fr ? m.how.fr : m.how.en}</p>
                <p className="mission__reward">{m.points ? `+${formatPoints(m.points, lang)} points` : fr ? "1 mois Premium chacun" : "1 month Premium each"}</p>
                <a className="mission__go" href={`${APP_URL}${m.path}`} rel="noopener">
                  {fr ? "Commencer" : "Start"} <span aria-hidden="true">→</span>
                </a>
              </li>
            ))}
            {yearlyOfferLive() ? (
              <li className="mission mission--star hud-card" data-reveal="">
                <p className="mission__step hud-code">M-★</p>
                <h3>{fr ? "Passez à l'annuel" : "Go yearly"}</h3>
                <p>{fr ? "Payez votre forfait à l'année : 12 mois pour le prix de 11." : "Pay your plan yearly: 12 months for the price of 11."}</p>
                <p className="mission__reward">{fr ? "1 mois gratuit" : "1 month free"}</p>
                <a className="mission__go" href={href(lang, "plans")}>
                  {fr ? "Voir les forfaits" : "See plans"} <span aria-hidden="true">→</span>
                </a>
              </li>
            ) : null}
          </ol>
          <div className="missions__share" data-reveal="">
            <p>{fr ? "Votre lien d'invitation personnel est dans l'app, sous Missions. Pour faire connaître MIMT dès maintenant :" : "Your personal invite link is in the app, under Missions. To spread the word now:"}</p>
            <ShareButton lang={lang} className="btn btn--primary" />
          </div>
        </div>
      </section>
      <section className="section" aria-labelledby="rules-title">
        <div className="container prose">
          <h2 id="rules-title">{fr ? "Les règles, en clair" : "The rules, plainly"}</h2>
          <ul>
            {(fr
              ? [
                  "Chaque mission compte une seule fois par compte. La vérification du cellulaire compte une seule fois par numéro.",
                  "C'est notre serveur qui confirme chaque mission. Rien n'est accordé sur simple déclaration.",
                  "Aucun tirage, aucun hasard : qui fait la mission reçoit la récompense.",
                  "Aucun achat requis, sauf pour « Obtenez votre numéro » et l'offre annuelle.",
                  "Les points vont dans votre Portefeuille (10 points = 1 minute). Ils n'ont aucune valeur en argent et ne s'échangent pas contre de l'argent.",
                  "Parrainage : la récompense arrive après le premier mois payé de votre ami.",
                  "Nous ne récompensons jamais un avis, une note ou un « J'aime » : nous voulons des avis honnêtes.",
                ]
              : [
                  "Each mission counts once per account. Mobile verification counts once per number.",
                  "Our server confirms every mission. Nothing is granted on a simple claim.",
                  "No draw, no chance: whoever completes the mission gets the reward.",
                  "No purchase needed, except for « Get your number » and the yearly offer.",
                  "Points go to your Wallet (10 points = 1 minute). They have no cash value and cannot be exchanged for cash.",
                  "Referral: the reward arrives after your friend's first paid month.",
                  "We never reward a review, a rating or a « like »: we want honest reviews.",
                ]
            ).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </section>
    </Shell>
  );
}
