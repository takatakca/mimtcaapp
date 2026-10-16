import { Shell } from "@/components/Shell";
import { LeadForm } from "@/components/LeadForm";
import { Icon, PhoneMockup, StoreBadges } from "@/components/Visuals";
import { PlanCard } from "@/components/PlanCard";
import { CONSUMER_PLANS, PLANS, formatCad } from "@/lib/plans-view";
import { serviceLd } from "@/lib/seo";
import { APP_URL, href, type Lang } from "@/lib/site";

export function HomePage({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  const t = fr ? FR : EN;
  return (
    <Shell lang={lang} page="home" ld={[serviceLd(lang, "mobile"), serviceLd(lang, "business")]}>
      <section className="hero">
        <div className="container hero__inner">
          <div className="hero__copy">
            <p className="eyebrow">
              <span className="pill">{t.badge}</span> MIMT Mobile · MIMT {fr ? "Affaires" : "Business"}
            </p>
            <h1>{t.h1}</h1>
            <p className="lead">{t.lead}</p>
            <div className="cta-row">
              <a className="btn btn--primary btn--lg" href="#liste-attente-form">
                {t.ctaWaitlist}
              </a>
              <a className="btn btn--ghost btn--lg" href={href(lang, "plans")}>
                {t.ctaPlans}
              </a>
            </div>
            <StoreBadges lang={lang} />
          </div>
          <div className="hero__art">
            <PhoneMockup lang={lang} />
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="features-title">
        <div className="container">
          <p className="kicker">MIMT Mobile</p>
          <h2 id="features-title">{t.featuresTitle}</h2>
          <ul className="grid grid--3 features">
            {t.features.map((f) => (
              <li key={f.title} className="card feature">
                <span className="feature__icon">
                  <Icon name={f.icon} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </li>
            ))}
          </ul>
          <p className="fineprint">
            {fr ? "Le 9-1-1 par Internet a des limites importantes. " : "9-1-1 over the internet has important limits. "}
            <a href={href(lang, "e911")}>{fr ? "Lire la page 9-1-1" : "Read the 9-1-1 page"}</a>
          </p>
        </div>
      </section>

      <section className="section section--tint" aria-labelledby="how-title">
        <div className="container">
          <p className="kicker">{fr ? "Comment ça marche" : "How it works"}</p>
          <h2 id="how-title">{t.howTitle}</h2>
          <ol className="steps">
            {t.steps.map((s, i) => (
              <li key={s.title} className="step">
                <span className="step__num" aria-hidden="true">
                  {i + 1}
                </span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section" aria-labelledby="plans-title">
        <div className="container">
          <p className="kicker">{fr ? "Forfaits" : "Plans"}</p>
          <h2 id="plans-title">{t.plansTitle}</h2>
          <p className="section-lead">{t.plansLead}</p>
          <div className="grid grid--3">
            {CONSUMER_PLANS.map((code) => (
              <PlanCard key={code} plan={PLANS[code]} lang={lang} highlight={code === "premium"} compact />
            ))}
          </div>
          <p className="fineprint">
            {t.taxNote} <a href={href(lang, "plans")}>{fr ? "Comparer tous les forfaits" : "Compare all plans"}</a>
          </p>
        </div>
      </section>

      <section className="section section--dark business-teaser" aria-labelledby="biz-title">
        <div className="container business-teaser__inner">
          <div>
            <p className="kicker kicker--light">MIMT {fr ? "Affaires" : "Business"}</p>
            <h2 id="biz-title">{t.bizTitle}</h2>
            <p className="lead">{t.bizLead}</p>
            <p className="price-line">
              {fr ? "À partir de " : "From "}
              <strong>{formatCad(PLANS.business.monthlyPriceCents, lang)}</strong>
              {fr ? " par ligne par mois" : " per line per month"}
            </p>
            <div className="cta-row">
              <a className="btn btn--primary" href={href(lang, "business", "demo")}>
                {fr ? "Demander une démo" : "Request a demo"}
              </a>
              <a className="btn btn--ghost" href={href(lang, "business")}>
                {fr ? "Découvrir MIMT Affaires" : "Explore MIMT Business"}
              </a>
            </div>
          </div>
          <ul className="checklist checklist--light">
            {t.bizList.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section" aria-labelledby="ai-title">
        <div className="container">
          <p className="kicker">{fr ? "Intelligence artificielle" : "Artificial intelligence"}</p>
          <h2 id="ai-title">{t.aiTitle}</h2>
          <p className="section-lead">{t.aiLead}</p>
          <ul className="grid grid--4 features">
            {t.ai.map((f) => (
              <li key={f.title} className="card feature">
                <span className="feature__icon">
                  <Icon name={f.icon} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </li>
            ))}
          </ul>
          <p className="fineprint">
            <a href={href(lang, "ai")}>{fr ? "Tout savoir sur l'IA et le consentement" : "All about AI and consent"}</a>
            {" · "}
            <a href={href(lang, "compare")}>{fr ? "Comparer MIMT aux applis de numéro gratuit" : "Compare MIMT with free-number apps"}</a>
          </p>
        </div>
      </section>

      <section className="section section--tint" aria-labelledby="web-title">
        <div className="container business-teaser__inner">
          <div>
            <p className="kicker">{fr ? "App Web" : "Web app"}</p>
            <h2 id="web-title">{t.webTitle}</h2>
            <p className="section-lead">{t.webLead}</p>
          </div>
          <div className="cta-row">
            <a className="btn btn--primary" href={APP_URL} rel="noopener">
              {fr ? "Ouvrir app.mimt.ca" : "Open app.mimt.ca"}
            </a>
            <a className="btn btn--outline" href={href(lang, "webapp")}>
              {fr ? "En savoir plus" : "Learn more"}
            </a>
          </div>
        </div>
      </section>

      <section className="section quebec" aria-labelledby="qc-title">
        <div className="container quebec__inner">
          <h2 id="qc-title">{fr ? "Fait au Québec · écosystème GROUPE TAKATAK" : "Made in Québec · GROUPE TAKATAK ecosystem"}</h2>
          <p>{t.qcText}</p>
          <a href="https://takatak.ca" rel="noopener">
            takatak.ca
          </a>
        </div>
      </section>

      <section className="section section--tint" id={fr ? "liste-attente" : "waitlist"} aria-labelledby="wl-title">
        <div className="container waitlist">
          <div>
            <p className="kicker">{fr ? "Lancement" : "Launch"}</p>
            <h2 id="wl-title">{t.wlTitle}</h2>
            <p className="section-lead">{t.wlLead}</p>
            <p className="fineprint">
              {fr ? "Téléphone résidentiel, Internet et cellulaire : " : "Home phone, internet and cellular: "}
              <a href={href(lang, "soon")}>{fr ? "voir ce qui s'en vient" : "see what's coming"}</a>
            </p>
          </div>
          <div className="card form-card" id="liste-attente-form">
            <LeadForm kind="waitlist" lang={lang} submitLabel={fr ? "M'inscrire" : "Sign me up"} />
          </div>
        </div>
      </section>
    </Shell>
  );
}

type IconName = Parameters<typeof Icon>[0]["name"];

const FR = {
  badge: "Bientôt",
  h1: "Votre numéro canadien, partout.",
  lead: "Appelez et textez avec un vrai numéro canadien, par Wi‑Fi ou données mobiles. Pour vous avec MIMT Mobile, pour votre équipe avec MIMT Affaires.",
  ctaWaitlist: "Rejoindre la liste d'attente",
  ctaPlans: "Voir les forfaits",
  featuresTitle: "Tout ce qu'il faut pour rester joignable",
  features: [
    { icon: "number" as IconName, title: "Un numéro canadien", text: "Choisissez votre numéro parmi les indicatifs offerts. Il fonctionne dans l'app, sur votre téléphone actuel." },
    { icon: "wifi" as IconName, title: "Appels et textos par Internet", text: "Wi‑Fi ou données mobiles : appelez et textez au Canada et aux États-Unis, selon votre forfait." },
    { icon: "voicemail" as IconName, title: "Messagerie vocale", text: "Écoutez vos messages dans l'app. Transcription en texte avec Premium." },
    { icon: "free" as IconName, title: "Forfait gratuit", text: "Commencez à 0 $ avec publicités et des limites claires, affichées d'avance." },
    { icon: "lock" as IconName, title: "Verrouillage du numéro", text: "Gardez votre numéro même si vous ne l'utilisez pas pendant un moment." },
    { icon: "sos" as IconName, title: "9-1-1 avec adresse", text: "Vous enregistrez votre adresse avant votre premier appel. Le 9-1-1 n'est jamais bloqué par votre forfait." },
  ],
  howTitle: "Prêt en trois étapes",
  steps: [
    { title: "Téléchargez l'app", text: "MIMT Mobile arrive sur iPhone et Android. Inscrivez-vous à la liste d'attente pour être avisé." },
    { title: "Choisissez votre numéro", text: "Sélectionnez un numéro canadien, puis enregistrez votre adresse pour le 9-1-1." },
    { title: "Appelez et textez", text: "Utilisez votre numéro par Wi‑Fi ou données, ici comme en voyage." },
  ],
  plansTitle: "Des forfaits simples, des limites claires",
  plansLead: "Prix proposés pour le lancement. Chaque limite est écrite noir sur blanc.",
  taxNote: "Prix en dollars canadiens. Taxes en sus (TPS/TVQ) et taxe municipale 9-1-1 du Québec.",
  bizTitle: "Le téléphone d'affaires, sans le matériel",
  bizLead: "Une ligne par employé, sur cellulaire et ordinateur. Un accueil bilingue professionnel pour vos clients, un portail simple pour vous.",
  bizList: [
    "Postes et numéros directs",
    "Réceptionniste automatique bilingue",
    "Heures d'ouverture et jours fériés du Québec",
    "Groupes de sonnerie",
    "Réceptionniste IA",
    "App mobile, app Web et portail administrateur",
    "Enregistrement des appels avec avis (Affaires Pro)",
  ],
  aiTitle: "Une IA utile, jamais sans votre accord",
  aiLead: "Facultative et désactivée par défaut. Rien n'est envoyé à l'IA sans votre consentement distinct (Loi 25).",
  ai: [
    { icon: "voicemail" as IconName, title: "Résumés vocaux", text: "Qui a appelé, pourquoi, et si c'est urgent, en une phrase." },
    { icon: "chat" as IconName, title: "Réponses suggérées", text: "Trois réponses courtes à vos textos. Rien ne part sans vous." },
    { icon: "shield" as IconName, title: "Spam probable", text: "Une étiquette « Spam probable » sur les appels et textos douteux. Rien n'est bloqué." },
    { icon: "spark" as IconName, title: "Réceptionniste IA", text: "Pour les entreprises : il répond, renseigne et transfère." },
  ],
  webTitle: "Votre numéro, aussi sur l'ordinateur",
  webLead: "Avec l'app Web app.mimt.ca, appelez, textez et écoutez vos messages dans le navigateur, avec le même compte. Ouverture avec le lancement de MIMT.",
  qcText: "MIMT est conçu à Montréal, en français d'abord. MIMT fait partie de l'écosystème GROUPE TAKATAK, qui aide les entreprises d'ici à croître en ligne.",
  wlTitle: "Soyez parmi les premiers",
  wlLead: "MIMT n'est pas encore offert. Laissez votre courriel : nous vous écrirons une seule fois au lancement, sauf si vous acceptez nos nouvelles.",
};

const EN: typeof FR = {
  badge: "Coming soon",
  h1: "Your Canadian number, anywhere.",
  lead: "Call and text with a real Canadian number over Wi‑Fi or mobile data. For you with MIMT Mobile, for your team with MIMT Business.",
  ctaWaitlist: "Join the waitlist",
  ctaPlans: "See plans",
  featuresTitle: "Everything you need to stay reachable",
  features: [
    { icon: "number", title: "A Canadian number", text: "Pick your number from the available area codes. It works in the app, on the phone you already have." },
    { icon: "wifi", title: "Calls and texts over the internet", text: "Wi‑Fi or mobile data: call and text across Canada and the US, within your plan." },
    { icon: "voicemail", title: "Voicemail", text: "Listen to your messages in the app. Text transcription with Premium." },
    { icon: "free", title: "Free plan", text: "Start at $0 with ads and clear limits, shown up front." },
    { icon: "lock", title: "Number Lock", text: "Keep your number even if you don't use it for a while." },
    { icon: "sos", title: "9-1-1 with your address", text: "You register your address before your first call. 9-1-1 is never blocked by your plan." },
  ],
  howTitle: "Ready in three steps",
  steps: [
    { title: "Download the app", text: "MIMT Mobile is coming to iPhone and Android. Join the waitlist to hear first." },
    { title: "Pick your number", text: "Choose a Canadian number, then register your address for 9-1-1." },
    { title: "Call and text", text: "Use your number over Wi‑Fi or data, at home or on the road." },
  ],
  plansTitle: "Simple plans, clear limits",
  plansLead: "Proposed launch prices. Every limit is written down.",
  taxNote: "Prices in Canadian dollars. Taxes extra (GST/QST) and the Québec 9-1-1 municipal tax.",
  bizTitle: "Business phone, without the hardware",
  bizLead: "One line per employee, on mobile and desktop. A professional greeting for your customers, a simple portal for you.",
  bizList: [
    "Extensions and direct numbers",
    "Bilingual auto-attendant",
    "Business hours and Québec holidays",
    "Ring groups",
    "AI receptionist",
    "Mobile app, web app and admin portal",
    "Call recording with notice (Business Pro)",
  ],
  aiTitle: "Useful AI, never without your consent",
  aiLead: "Optional and off by default. Nothing is sent to the AI without your separate consent (Québec Law 25).",
  ai: [
    { icon: "voicemail", title: "Voicemail summaries", text: "Who called, why, and whether it's urgent, in one sentence." },
    { icon: "chat", title: "Suggested replies", text: "Three short replies to your texts. Nothing is sent without you." },
    { icon: "shield", title: "Likely spam", text: "A “Likely spam” label on doubtful calls and texts. Nothing is blocked." },
    { icon: "spark", title: "AI receptionist", text: "For businesses: it answers, informs and transfers." },
  ],
  webTitle: "Your number, on your computer too",
  webLead: "With the web app app.mimt.ca, call, text and play voicemail in your browser, with the same account. Opens with the MIMT launch.",
  qcText: "MIMT is built in Montréal, French first. MIMT is part of the GROUPE TAKATAK ecosystem, which helps local businesses grow online.",
  wlTitle: "Be among the first",
  wlLead: "MIMT is not available yet. Leave your email: we'll write once at launch, unless you also opt in to our news.",
};
