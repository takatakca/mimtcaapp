import type { Lang } from "@/lib/site";

type Status = "live" | "starting" | "official" | "prediction";

interface Step {
  year: string;
  title: { fr: string; en: string };
  text: { fr: string; en: string };
  status: Status;
}

// Our view of where calling is going. Each step says plainly whether MIMT does it today or it is a prediction.
const STEPS: readonly Step[] = [
  {
    year: "2026",
    title: { fr: "Votre numéro vit dans le nuage", en: "Your number lives in the cloud" },
    text: { fr: "Cellulaire, ordinateur, navigateur : le même numéro sonne partout, sans carte SIM.", en: "Phone, computer, browser: the same number rings everywhere, no SIM card." },
    status: "live",
  },
  {
    year: "2026",
    title: { fr: "L'IA répond pour vous", en: "AI answers for you" },
    text: { fr: "Une réceptionniste qui prend la commande ou le rendez-vous, puis vous envoie le résumé.", en: "A receptionist that takes the order or the booking, then sends you the summary." },
    status: "live",
  },
  {
    year: "2027",
    title: { fr: "Le 9-1-1 passe à Internet", en: "9-1-1 moves to the internet" },
    text: { fr: "Le Canada remplace l'ancien réseau 9-1-1 par le 9-1-1 nouvelle génération (NG9-1-1), pensé pour la voix par Internet.", en: "Canada is replacing the old 9-1-1 network with Next Generation 9-1-1 (NG9-1-1), built for voice over the internet." },
    status: "official",
  },
  {
    year: "2028",
    title: { fr: "On vous joint par votre nom", en: "People reach you by name" },
    text: { fr: "Votre identité remplace votre numéro de carte : un @nom, sur n'importe quel appareil.", en: "Your identity replaces a SIM number: one @name, on any device." },
    status: "starting",
  },
  {
    year: "2029",
    title: { fr: "La traduction en direct", en: "Live translation" },
    text: { fr: "Vous parlez français, votre client entend l'anglais, et l'inverse, pendant l'appel.", en: "You speak French, your customer hears English, and back, during the call." },
    status: "prediction",
  },
  {
    year: "2030",
    title: { fr: "Un agent pour chaque personne", en: "An agent for everyone" },
    text: {
      fr: "Votre IA filtre les inconnus, réserve, rappelle et négocie. Vous gardez le contrôle et votre consentement.",
      en: "Your AI screens strangers, books, calls back and negotiates. You keep control and your consent.",
    },
    status: "prediction",
  },
];

const STATUS: Record<Status, { fr: string; en: string }> = {
  live: { fr: "Déjà chez MIMT", en: "At MIMT today" },
  starting: { fr: "Ça commence : @nom chez MIMT", en: "Starting: @name at MIMT" },
  official: { fr: "Transition nationale (CRTC)", en: "National transition (CRTC)" },
  prediction: { fr: "Notre prédiction", en: "Our prediction" },
};

/** « Le futur de la communication »: a signal line through 2026–2030, honest about what exists. */
export function FutureSection({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  return (
    <section className="section future hud-dark" aria-labelledby="future-title">
      <div className="future__grid" aria-hidden="true" />
      <div className="container">
        <div className="section-head" data-reveal="">
          <p className="kicker kicker--light hud-code">{fr ? "Transmission 2026 → 2030" : "Transmission 2026 → 2030"}</p>
          <h2 id="future-title">{fr ? "Le futur de la communication. On le branche pour vous." : "The future of calling. We plug you into it."}</h2>
          <p className="section-lead">
            {fr
              ? "Le téléphone devient un logiciel : il vous suit, il comprend, il répond. Voici où ça s'en va, et ce que MIMT fait déjà."
              : "The phone is becoming software: it follows you, understands and answers. Here is where it is going, and what MIMT already does."}
          </p>
        </div>
        <ol className="future__line">
          {STEPS.map((s, i) => (
            <li key={s.title.fr} className={`future__node future__node--${s.status}`} data-reveal="" style={{ "--i": String(i) } as React.CSSProperties}>
              <span className="future__dot" aria-hidden="true" />
              <p className="future__year">{s.year}</p>
              <h3>{fr ? s.title.fr : s.title.en}</h3>
              <p>{fr ? s.text.fr : s.text.en}</p>
              <p className={`future__chip future__chip--${s.status}`}>{fr ? STATUS[s.status].fr : STATUS[s.status].en}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
