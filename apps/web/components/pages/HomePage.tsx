import { Shell } from "@/components/Shell";
import { LeadForm } from "@/components/LeadForm";
import { NumberPicker } from "@/components/NumberPicker";
import { FaqList } from "@/components/FaqList";
import { FeatureCarousel, type Slide } from "@/components/FeatureCarousel";
import { HeroArt, Skyline } from "@/components/HeroArt";
import { Offers } from "@/components/Offers";
import { Icon, type IconName } from "@/components/Visuals";
import { PlanCard } from "@/components/PlanCard";
import { faqItems } from "@/lib/faq";
import { CONSUMER_PLANS, PLANS, formatCad } from "@/lib/plans-view";
import { faqPageLd, serviceLd, softwareApplicationLd } from "@/lib/seo";
import { APP_URL, href, type Lang } from "@/lib/site";

/** FAQ questions repeated on the home page (answers come from lib/faq.ts, same as /aide/). */
const HOME_FAQ = ["quoi", "quand", "gratuit", "remplace-cellulaire", "transfert", "ordinateur", "taxes"];

export function HomePage({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  const t = fr ? FR : EN;
  const faq = faqItems(lang).filter((i) => HOME_FAQ.includes(i.id));
  const freePrice = fr ? `${PLANS.free.monthlyPriceCents / 100} $` : `$${PLANS.free.monthlyPriceCents / 100}`;
  const slides = t.slides(lang);

  return (
    <Shell lang={lang} page="home" ld={[softwareApplicationLd(lang), serviceLd(lang, "mobile"), serviceLd(lang, "business"), faqPageLd(lang, faq, "home")]}>
      {/* ---------- Hero ---------- */}
      <section className="home-hero" aria-labelledby="hero-title">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-grid" aria-hidden="true" />
        <div className="container home-hero__inner">
          <div className="home-hero__copy">
            <p className="hero-pills">
              <span className="pill pill--soft">{t.pillQc}</span>
            </p>
            <h1 id="hero-title">
              <span className="h1-line">{t.h1a}</span> <span className="h1-line text-gradient">{t.h1b}</span> <span className="h1-line">{t.h1c}</span>
            </h1>
            <p className="lead home-hero__lead">
              <strong>{t.leadStrong}</strong> {t.lead.replace("{free}", freePrice)}
            </p>
            <NumberPicker lang={lang} plan="lock" />
            <ul className="hero-ticks">
              {t.ticks.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <p className="hero-note">
              {t.heroNote.replace("{lock}", formatCad(PLANS.lock.monthlyPriceCents, lang))}{" "}
              <a href={APP_URL} rel="noopener">
                {t.ctaWeb}
              </a>
            </p>
          </div>
          <HeroArt lang={lang} />
        </div>
        <Skyline />
      </section>

      {/* ---------- Trust strip ---------- */}
      <section className="trust" aria-label={t.trustLabel}>
        <ul className="container trust__list">
          {t.trust.map((x) => (
            <li key={x.text}>
              <Icon name={x.icon} />
              <span>{x.text}</span>
            </li>
          ))}
          <li>
            <Icon name="sos" />
            <a href={href(lang, "e911")}>{t.trust911}</a>
          </li>
        </ul>
      </section>

      {/* ---------- Features carousel ---------- */}
      <section className="section section--features" aria-labelledby="features-title">
        <div className="container">
          <div className="section-head" data-reveal="">
            <p className="kicker">MIMT Mobile</p>
            <h2 id="features-title">{t.featuresTitle}</h2>
            <p className="section-lead">{t.featuresLead}</p>
          </div>
          <FeatureCarousel lang={lang} label={t.featuresTitle} slides={slides} />
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section className="section" aria-labelledby="how-title">
        <div className="container">
          <div className="section-head section-head--center" data-reveal="">
            <p className="kicker">{fr ? "Comment ça marche" : "How it works"}</p>
            <h2 id="how-title">{t.howTitle}</h2>
          </div>
          <ol className="how">
            {t.steps.map((s, i) => (
              <li key={s.title} className="how__step" data-reveal="" style={{ transitionDelay: `${i * 120}ms` }}>
                <span className="how__num" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="how__icon">
                  <Icon name={s.icon} />
                </span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------- Plans ---------- */}
      <section className="section section--tint" id={fr ? "forfaits" : "plans"} aria-labelledby="plans-title">
        <div className="container">
          <div className="section-head section-head--center" data-reveal="">
            <p className="kicker">{fr ? "Forfaits" : "Plans"}</p>
            <h2 id="plans-title">{t.plansTitle}</h2>
            <p className="section-lead">{t.plansLead}</p>
          </div>
          <div className="grid grid--3 plans-grid">
            {CONSUMER_PLANS.map((code) => (
              <PlanCard key={code} plan={PLANS[code]} lang={lang} highlight={code === "premium"} compact />
            ))}
          </div>
          <p className="fineprint fineprint--center">
            {t.taxNote}{" "}
            <strong>
              {fr ? "Le 9-1-1 par Internet a des limites : " : "9-1-1 over the internet has limits: "}
              <a href={href(lang, "e911")}>{fr ? "à lire avant d'utiliser MIMT" : "read before using MIMT"}</a>.
            </strong>{" "}
            <a href={href(lang, "plans")}>{fr ? "Comparer tous les forfaits" : "Compare all plans"}</a>
          </p>
          <Offers lang={lang} />
        </div>
      </section>

      {/* ---------- MIMT Affaires ---------- */}
      <section className="section section--dark biz" aria-labelledby="biz-title">
        <div className="hero-glow hero-glow--soft" aria-hidden="true" />
        <div className="container biz__inner">
          <div className="biz__copy" data-reveal="">
            <p className="kicker kicker--light">MIMT {fr ? "Affaires" : "Business"}</p>
            <h2 id="biz-title">{t.bizTitle}</h2>
            <p className="lead">{t.bizLead}</p>
            <p className="price-line">
              {fr ? "À partir de " : "From "}
              <strong>{formatCad(PLANS.business.monthlyPriceCents, lang)}</strong>
              {fr ? " par ligne par mois" : " per line per month"}
              <span className="price-line__note">{fr ? " · avant taxes" : " · before tax"}</span>
            </p>
            <p className="launch-badge">
              <span className="launch-badge__tag">{fr ? "Offre de lancement" : "Launch offer"}</span>
              {fr ? "Mise en service gratuite" : "Free setup"}
              <small>{fr ? "Offre de lancement; conditions à venir." : "Launch offer; terms to come."}</small>
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
          <ul className="biz__grid">
            {t.biz.map((b, i) => (
              <li key={b.title} className={`biz-card${b.soon ? " biz-card--soon" : ""}`} data-reveal="" data-tilt="" style={{ transitionDelay: `${(i % 4) * 80}ms` }}>
                <span className="biz-card__icon">
                  <Icon name={b.icon} />
                </span>
                <h3>
                  {b.title}
                  {b.soon ? <span className="soon-badge">{fr ? "Bientôt" : "Soon"}</span> : null}
                </h3>
                <p>{b.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------- AI ---------- */}
      <section className="section" aria-labelledby="ai-title">
        <div className="container">
          <div className="section-head" data-reveal="">
            <p className="kicker">{fr ? "Intelligence artificielle" : "Artificial intelligence"}</p>
            <h2 id="ai-title">{t.aiTitle}</h2>
            <p className="section-lead">{t.aiLead}</p>
          </div>
          <ul className="grid grid--4 features">
            {t.ai.map((f, i) => (
              <li key={f.title} className="card feature feature--lift" data-reveal="" data-tilt="" style={{ transitionDelay: `${i * 90}ms` }}>
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

      {/* ---------- Web app band ---------- */}
      <section className="section section--tint webband" aria-labelledby="web-title">
        <div className="container webband__inner">
          <div data-reveal="">
            <p className="kicker">{fr ? "App Web" : "Web app"}</p>
            <h2 id="web-title">{t.webTitle}</h2>
            <p className="section-lead">{t.webLead}</p>
            <div className="cta-row">
              <a className="btn btn--primary" href={APP_URL} rel="noopener">
                {fr ? "Ouvrir app.mimt.ca" : "Open app.mimt.ca"}
              </a>
              <a className="btn btn--outline" href={href(lang, "webapp")}>
                {fr ? "En savoir plus" : "Learn more"}
              </a>
            </div>
          </div>
          <div className="browser" aria-hidden="true" data-reveal="">
            <div className="browser__bar">
              <span />
              <span />
              <span />
              <p>app.mimt.ca</p>
            </div>
            <div className="browser__body">
              <div className="browser__side">
                <i />
                <i />
                <i />
                <i />
              </div>
              <div className="browser__main">
                <b className="browser__msg browser__msg--in" />
                <b className="browser__msg browser__msg--out" />
                <b className="browser__msg browser__msg--in browser__msg--short" />
                <b className="browser__dial" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section className="section" aria-labelledby="faq-title">
        <div className="container container--narrow">
          <div className="section-head section-head--center" data-reveal="">
            <p className="kicker">{fr ? "Questions fréquentes" : "FAQ"}</p>
            <h2 id="faq-title">{t.faqTitle}</h2>
          </div>
          <FaqList lang={lang} items={faq} />
          <p className="fineprint fineprint--center">
            <a href={href(lang, "help")}>{fr ? "Toutes les questions" : "All questions"}</a>
          </p>
        </div>
      </section>

      {/* ---------- Final CTA + waitlist ---------- */}
      <section className="section final-cta" id={fr ? "liste-attente" : "waitlist"} aria-labelledby="wl-title">
        <div className="hero-glow" aria-hidden="true" />
        <div className="container final-cta__inner">
          <div data-reveal="">
            <p className="kicker kicker--light">{fr ? "Commencer" : "Get started"}</p>
            <h2 id="wl-title">{t.wlTitle}</h2>
            <p className="lead">{t.wlLead}</p>
            <div className="cta-row">
              <a className="btn btn--primary btn--lg" href={APP_URL} rel="noopener">
                {t.ctaWeb}
              </a>
            </div>
            <p className="final-cta__qc">
              {t.qcText}{" "}
              <a href="https://takatak.ca" rel="noopener">
                takatak.ca
              </a>
            </p>
          </div>
          <div className="card form-card" id="liste-attente-form" data-reveal="">
            <h3 className="form-card__title">{fr ? "Apps iPhone et Android : soyez avisé à leur sortie" : "iPhone and Android apps: get notified when they ship"}</h3>
            <LeadForm kind="waitlist" lang={lang} submitLabel={fr ? "M'aviser" : "Notify me"} />
            <p className="fineprint">
              {fr ? "Téléphone résidentiel, Internet et cellulaire : " : "Home phone, internet and cellular: "}
              <a href={href(lang, "soon")}>{fr ? "voir ce qui s'en vient" : "see what's coming"}</a>
            </p>
          </div>
        </div>
      </section>
    </Shell>
  );
}

type Copy = {
  pillQc: string;
  h1a: string;
  h1b: string;
  h1c: string;
  leadStrong: string;
  lead: string;
  ctaWeb: string;
  ticks: string[];
  heroNote: string;
  trustLabel: string;
  trust: { icon: IconName; text: string }[];
  trust911: string;
  featuresTitle: string;
  featuresLead: string;
  slides: (lang: Lang) => Slide[];
  howTitle: string;
  steps: { icon: IconName; title: string; text: string }[];
  plansTitle: string;
  plansLead: string;
  taxNote: string;
  bizTitle: string;
  bizLead: string;
  biz: { icon: IconName; title: string; text: string; soon?: boolean }[];
  aiTitle: string;
  aiLead: string;
  ai: { icon: IconName; title: string; text: string }[];
  webTitle: string;
  webLead: string;
  faqTitle: string;
  wlTitle: string;
  wlLead: string;
  qcText: string;
};

const FR: Copy = {
  pillQc: "Fait au Québec",
  h1a: "Votre numéro.",
  h1b: "Partout.",
  h1c: "Sans frais cachés.",
  leadStrong: "Votre numéro canadien dans une app.",
  lead: "Appelez et textez par Wi‑Fi ou données, sur votre cellulaire comme sur votre ordinateur. Commencez à {free}.",
  ctaWeb: "Commencer gratuitement dans l'app Web",
  ticks: ["Vrai numéro canadien", "Transfert de numéro gratuit", "Français d'abord"],
  heroNote: "Un numéro à vous dès {lock} par mois. Sans numéro, MIMT reste gratuit entre utilisateurs :",
  trustLabel: "Nos engagements",
  trust: [
    { icon: "quebec", text: "Fait au Québec" },
    { icon: "lang", text: "Français d'abord, bilingue" },
    { icon: "tag", text: "Prix affichés, limites claires" },
    { icon: "shield", text: "IA seulement avec votre accord" },
  ],
  trust911: "9-1-1 : connaître les limites",
  featuresTitle: "Tout ce qu'un téléphone devrait faire. Dans une app.",
  featuresLead: "Glissez, cliquez ou utilisez les flèches du clavier.",
  slides: (lang) => [
    { icon: "number", tone: "blue", title: "Un vrai numéro canadien", text: "Choisissez votre indicatif. Gardez votre cellulaire actuel et ajoutez un deuxième numéro, pour le travail ou la vie perso.", link: { href: href(lang, "plans"), label: "Voir les forfaits" } },
    { icon: "wifi", tone: "cyan", title: "Appels et textos par Wi‑Fi", text: "Ici comme en voyage : appelez et textez au Canada et aux États-Unis, par Wi‑Fi ou données, selon votre forfait." },
    { icon: "desk", tone: "deep", title: "Sur l'ordinateur aussi", text: "app.mimt.ca : même numéro, même compte, directement dans le navigateur. S'installe comme une app.", link: { href: href(lang, "webapp"), label: "L'app Web" } },
    { icon: "transfer", tone: "blue", title: "Transfert de numéro gratuit", text: "Apportez votre numéro actuel. MIMT ne facture aucuns frais de transfert." },
    { icon: "voicemail", tone: "cyan", title: "Une messagerie vocale qui se lit", text: "Transcription en texte avec Premium, message d'accueil personnalisé et messages vocaux par courriel." },
    { icon: "spark", tone: "deep", title: "Résumés par IA", text: "Qui a appelé, pourquoi, et si c'est urgent : en une phrase. Seulement avec votre consentement.", link: { href: href(lang, "ai"), label: "L'IA chez MIMT" } },
    { icon: "shield", tone: "blue", title: "Spam probable", text: "Une étiquette claire sur les appels et textos douteux. Vous décidez : rien n'est bloqué sans vous." },
    { icon: "phone", tone: "cyan", title: "Vos règles d'appel", text: "Bloquez un numéro, renvoyez vos appels, activez « Ne pas déranger » la nuit. Selon le forfait." },
    { icon: "lock", tone: "deep", title: "Numéro verrouillé", text: "Gardez votre numéro même quand vous l'utilisez peu, avec Verrouillage du numéro ou Premium." },
    { icon: "sos", tone: "blue", title: "9-1-1 avec votre adresse", text: "Adresse enregistrée avant le premier appel. Le 9-1-1 n'est jamais bloqué par votre forfait.", link: { href: href(lang, "e911"), label: "Lire les limites" } },
  ],
  howTitle: "Prêt en trois étapes",
  steps: [
    { icon: "desk", title: "Ouvrez l'app", text: "Dans le navigateur à app.mimt.ca, ou sur iPhone et Android dès leur sortie." },
    { icon: "number", title: "Choisissez votre numéro", text: "Un numéro canadien neuf, ou transférez le vôtre sans frais. Ajoutez votre adresse pour le 9-1-1." },
    { icon: "phone", title: "Appelez et textez", text: "Par Wi‑Fi ou données, ici comme en voyage. Votre numéro vous suit partout." },
  ],
  plansTitle: "Commencez gratuitement. Montez d'un cran quand vous voulez.",
  plansLead: "Prix proposés pour le lancement. Chaque limite est écrite noir sur blanc, sans petits caractères cachés.",
  taxNote: "Prix en dollars canadiens, taxes en sus (TPS/TVQ) et taxe municipale 9-1-1 du Québec.",
  bizTitle: "Un standard téléphonique complet. Sans matériel. Sans technicien.",
  bizLead: "Une ligne par employé, sur cellulaire et ordinateur. Un accueil bilingue qui fait pro dès la première sonnerie, et un portail simple pour tout gérer.",
  biz: [
    { icon: "team", title: "Postes et numéros directs", text: "Chaque employé a son poste, son numéro et sa messagerie." },
    { icon: "menu", title: "Accueil bilingue", text: "« Pour le service en français, faites le 1. » Français d'abord." },
    { icon: "spark", title: "Réceptionniste IA", text: "Répond, renseigne sur vos heures et transfère au bon poste." },
    { icon: "phone", title: "Groupes de sonnerie", text: "Simultanés ou en séquence : personne ne manque un client." },
    { icon: "calendar", title: "Heures et fériés du Québec", text: "Ouvert, fermé, Saint-Jean : l'horaire se gère tout seul." },
    { icon: "admin", title: "Portail administrateur", text: "Ajoutez une ligne, changez un message, en quelques clics." },
    { icon: "record", title: "Enregistrement avec avis", text: "Avec Affaires Pro, toujours annoncé à l'autre personne." },
    { icon: "video", title: "Réunions vidéo", text: "Partage d'écran et invités par lien, dans la même app.", soon: true },
  ],
  aiTitle: "Une IA utile, jamais sans votre accord",
  aiLead: "Facultative et désactivée par défaut. Rien n'est envoyé à l'IA sans votre consentement distinct (Loi 25).",
  ai: [
    { icon: "voicemail", title: "Résumés vocaux", text: "Qui a appelé, pourquoi, et si c'est urgent, en une phrase." },
    { icon: "chat", title: "Réponses suggérées", text: "Trois réponses courtes à vos textos. Rien ne part sans vous." },
    { icon: "shield", title: "Spam probable", text: "Une étiquette « Spam probable » sur les appels et textos douteux. Rien n'est bloqué." },
    { icon: "spark", title: "Réceptionniste IA", text: "Pour les entreprises : il répond, renseigne et transfère." },
  ],
  webTitle: "Votre numéro, aussi sur l'ordinateur",
  webLead: "Avec l'app Web app.mimt.ca, appelez, textez et écoutez vos messages dans le navigateur, avec le même compte. Installable sur iPhone et Android en deux touches.",
  faqTitle: "Vos questions, nos réponses courtes",
  wlTitle: "Votre numéro, partout, dès aujourd'hui",
  wlLead: "Créez votre compte dans l'app Web en une minute, avec votre compte TAKATAK ou un code par texto.",
  qcText: "Conçu à Montréal, en français d'abord. MIMT fait partie de l'écosystème GROUPE TAKATAK.",
};

const EN: Copy = {
  pillQc: "Made in Québec",
  h1a: "Your number.",
  h1b: "Anywhere.",
  h1c: "No hidden fees.",
  leadStrong: "Your Canadian number, in an app.",
  lead: "Call and text over Wi‑Fi or data, on your phone and on your computer. Start at {free}.",
  ctaWeb: "Start free in the web app",
  ticks: ["A real Canadian number", "Free number transfer", "French first, bilingual"],
  heroNote: "A number of your own from {lock} a month. Without a number, MIMT stays free between users:",
  trustLabel: "Our commitments",
  trust: [
    { icon: "quebec", text: "Made in Québec" },
    { icon: "lang", text: "French first, bilingual" },
    { icon: "tag", text: "Prices shown, clear limits" },
    { icon: "shield", text: "AI only with your consent" },
  ],
  trust911: "9-1-1: know the limits",
  featuresTitle: "Everything a phone should do. In one app.",
  featuresLead: "Swipe, click or use your keyboard arrows.",
  slides: (lang) => [
    { icon: "number", tone: "blue", title: "A real Canadian number", text: "Pick your area code. Keep your current phone and add a second number, for work or personal life.", link: { href: href(lang, "plans"), label: "See plans" } },
    { icon: "wifi", tone: "cyan", title: "Calls and texts over Wi‑Fi", text: "At home or travelling: call and text across Canada and the US, over Wi‑Fi or data, within your plan." },
    { icon: "desk", tone: "deep", title: "On your computer too", text: "app.mimt.ca: same number, same account, right in your browser. Installs like an app.", link: { href: href(lang, "webapp"), label: "The web app" } },
    { icon: "transfer", tone: "blue", title: "Free number transfer", text: "Bring your current number. MIMT charges no transfer fee." },
    { icon: "voicemail", tone: "cyan", title: "Voicemail you can read", text: "Text transcription with Premium, a custom greeting and voicemail by email." },
    { icon: "spark", tone: "deep", title: "AI summaries", text: "Who called, why, and whether it's urgent: in one sentence. Only with your consent.", link: { href: href(lang, "ai"), label: "AI at MIMT" } },
    { icon: "shield", tone: "blue", title: "Likely spam", text: "A clear label on doubtful calls and texts. You decide: nothing is blocked without you." },
    { icon: "phone", tone: "cyan", title: "Your call rules", text: "Block a number, forward your calls, turn on Do Not Disturb at night. Depending on your plan." },
    { icon: "lock", tone: "deep", title: "Locked number", text: "Keep your number even when you rarely use it, with Number Lock or Premium." },
    { icon: "sos", tone: "blue", title: "9-1-1 with your address", text: "Address registered before your first call. 9-1-1 is never blocked by your plan.", link: { href: href(lang, "e911"), label: "Read the limits" } },
  ],
  howTitle: "Ready in three steps",
  steps: [
    { icon: "desk", title: "Open the app", text: "In your browser at app.mimt.ca, or on iPhone and Android as soon as they're out." },
    { icon: "number", title: "Pick your number", text: "A new Canadian number, or transfer yours at no charge. Add your address for 9-1-1." },
    { icon: "phone", title: "Call and text", text: "Over Wi‑Fi or data, at home or on the road. Your number follows you." },
  ],
  plansTitle: "Start free. Step up whenever you want.",
  plansLead: "Proposed launch prices. Every limit is written down, no hidden fine print.",
  taxNote: "Prices in Canadian dollars, taxes extra (GST/QST) and the Québec 9-1-1 municipal tax.",
  bizTitle: "A complete phone system. No hardware. No technician.",
  bizLead: "One line per employee, on mobile and desktop. A bilingual greeting that sounds professional from the first ring, and a simple portal to run it all.",
  biz: [
    { icon: "team", title: "Extensions and direct numbers", text: "Every employee gets an extension, a number and voicemail." },
    { icon: "menu", title: "Bilingual greeting", text: "“For service in English, press 2.” French first." },
    { icon: "spark", title: "AI receptionist", text: "Answers, gives your hours and transfers to the right extension." },
    { icon: "phone", title: "Ring groups", text: "Simultaneous or in sequence: no customer slips through." },
    { icon: "calendar", title: "Hours and Québec holidays", text: "Open, closed, Saint-Jean-Baptiste: the schedule runs itself." },
    { icon: "admin", title: "Admin portal", text: "Add a line, change a greeting, in a few clicks." },
    { icon: "record", title: "Recording with notice", text: "With Business Pro, always announced to the other party." },
    { icon: "video", title: "Video meetings", text: "Screen sharing and guest links, in the same app.", soon: true },
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
  webLead: "With the web app app.mimt.ca, call, text and play voicemail in your browser, with the same account. Installs on iPhone and Android in two taps.",
  faqTitle: "Your questions, short answers",
  wlTitle: "Your number, anywhere, starting today",
  wlLead: "Create your account in the web app in a minute, with your TAKATAK account or a code by text.",
  qcText: "Built in Montréal, French first. MIMT is part of the GROUPE TAKATAK ecosystem.",
};
