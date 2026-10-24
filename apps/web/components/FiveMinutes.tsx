import { Icon, type IconName } from "@/components/Visuals";
import type { Lang } from "@/lib/site";

/**
 * « Votre standard en 5 minutes » (mimt.ca /affaires): the real order of the purchase and of the app's setup
 * wizard (app.mimt.ca/affaires/nouvelle). Four steps that reveal one after the other, a light line that fills
 * between them, and a tiny preview of what each step looks like. The CTA goes to the business number picker.
 */
const STEPS: { icon: IconName; fr: [string, string]; en: [string, string] }[] = [
  {
    icon: "number",
    fr: ["Choisissez votre numéro", "Par indicatif ou par ville : 514, 438, 418, Québec… Il est réservé 10 minutes pour vous."],
    en: ["Pick your number", "By area code or city: 514, 438, 418, Québec… It is held for you for 10 minutes."],
  },
  {
    icon: "lock",
    fr: ["Créez le compte et payez", "Adresse 9-1-1, puis paiement sécurisé par Stripe. Sans contrat, annulable en tout temps."],
    en: ["Create the account and pay", "9-1-1 address, then secure payment by Stripe. No contract, cancel any time."],
  },
  {
    icon: "menu",
    fr: ["Heures et accueil bilingue", "Choisissez vos heures, fériés du Québec compris. Votre accueil est écrit pour vous, en français puis en anglais. Écoutez-le, modifiez-le."],
    en: ["Hours and bilingual greeting", "Pick your hours, Québec holidays included. Your greeting is written for you, in French then English. Listen to it, edit it."],
  },
  {
    icon: "spark",
    fr: ["Réceptionniste IA, et c'est en ligne", "Elle répond sur vos heures, vos services et vos prix, prend un message ou vous transfère l'appel. Faites un appel test."],
    en: ["AI receptionist, and you're live", "It answers about your hours, services and prices, takes a message or transfers the call. Make a test call."],
  },
];

export function FiveMinutes({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  return (
    <section className="section section--dark five" id={fr ? "cinq-minutes" : "five-minutes"} aria-labelledby="five-title">
      <div className="aurora" aria-hidden="true" />
      <div className="techgrid" aria-hidden="true" />
      <div className="container">
        <p className="kicker kicker--light">{fr ? "MIMT Affaires" : "MIMT Business"}</p>
        <h2 id="five-title">{fr ? "Votre standard en 5 minutes" : "Your phone system in 5 minutes"}</h2>
        <p className="lead">
          {fr
            ? "Un numéro, un accueil bilingue, vos heures et une réceptionniste IA. Sans technicien, sans appareil, tout dans le navigateur."
            : "A number, a bilingual greeting, your hours and an AI receptionist. No technician, no hardware, all in the browser."}
        </p>
        <ol className="five__steps">
          {STEPS.map((s, i) => {
            const [title, text] = fr ? s.fr : s.en;
            return (
              <li key={s.icon} className="five__step" data-reveal="" style={{ transitionDelay: `${i * 160}ms` }}>
                <span className="five__num" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="five__icon" aria-hidden="true">
                  <Icon name={s.icon} />
                </span>
                <h3>{title}</h3>
                <p>{text}</p>
                <div className="five__peek" aria-hidden="true">
                  {i === 0 ? <span className="five__number">514 555-0142</span> : null}
                  {i === 1 ? (
                    <span className="five__chips">
                      <span>9-1-1 ✓</span>
                      <span>Stripe ✓</span>
                    </span>
                  ) : null}
                  {i === 2 ? (
                    <span className="five__bubble">
                      {fr ? "« Bonjour et bienvenue chez… Hello and welcome to… »" : "“Bonjour et bienvenue chez… Hello and welcome to…”"}
                      <span className="five__wave">
                        <i />
                        <i />
                        <i />
                        <i />
                      </span>
                    </span>
                  ) : null}
                  {i === 3 ? (
                    <span className="five__live">
                      <span className="five__dot" />
                      {fr ? "En ligne" : "Live"}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
        <div className="cta-row five__cta">
          <a className="btn btn--primary btn--lg" href="#numero-affaires">
            {fr ? "Choisir le numéro de mon entreprise" : "Pick my business number"}
          </a>
          <span className="five__note">{fr ? "Le reste se fait dans l'app, en quelques clics." : "The rest happens in the app, in a few clicks."}</span>
        </div>
      </div>
    </section>
  );
}
