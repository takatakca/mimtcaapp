import { PageHero, Shell } from "@/components/Shell";
import { LeadForm } from "@/components/LeadForm";
import { Icon } from "@/components/Visuals";
import { href, type Lang } from "@/lib/site";

const ITEMS = [
  {
    icon: "wifi" as const,
    fr: ["Internet résidentiel", "Internet à la maison revendu par MIMT, avec du soutien d'ici, en français d'abord."],
    en: ["Home internet", "Home internet resold by MIMT, with local support, French first."],
  },
  {
    icon: "number" as const,
    fr: ["Cellulaire", "Un forfait cellulaire (carte SIM ou eSIM) qui fonctionne avec votre numéro MIMT."],
    en: ["Mobile", "A mobile plan (SIM or eSIM) that works with your MIMT number."],
  },
  {
    icon: "phone" as const,
    fr: ["Téléphone résidentiel", "Un numéro pour la maison, avec votre téléphone habituel."],
    en: ["Home phone", "A number for the house, with your usual phone."],
  },
];

export function SoonPage({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  return (
    <Shell lang={lang} page="soon">
      <PageHero
        eyebrow={fr ? "Bientôt" : "Coming soon"}
        title={fr ? "Ce qui s'en vient chez MIMT" : "What's next at MIMT"}
        lead={
          fr
            ? "Ces services sont en préparation. Ils ne sont pas offerts pour le moment, et aucun prix ni aucune date ne sont annoncés."
            : "These services are in preparation. They are not available today, and no prices or dates are announced."
        }
      />
      <section className="section" aria-labelledby="soon-list">
        <div className="container">
          <h2 id="soon-list" className="sr-only">
            {fr ? "Services en préparation" : "Services in preparation"}
          </h2>
          <ul className="grid grid--3">
            {ITEMS.map((it) => (
              <li className="card feature soon" key={it.en[0]}>
                <span className="tag">{fr ? "Bientôt" : "Coming soon"}</span>
                <span className="feature__icon">
                  <Icon name={it.icon} />
                </span>
                <h3>{it[lang][0]}</h3>
                <p>{it[lang][1]}</p>
                <p className="soon__status">{fr ? "Liste d'attente seulement" : "Waitlist only"}</p>
              </li>
            ))}
          </ul>
          <div className="notice notice--info mt-l" role="note">
            {fr
              ? "Pourquoi « bientôt »? Pour revendre Internet et le cellulaire, MIMT doit d'abord signer une entente avec un fournisseur de réseau et respecter les codes du CRTC (Code sur les services sans fil, Code sur les services Internet). Tant que cette entente n'est pas signée, nous ne promettons ni date ni prix."
              : "Why “coming soon”? To resell internet and mobile, MIMT must first sign an agreement with a network provider and meet the CRTC codes (Wireless Code, Internet Code). Until that agreement is signed, we promise no date and no price."}
          </div>
          <p className="fineprint">
            {fr ? "Déjà en préparation pour le lancement : " : "Already in preparation for launch: "}
            <a href={href(lang, "home")}>MIMT Mobile</a>
            {fr ? " (numéro canadien dans une app) et " : " (a Canadian number in an app) and "}
            <a href={href(lang, "business")}>{fr ? "MIMT Affaires" : "MIMT Business"}</a>.
          </p>
        </div>
      </section>
      <section className="section section--tint" aria-labelledby="soon-wl">
        <div className="container waitlist">
          <div>
            <h2 id="soon-wl">{fr ? "Être avisé en premier" : "Hear about it first"}</h2>
            <p className="section-lead">
              {fr
                ? "Choisissez le service qui vous intéresse. Nous vous écrirons quand il sera prêt dans votre région."
                : "Choose the service you're interested in. We'll email you when it's ready in your area."}
            </p>
          </div>
          <div className="card form-card">
            <LeadForm kind="waitlist" lang={lang} submitLabel={fr ? "M'aviser" : "Notify me"} defaults={{ interest: "internet" }} />
          </div>
        </div>
      </section>
    </Shell>
  );
}
