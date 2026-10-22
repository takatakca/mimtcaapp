import { PageHero, Shell } from "@/components/Shell";
import { FaqList } from "@/components/FaqList";
import { Icon, type IconName } from "@/components/Visuals";
import { AI_LIMITS, AI_MONTHLY_BUDGET_CAD_CENTS, PLANS, formatCad, type PlanCode } from "@mimt/shared";
import { faqByTopic } from "@/lib/faq";
import { href, type Lang } from "@/lib/site";

const FEATURES: { icon: IconName; who: { fr: string; en: string }; fr: [string, string]; en: [string, string] }[] = [
  {
    icon: "voicemail",
    who: { fr: "Premium, Affaires, Affaires Pro", en: "Premium, Business, Business Pro" },
    fr: [
      "Résumés de messages vocaux",
      "Qui a appelé, pourquoi, et est-ce urgent? Un résumé d'une ou deux phrases dans votre langue, à partir de la transcription du message. Le message original reste disponible.",
    ],
    en: [
      "Voicemail summaries",
      "Who called, why, and is it urgent? A one- or two-sentence summary in your language, from the voicemail transcript. The original message stays available.",
    ],
  },
  {
    icon: "chat",
    who: { fr: "Premium, Affaires, Affaires Pro", en: "Premium, Business, Business Pro" },
    fr: [
      "Réponses suggérées",
      "Jusqu'à trois réponses courtes proposées pour un texto reçu, en français par défaut. Rien n'est envoyé sans que vous touchiez « Envoyer ».",
    ],
    en: [
      "Suggested replies",
      "Up to three short replies suggested for a text you receive, in French by default. Nothing is sent until you tap “Send”.",
    ],
  },
  {
    icon: "shield",
    who: { fr: "Tous les forfaits (analyse IA : avec consentement)", en: "All plans (AI check: with consent)" },
    fr: [
      "Spam probable",
      "Des règles simples repèrent les appels et textos suspects (indicatifs à risque, rafales d'appels). Pour un texto ambigu, l'IA peut aider, avec votre consentement. C'est une étiquette « Spam probable » : rien n'est bloqué, et les rappels des services d'urgence sonnent toujours.",
    ],
    en: [
      "Likely spam",
      "Simple rules spot suspicious calls and texts (high-risk area codes, bursts of calls). For an unclear text, AI can help, with your consent. It's a “Likely spam” label: nothing is blocked, and callbacks from emergency services always ring through.",
    ],
  },
  {
    icon: "spark",
    who: { fr: "Affaires, Affaires Pro", en: "Business, Business Pro" },
    fr: [
      "Réceptionniste IA",
      "Il répond au téléphone de l'entreprise, en français ou en anglais, donne vos heures, votre adresse et vos réponses fréquentes, puis transfère l'appel à la bonne personne ou prend un message.",
    ],
    en: [
      "AI receptionist",
      "It answers the business phone in French or English, gives your hours, address and FAQ answers, then transfers the call to the right person or takes a message.",
    ],
  },
];

const AI_PLANS: PlanCode[] = ["premium", "business", "business_pro"];

