import { PageHero, Shell } from "@/components/Shell";
import { LeadForm } from "@/components/LeadForm";
import { AiDemo } from "@/components/AiDemo";
import { NumberPicker } from "@/components/NumberPicker";
import { FiveMinutes } from "@/components/FiveMinutes";
import { PlanCard } from "@/components/PlanCard";
import { Offers } from "@/components/Offers";
import { FaqList } from "@/components/FaqList";
import { Icon, type IconName } from "@/components/Visuals";
import { DEFAULT_RECORDING_POLICY, quebecHolidaysCurrentAndNext } from "@mimt/shared";
import { BUSINESS_PLANS, PLANS, formatCad } from "@/lib/plans-view";
import { faqByTopic } from "@/lib/faq";
import { serviceLd } from "@/lib/seo";
import { APP_URL, href, type Lang } from "@/lib/site";

type Status = "launch" | "planned";

const FEATURES: { icon: IconName; status: Status; fr: [string, string]; en: [string, string] }[] = [
  {
    icon: "phone",
    status: "launch",
    fr: ["Postes et numéros directs", "Chaque personne a son poste (3 ou 4 chiffres) et, si vous voulez, son propre numéro direct, sur cellulaire et ordinateur."],
    en: ["Extensions and direct numbers", "Everyone gets an extension (3 or 4 digits) and, if you want, a direct number, on mobile and computer."],
  },
  {
    icon: "menu",
    status: "launch",
    fr: ["Réceptionniste automatique bilingue", "« Pour les ventes, faites le 1. » Un menu vocal en français d'abord, avec l'anglais, en synthèse vocale ou avec votre propre message enregistré."],
    en: ["Bilingual auto-attendant", "“For sales, press 1.” A voice menu in French first, with English, using text-to-speech or your own recorded greeting."],
  },
  {
    icon: "team",
    status: "launch",
    fr: ["Groupes de sonnerie", "Faites sonner l'équipe des ventes ou du soutien en même temps ou à tour de rôle. Sans réponse : messagerie, autre groupe ou cellulaire."],
    en: ["Ring groups", "Ring the sales or support team all at once or in turn. No answer: voicemail, another group or a mobile."],
  },
  {
    icon: "calendar",
    status: "launch",
    fr: ["Heures d'ouverture et jours fériés du Québec", "Ouvert ou fermé selon votre horaire, à l'heure de Montréal. Fermeture automatique les jours fériés du Québec, plus vos propres congés."],
    en: ["Business hours and Québec holidays", "Open or closed on your schedule, in Montréal time. Automatic closing on Québec statutory holidays, plus your own days off."],
  },
  {
    icon: "record",
    status: "launch",
    fr: ["Enregistrement des appels avec avis", "Avec Affaires Pro. Un message avise toujours l'autre personne avant tout enregistrement. Suppression automatique après le délai choisi."],
    en: ["Call recording with notice", "With Business Pro. A message always tells the other person before any recording. Automatic deletion after the period you choose."],
  },
  {
    icon: "spark",
    status: "launch",
    fr: ["Réceptionniste IA", "Un agent virtuel répond, donne vos heures et vos réponses fréquentes, puis transfère l'appel ou prend un message. Il se présente toujours comme une IA."],
    en: ["AI receptionist", "A virtual agent answers, gives your hours and FAQ answers, then transfers the call or takes a message. It always says it is an AI."],
  },
  {
    icon: "voicemail",
    status: "launch",
    fr: ["Messagerie vocale par poste", "Une boîte vocale par poste ou par groupe, avec transcription et résumé IA (avec consentement)."],
    en: ["Voicemail per extension", "A voicemail box per extension or group, with transcription and an AI summary (with consent)."],
  },
  {
    icon: "number",
    status: "launch",
    fr: ["Renvoi vers un cellulaire", "Faites aussi sonner le cellulaire d'un employé, avec une confirmation « faites le 1 » pour que sa boîte vocale personnelle ne réponde pas à sa place."],
    en: ["Forward to a mobile", "Also ring an employee's mobile, with a “press 1” check so their personal voicemail never answers instead."],
  },
  {
    icon: "admin",
    status: "launch",
    fr: ["App Web et portail administrateur", "Appels et textos dans le navigateur à app.mimt.ca, et un portail pour gérer postes, menus, horaires et membres de l'équipe."],
    en: ["Web app and admin portal", "Calls and texts in the browser at app.mimt.ca, and a portal to manage extensions, menus, hours and team members."],
  },
  {
    icon: "chat",
    status: "planned",
    fr: ["Messagerie vocale par courriel", "Recevoir le message vocal et sa transcription par courriel. Prévu après le lancement."],
    en: ["Voicemail to email", "Get the voicemail and its transcription by email. Planned after launch."],
  },
  {
    icon: "globe",
    status: "planned",
    fr: ["Transfert de vos numéros actuels", "Garder le numéro de votre entreprise en le transférant chez MIMT. Prévu, date à confirmer."],
    en: ["Bring your current numbers", "Keep your business number by porting it to MIMT. Planned, date to be confirmed."],
  },
  {
    icon: "desk",
    status: "planned",
    fr: ["Téléphones de bureau", "Brancher des appareils de bureau compatibles. À l'étude; aucun appareil n'est requis au lancement."],
    en: ["Desk phones", "Connect compatible desk phones. Under study; no hardware is needed at launch."],
  },
];

const HOLIDAY_EN: Record<string, string> = {
  "Jour de l'An": "New Year's Day",
  "Vendredi saint": "Good Friday",
  "Lundi de Pâques": "Easter Monday",
  "Journée nationale des patriotes": "National Patriots' Day",
  "Fête nationale du Québec": "Fête nationale (Saint-Jean-Baptiste)",
  "Fête du Canada": "Canada Day",
  "Fête du Travail": "Labour Day",
  "Action de grâces": "Thanksgiving",
  "Noël": "Christmas Day",
};

function statusLabel(s: Status, fr: boolean) {
  if (s === "launch") return fr ? "Inclus" : "Included";
  return fr ? "Prévu ensuite" : "Planned";
}

export function BusinessPage({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  const locale = fr ? "fr-CA" : "en-CA";
  // Computed at build time from the same function the PBX uses: the next eight holidays.
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const holidays = quebecHolidaysCurrentAndNext(now.getFullYear())
    .filter((h) => h.date >= today)
    .slice(0, 8);
  const dateFmt = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const biz = PLANS.business;
  const pro = PLANS.business_pro;
  const examples = [1, 5, 10];
  const consent = DEFAULT_RECORDING_POLICY.consentPrompt;

  return (
    <Shell lang={lang} page="business" ld={[serviceLd(lang, "business")]}>
      <PageHero
        photo={{ name: "commerce-cafe", alt: fr ? "Un propriétaire de café au téléphone derrière son comptoir" : "A café owner on the phone behind his counter" }}
        eyebrow={fr ? "MIMT Affaires" : "MIMT Business"}
        title={fr ? "Le système téléphonique d'entreprise, en français d'abord" : "The business phone system, French first"}
        lead={
          fr
            ? `Postes, accueil bilingue, groupes de sonnerie, horaires et jours fériés du Québec, réceptionniste IA. À partir de ${formatCad(biz.monthlyPriceCents, lang)} par ligne par mois, sans appareil à acheter.`
            : `Extensions, bilingual greeting, ring groups, hours and Québec holidays, AI receptionist. From ${formatCad(biz.monthlyPriceCents, lang)} per line per month, no hardware to buy.`
        }
      />

      <FiveMinutes lang={lang} />

      <section className="section section--tint" id="numero" aria-labelledby="biz-number">
        <div className="container picker-band">
          <div>
            <h2 id="biz-number">{fr ? "Réservez le numéro de votre entreprise" : "Reserve your business number"}</h2>
            <p className="section-lead">
              {fr
                ? "Cherchez par indicatif ou par ville. Le numéro choisi est réservé 10 minutes, le temps de créer le compte et de payer la première ligne. Vous gardez aussi votre numéro actuel : le transfert est gratuit."
                : "Search by area code or city. The number you pick is held for 10 minutes while you create the account and pay for the first line. You can also keep your current number: transfer is free."}
            </p>
          </div>
          <NumberPicker lang={lang} plan="business" id="numero-affaires" />
        </div>
      </section>

      <section className="section section--dark ai-demo-band" id={fr ? "essai-ia" : "try-ai"} aria-labelledby="biz-aidemo">
        <div className="aurora" aria-hidden="true" />
        <div className="techgrid" aria-hidden="true" />
        <div className="container">
          <p className="kicker kicker--light live-dot">{fr ? "Réceptionniste IA, en direct" : "AI receptionist, live"}</p>
          <h2 id="biz-aidemo">{fr ? "Écoutez-la répondre à vos clients" : "Hear it answer your customers"}</h2>
          <p className="lead">
            {fr
              ? "Trois commerces fictifs, trois situations réelles. Ensuite, on la forme sur votre menu, vos heures et vos réponses."
              : "Three fictional businesses, three real situations. Then we train it on your menu, your hours and your answers."}
          </p>
          <AiDemo lang={lang} />
        </div>
      </section>

      <section className="section" aria-labelledby="biz-features">
        <div className="container">
          <h2 id="biz-features">{fr ? "Ce qui est inclus" : "What's included"}</h2>
          <p className="section-lead">
            {fr
              ? "Ce qui est inclus aujourd'hui, et ce qui viendra ensuite. Nous n'annonçons que ce qui est construit."
              : "What is included today, and what comes next. We only announce what is built."}
          </p>
          <ul className="grid grid--3 features">
            {FEATURES.map((f) => (
              <li className="card feature" key={f.en[0]}>
                <span className="feature__icon">
                  <Icon name={f.icon} />
                </span>
                <h3>{f[lang][0]}</h3>
                <p>{f[lang][1]}</p>
                <span className={`status status--${f.status}`}>{statusLabel(f.status, fr)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section section--tint" aria-labelledby="ivr-title">
        <div className="container split">
          <div>
            <p className="kicker">{fr ? "Accueil des appels" : "Call greeting"}</p>
            <h2 id="ivr-title">{fr ? "Un accueil clair, en français et en anglais" : "A clear greeting, in French and English"}</h2>
            <p>
              {fr
                ? "Vous composez le menu dans le portail : chaque touche mène à un poste, un groupe, une boîte vocale, le répertoire des postes ou le réceptionniste IA. Si personne n'appuie sur une touche, l'appel va où vous l'avez prévu."
                : "You build the menu in the portal: each key leads to an extension, a group, a voicemail box, the extension directory or the AI receptionist. If the caller presses nothing, the call goes where you planned."}
            </p>
            <p className="quote" lang="fr-CA">
              « Bonjour, vous avez joint Votre Entreprise. Pour les ventes, faites le 1. Pour le soutien, faites le 2. For service in English, press 9. »
            </p>
          </div>
          <ol className="callflow" aria-label={fr ? "Exemple de menu vocal" : "Example voice menu"}>
            <li>
              <kbd className="key">1</kbd>
              <p>
                <strong>{fr ? "Ventes" : "Sales"}</strong> — {fr ? "groupe de sonnerie, tous en même temps" : "ring group, everyone at once"}
              </p>
            </li>
            <li>
              <kbd className="key">2</kbd>
              <p>
                <strong>{fr ? "Soutien" : "Support"}</strong> — {fr ? "à tour de rôle, puis messagerie vocale" : "in turn, then voicemail"}
              </p>
            </li>
            <li>
              <kbd className="key">9</kbd>
              <p>
                <strong>English</strong> — {fr ? "le même menu, en anglais" : "the same menu, in English"}
              </p>
            </li>
            <li>
              <kbd className="key">#</kbd>
              <p>
                <strong>{fr ? "Répertoire" : "Directory"}</strong> — {fr ? "composer le numéro de poste" : "dial the extension number"}
              </p>
            </li>
            <li>
              <span className="key" aria-hidden="true">
                <Icon name="calendar" />
              </span>
              <p>
                <strong>{fr ? "Fermé" : "Closed"}</strong> — {fr ? "réceptionniste IA, cellulaire de garde ou messagerie" : "AI receptionist, on-call mobile or voicemail"}
              </p>
            </li>
          </ol>
        </div>
      </section>

      <section className="section" aria-labelledby="hours-title">
        <div className="container split">
          <div>
            <p className="kicker">{fr ? "Horaires" : "Hours"}</p>
            <h2 id="hours-title">{fr ? "Vos heures, nos jours fériés du Québec" : "Your hours, Québec's holidays"}</h2>
            <p>
              {fr
                ? "Fixez vos heures pour chaque jour de la semaine (heure de Montréal). Cochez « jours fériés du Québec » et le système ferme tout seul ces jours-là, selon la Loi sur les normes du travail. Ajoutez vos propres fermetures : vacances de la construction, inventaire, party de Noël."
                : "Set your hours for each day of the week (Montréal time). Check “Québec holidays” and the system closes on those days by itself, following Québec's labour standards. Add your own closures: construction holiday, inventory, holiday party."}
            </p>
            <p className="fineprint">
              {fr
                ? "Le Vendredi saint est utilisé par défaut; vous pouvez choisir le lundi de Pâques à la place."
                : "Good Friday is used by default; you can pick Easter Monday instead."}
            </p>
          </div>
          <div className="card">
            <h3>{fr ? "Prochains jours fériés du Québec" : "Upcoming Québec statutory holidays"}</h3>
            <ul className="holidays">
              {holidays.map((h) => (
                <li key={h.date}>
                  <time dateTime={h.date}>{dateFmt.format(new Date(`${h.date}T12:00:00Z`))}</time> —{" "}
                  {fr ? h.name : (HOLIDAY_EN[h.name] ?? h.name)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="section section--tint" aria-labelledby="rec-title">
        <div className="container split">
          <div>
            <p className="kicker">Affaires Pro</p>
            <h2 id="rec-title">{fr ? "Enregistrement des appels, avec avis" : "Call recording, with notice"}</h2>
            <p>
              {fr
                ? "Enregistrez tous les appels externes ou seulement à la demande. Dans les deux cas, l'autre personne entend un avis avant tout enregistrement, en français d'abord. Les appels internes ne sont pas enregistrés."
                : "Record every outside call or only on demand. Either way, the other person hears a notice before any recording, in French first. Internal calls are not recorded."}
            </p>
            <p>
              {fr
                ? `Les enregistrements sont supprimés automatiquement après ${DEFAULT_RECORDING_POLICY.retentionDays} jours par défaut. Vous pouvez changer ce délai et le message.`
                : `Recordings are deleted automatically after ${DEFAULT_RECORDING_POLICY.retentionDays} days by default. You can change the period and the message.`}
            </p>
          </div>
          <div className="card">
            <h3>{fr ? "Message par défaut" : "Default message"}</h3>
            <p className="quote" lang="fr-CA">
              « {consent.fr} »
            </p>
            <p className="quote" lang="en-CA">
              “{consent.en}”
            </p>
          </div>
        </div>
      </section>

      <section className="section" id="prix" aria-labelledby="biz-pricing">
        <div className="container">
          <h2 id="biz-pricing">{fr ? "Prix par ligne" : "Per-line pricing"}</h2>
          <p className="section-lead">
            {fr
              ? "Payez seulement pour les lignes que vous utilisez. Prix proposés pour le lancement, avant taxes (TPS/TVQ) et taxe municipale 9-1-1 du Québec."
              : "Pay only for the lines you use. Proposed launch prices, before taxes (GST/QST) and the Québec 9-1-1 municipal tax."}
          </p>
          <div className="grid grid--2">
            {BUSINESS_PLANS.map((c) => (
              <PlanCard key={c} plan={PLANS[c]} lang={lang} highlight={c === "business_pro"} />
            ))}
          </div>
          <div className="table-wrap" role="region" aria-labelledby="biz-examples" tabIndex={0}>
            <table className="simple">
              <caption id="biz-examples" className="sr-only">
                {fr ? "Exemples de coût mensuel selon le nombre de lignes, avant taxes" : "Monthly cost examples by number of lines, before taxes"}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{fr ? "Lignes" : "Lines"}</th>
                  <th scope="col">{biz.name[lang]}</th>
                  <th scope="col">{pro.name[lang]}</th>
                </tr>
              </thead>
              <tbody>
                {examples.map((n) => (
                  <tr key={n}>
                    <th scope="row">{n}</th>
                    <td>
                      {formatCad(n * biz.monthlyPriceCents, lang)}
                      {fr ? "/mois" : "/month"}
                    </td>
                    <td>
                      {formatCad(n * pro.monthlyPriceCents, lang)}
                      {fr ? "/mois" : "/month"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="fineprint">
            {fr
              ? "Les minutes sont comptées par ligne et mises en commun pour l'entreprise. "
              : "Minutes are counted per line and pooled across the business. "}
            <a href={href(lang, "plans")}>{fr ? "Comparer avec les forfaits MIMT Mobile" : "Compare with MIMT Mobile plans"}</a>
          </p>
          <Offers lang={lang} />
        </div>
      </section>

      <section className="section section--dark" aria-labelledby="biz-ai">
        <div className="container business-teaser__inner">
          <div>
            <p className="kicker kicker--light">{fr ? "Intelligence artificielle" : "Artificial intelligence"}</p>
            <h2 id="biz-ai">{fr ? "Un réceptionniste IA quand personne ne peut répondre" : "An AI receptionist when nobody can answer"}</h2>
            <p className="lead">
              {fr
                ? "Le soir, la fin de semaine ou à l'heure du dîner : il répond en français ou en anglais, renseigne sur vos heures et vos services, puis transfère l'appel ou prend un message."
                : "Evenings, weekends or lunch hour: it answers in French or English, explains your hours and services, then transfers the call or takes a message."}
            </p>
            <div className="cta-row">
              <a className="btn btn--primary" href={href(lang, "ai")}>
                {fr ? "Voir les fonctions IA" : "See AI features"}
              </a>
              <a className="btn btn--ghost" href={APP_URL} rel="noopener">
                {fr ? "Ouvrir app.mimt.ca" : "Open app.mimt.ca"}
              </a>
            </div>
          </div>
          <ul className="checklist checklist--light">
            <li>{fr ? "Se présente toujours comme une IA" : "Always says it is an AI"}</li>
            <li>{fr ? "Activé seulement après l'acceptation des conditions par l'entreprise" : "On only after the business accepts the terms"}</li>
            <li>{fr ? "Appels limités en durée et plafond de coût mensuel" : "Time-limited calls and a monthly cost cap"}</li>
            <li>{fr ? "Les numéros de carte de paiement ne sont jamais transmis" : "Payment card numbers are never passed on"}</li>
          </ul>
        </div>
      </section>

      <section className="section" aria-labelledby="biz-faq">
        <div className="container prose">
          <h2 id="biz-faq">{fr ? "Questions sur MIMT Affaires" : "MIMT Business questions"}</h2>
          <FaqList lang={lang} items={faqByTopic(lang, "business")} />
          <div className="notice notice--warn mt-l" role="note">
            {fr
              ? "Le 9-1-1 par Internet a des limites. Chaque ligne enregistre une adresse pour le 9-1-1; informez vos employés de ces limites. "
              : "9-1-1 over the internet has limits. Each line registers an address for 9-1-1; tell your employees about these limits. "}
            <a href={href(lang, "e911")}>{fr ? "Lire la page 9-1-1" : "Read the 9-1-1 page"}</a>
          </div>
        </div>
      </section>

      <section className="section section--tint" id="demo" aria-labelledby="demo-title">
        <div className="container waitlist">
          <div>
            <p className="kicker">{fr ? "Démo" : "Demo"}</p>
            <h2 id="demo-title">{fr ? "Demander une démo" : "Request a demo"}</h2>
            <p className="section-lead">
              {fr
                ? "Dites-nous combien de lignes il vous faut et comment vos clients vous joignent aujourd'hui. Nous vous montrerons MIMT Affaires dès qu'il sera prêt pour votre entreprise."
                : "Tell us how many lines you need and how customers reach you today. We'll show you MIMT Business as soon as it's ready for your company."}
            </p>
            <ul className="checklist">
              <li>{fr ? "Réponse en français ou en anglais" : "Answer in French or English"}</li>
              <li>{fr ? "Aucun engagement" : "No commitment"}</li>
            </ul>
          </div>
          <div className="card form-card">
            <LeadForm kind="demo" lang={lang} submitLabel={fr ? "Demander une démo" : "Request a demo"} />
          </div>
        </div>
      </section>
    </Shell>
  );
}