export function AiPage({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  const minutes = Math.round(AI_LIMITS.receptionistMaxSeconds / 60);
  return (
    <Shell lang={lang} page="ai">
      <PageHero
        eyebrow={fr ? "Intelligence artificielle" : "Artificial intelligence"}
        title={fr ? "L'IA qui vous fait gagner du temps, avec votre accord" : "AI that saves you time, with your consent"}
        lead={
          fr
            ? "Résumés de messages vocaux, réponses suggérées, étiquettes « Spam probable » et réceptionniste virtuel pour les entreprises. Chaque fonction est facultative et demande votre consentement."
            : "Voicemail summaries, suggested replies, “Likely spam” labels and a virtual receptionist for businesses. Every feature is optional and asks for your consent."
        }
      />

      <section className="section" aria-labelledby="ai-features">
        <div className="container">
          <h2 id="ai-features">{fr ? "Ce que fait l'IA de MIMT" : "What MIMT's AI does"}</h2>
          <p className="section-lead">
            {fr
              ? "Les fonctions d'IA sont facultatives et demandent votre consentement. L'IA est fournie par Claude, un modèle de l'entreprise Anthropic."
              : "AI features are optional and need your consent. The AI is provided by Claude, a model from the company Anthropic."}
          </p>
          <ul className="grid grid--2 features">
            {FEATURES.map((f) => (
              <li className="card feature" key={f.en[0]}>
                <span className="feature__icon">
                  <Icon name={f.icon} />
                </span>
                <h3>{f[lang][0]}</h3>
                <p>{f[lang][1]}</p>
                <span className="status status--launch">{f.who[lang]}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section section--tint" id="consentement" aria-labelledby="ai-consent">
        <div className="container split">
          <div>
            <p className="kicker">{fr ? "Loi 25" : "Québec Law 25"}</p>
            <h2 id="ai-consent">{fr ? "Votre consentement, en clair" : "Your consent, in plain words"}</h2>
            <ul className="checklist">
              <li>
                {fr
                  ? "Les résumés, les réponses suggérées et l'analyse de textos par l'IA demandent un consentement distinct, que vous donnez dans l'app. Il est désactivé par défaut."
                  : "Summaries, suggested replies and AI text checks need a separate consent, given in the app. It is off by default."}
              </li>
              <li>
                {fr
                  ? "Sans consentement, rien n'est envoyé au fournisseur d'IA. Les appels, les textos et la messagerie vocale fonctionnent normalement."
                  : "Without consent, nothing is sent to the AI provider. Calls, texts and voicemail work normally."}
              </li>
              <li>{fr ? "Vous pouvez retirer votre consentement en tout temps." : "You can withdraw your consent at any time."}</li>
              <li>
                {fr
                  ? "Le fournisseur d'IA traite ces données à l'extérieur du Québec. Nous évaluons ce transfert et l'encadrons par une entente écrite avant le lancement."
                  : "The AI provider processes this data outside Québec. We assess this transfer and cover it with a written agreement before launch."}
              </li>
              <li>{fr ? "Nous ne vendons pas vos renseignements." : "We don't sell your information."}</li>
            </ul>
            <p>
              <a href={href(lang, "privacy", "ia")}>{fr ? "Lire la section IA de la politique de confidentialité" : "Read the AI section of the privacy policy"}</a>
            </p>
          </div>
          <div className="card consent">
            <h3>{fr ? "Réceptionniste IA : ce que l'appelant entend" : "AI receptionist: what the caller hears"}</h3>
            <p className="quote" lang="fr-CA">
              « Bonjour! Vous parlez à l&apos;assistant virtuel de Votre Entreprise, un agent d&apos;intelligence artificielle. La conversation est transcrite pour traiter votre demande. »
            </p>
            <ul className="checklist">
              <li>
                {fr
                  ? "L'entreprise accepte les conditions du réceptionniste IA avant de l'activer."
                  : "The business accepts the AI receptionist terms before turning it on."}
              </li>
              <li>
                {fr
                  ? `Une conversation avec l'IA est limitée à ${minutes} minutes.`
                  : `A conversation with the AI is limited to ${minutes} minutes.`}
              </li>
              <li>
                {fr
                  ? "Les numéros de carte de paiement dictés sont masqués avant d'être transmis à l'IA."
                  : "Payment card numbers that are spoken are masked before being sent to the AI."}
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="ai-plans">
        <div className="container">
          <h2 id="ai-plans">{fr ? "Inclus dans ces forfaits" : "Included in these plans"}</h2>
          <p className="section-lead">
            {fr
              ? "Pas de frais à l'utilisation. Chaque compte a un plafond mensuel de coût d'IA; une fois atteint, l'IA s'arrête jusqu'au mois suivant, et rien d'autre ne change."
              : "No usage fees. Each account has a monthly AI cost cap; once reached, AI pauses until next month, and nothing else changes."}
          </p>
          <div className="table-wrap" role="region" aria-labelledby="ai-plans" tabIndex={0}>
            <table className="simple">
              <thead>
                <tr>
                  <th scope="col">{fr ? "Forfait" : "Plan"}</th>
                  <th scope="col">{fr ? "Prix" : "Price"}</th>
                  <th scope="col">{fr ? "Plafond IA mensuel" : "Monthly AI cap"}</th>
                </tr>
              </thead>
              <tbody>
                {AI_PLANS.map((c) => (
                  <tr key={c}>
                    <th scope="row">{PLANS[c].name[lang]}</th>
                    <td>
                      {formatCad(PLANS[c].monthlyPriceCents, lang)}
                      {PLANS[c].perLine ? (fr ? "/ligne/mois" : "/line/month") : fr ? "/mois" : "/month"}
                    </td>
                    <td>{formatCad(AI_MONTHLY_BUDGET_CAD_CENTS[c], lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="fineprint">
            {fr
              ? "Gratuit et Essentiel : pas d'IA générative; l'étiquette « Spam probable » par règles simples reste incluse. Prix proposés, avant taxes. "
              : "Free and Essential: no generative AI; the rule-based “Likely spam” label is still included. Proposed prices, before taxes. "}
            <a href={href(lang, "plans")}>{fr ? "Tous les forfaits" : "All plans"}</a>
          </p>
        </div>
      </section>

      <section className="section section--tint" aria-labelledby="ai-faq">
        <div className="container prose">
          <h2 id="ai-faq">{fr ? "Questions sur l'IA" : "AI questions"}</h2>
          <FaqList lang={lang} items={faqByTopic(lang, "ai")} />
        </div>
      </section>
    </Shell>
  );
}
