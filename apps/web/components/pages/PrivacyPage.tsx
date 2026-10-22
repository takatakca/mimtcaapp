import { PageHero, Shell } from "@/components/Shell";
import { LegalReview } from "@/components/LegalReview";
import { DEFAULT_RECORDING_POLICY } from "@mimt/shared";
import { CONTACT_EMAIL, TBC, href, type Lang } from "@/lib/site";

const PROCESSORS = [
  {
    name: "Twilio",
    fr: "Acheminement des appels et des textos, numéros de téléphone, service 9-1-1.",
    en: "Call and text routing, phone numbers, 9-1-1 service.",
  },
  { name: "Stripe", fr: "Paiements sur le Web et facturation.", en: "Web payments and billing." },
  {
    name: "Google",
    fr: "Notifications Android, achats sur Google Play, publicités sur mimt.ca et sur le forfait Gratuit (AdSense, AdMob).",
    en: "Android notifications, Google Play purchases, ads on mimt.ca and on the Free plan (AdSense, AdMob).",
  },
  { name: "Apple", fr: "Notifications iPhone et achats sur l'App Store.", en: "iPhone notifications and App Store purchases." },
  {
    name: "Supabase",
    fr: "Base de données et stockage du service (région Canada, ca-central-1, visée).",
    en: "Service database and storage (Canada region, ca-central-1, targeted).",
  },
  {
    name: "Anthropic (Claude)",
    fr: "Fonctions d'intelligence artificielle, seulement avec votre consentement ou, pour le réceptionniste IA, l'acceptation de l'entreprise. Traitement à l'extérieur du Canada.",
    en: "Artificial intelligence features, only with your consent or, for the AI receptionist, the business's acceptance. Processed outside Canada.",
  },
];

function Placeholder({ lang }: { lang: Lang }) {
  return <span className="placeholder">{TBC[lang]}</span>;
}

export function PrivacyPage({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  return (
    <Shell lang={lang} page="privacy">
      <PageHero
        eyebrow={fr ? "Légal" : "Legal"}
        title={fr ? "Politique de confidentialité" : "Privacy policy"}
        lead={fr ? "Ce que nous recueillons, pourquoi, et vos droits." : "What we collect, why, and your rights."}
      />
      <LegalReview note="section IA (consentement ai_processing), réceptionniste IA et enregistrement des appels; politique de confidentialité complète (Loi 25 / P-39.1, LPRPDE, règles de confidentialité du CRTC), liste des fournisseurs et transferts hors Québec" />
      <section className="section">
        <div className="container prose">
          <div className="notice notice--info" role="note">
            {fr
              ? "Version préliminaire, en cours de validation juridique. Elle sera finalisée avant le lancement du service."
              : "Preliminary version, under legal review. It will be finalized before the service launches."}
          </div>

          <h2 id="responsable">
            {fr ? "Responsable de la protection des renseignements personnels" : "Person in charge of the protection of personal information"}
          </h2>
          <address className="card contact-card">
            <strong>
              {fr ? "Nom et titre : " : "Name and title: "}
              <Placeholder lang={lang} />
            </strong>
            <br />
            MIMT · GROUPE TAKATAK
            <br />
            Montréal (Québec) Canada
            <br />
            {fr ? "Courriel : " : "Email: "}
            <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(fr ? "Confidentialité" : "Privacy")}`}>{CONTACT_EMAIL}</a>{" "}
            {fr ? "(objet « Confidentialité »). Adresse dédiée : " : "(subject “Privacy”). Dedicated address: "}
            <Placeholder lang={lang} />
          </address>

          {fr ? (
            <>
              <h2>Renseignements que nous recueillons</h2>
              <ul>
                <li>Compte : nom, courriel, numéro de téléphone vérifié, langue.</li>
                <li>9-1-1 : l&apos;adresse municipale que vous enregistrez, transmise aux services d&apos;urgence.</li>
                <li>Service : registres des appels et des textos (numéros, date, durée), messages vocaux, contenu des textos que vous envoyez ou recevez.</li>
                <li>Paiement : géré par Stripe, Apple ou Google. Nous ne conservons pas votre numéro de carte complet.</li>
                <li>Technique : modèle d&apos;appareil, version de l&apos;app, adresse IP, journaux pour la sécurité et la prévention de la fraude.</li>
                <li>Formulaires du site : ce que vous nous écrivez et votre choix de recevoir ou non nos nouvelles.</li>
              </ul>

              <h2>Pourquoi nous les utilisons</h2>
              <ul>
                <li>Fournir le service : acheminer vos appels et textos, la messagerie vocale et le 9-1-1.</li>
                <li>Facturer, prévenir la fraude et protéger le réseau.</li>
                <li>Vous répondre et vous aider.</li>
                <li>Respecter nos obligations légales et réglementaires.</li>
                <li>Publicités du forfait Gratuit : la personnalisation est <strong>désactivée par défaut</strong>; vous pouvez l&apos;activer dans l&apos;app.</li>
                <li>Courriels marketing : seulement avec votre consentement, distinct et facultatif. Désabonnement en tout temps.</li>
              </ul>
              <p>Nous ne vendons pas vos renseignements personnels.</p>

              <h2 id="donnees">Où sont vos données</h2>
              <p>
                La base de données et le stockage du service (comptes, registres d&apos;appels, textos, messages vocaux) sont prévus
                dans un centre de données au Canada (région ca-central-1). Certains fournisseurs, comme ceux qui acheminent les
                appels, traitent les paiements ou fournissent l&apos;IA, peuvent traiter des renseignements à l&apos;extérieur du
                Québec ou du Canada. Avant toute communication hors du Québec, nous évaluons les facteurs relatifs à la vie privée et
                concluons une entente écrite qui protège vos renseignements.
              </p>

              <h2 id="ia">Intelligence artificielle</h2>
              <p>
                MIMT offre des fonctions d&apos;IA fournies par Claude, d&apos;Anthropic : résumés de messages vocaux, réponses
                suggérées à vos textos et analyse des textos douteux. Ces fonctions sont <strong>facultatives et désactivées par
                défaut</strong>. Elles demandent votre consentement distinct (« traitement par l&apos;IA »), donné dans l&apos;app,
                séparé de l&apos;acceptation des conditions.
              </p>
              <ul>
                <li>Ce qui est envoyé : la transcription d&apos;un message vocal, ou les derniers messages d&apos;une conversation (au plus 10) pour suggérer une réponse.</li>
                <li>Sans votre consentement, rien n&apos;est envoyé au fournisseur d&apos;IA; les appels, les textos et la messagerie vocale fonctionnent normalement.</li>
                <li>Vous pouvez retirer votre consentement en tout temps dans l&apos;app.</li>
                <li>Le fournisseur d&apos;IA traite ces renseignements à l&apos;extérieur du Canada. Durée de conservation chez le fournisseur : <Placeholder lang={lang} /></li>
                <li>Les étiquettes « Spam probable » par règles simples (sans IA) s&apos;appliquent à tous et ne bloquent jamais un appel.</li>
              </ul>
              <p>
                <strong>Réceptionniste IA (MIMT Affaires).</strong> Quand une entreprise l&apos;active, l&apos;agent virtuel se
                présente comme une IA dès le début de l&apos;appel et avise que la conversation est transcrite. La conversation est
                traitée par le fournisseur d&apos;IA pour le compte de l&apos;entreprise, qui accepte d&apos;abord les conditions du
                réceptionniste IA. Les numéros de carte de paiement dictés pendant l&apos;appel sont masqués avant tout envoi.
              </p>

              <h2 id="enregistrement">Enregistrement des appels (MIMT Affaires)</h2>
              <p>
                Une entreprise abonnée à Affaires Pro peut enregistrer ses appels avec l&apos;extérieur. Un message avise toujours
                l&apos;autre personne avant tout enregistrement. Les enregistrements sont supprimés après{" "}
                {DEFAULT_RECORDING_POLICY.retentionDays} jours par défaut, ou selon le délai fixé par l&apos;entreprise. Pour un
                enregistrement vous concernant, adressez-vous d&apos;abord à l&apos;entreprise que vous avez appelée.
              </p>

              <h2>Nos fournisseurs</h2>
            </>
          ) : (
            <>
              <h2>Information we collect</h2>
              <ul>
                <li>Account: name, email, verified phone number, language.</li>
                <li>9-1-1: the civic address you register, sent to emergency services.</li>
                <li>Service: call and text records (numbers, date, duration), voicemails, content of texts you send or receive.</li>
                <li>Payment: handled by Stripe, Apple or Google. We don&apos;t keep your full card number.</li>
                <li>Technical: device model, app version, IP address, logs for security and fraud prevention.</li>
                <li>Website forms: what you write to us and whether you chose to receive our news.</li>
              </ul>

              <h2>Why we use it</h2>
              <ul>
                <li>Provide the service: route your calls and texts, voicemail and 9-1-1.</li>
                <li>Bill, prevent fraud and protect the network.</li>
                <li>Answer and help you.</li>
                <li>Meet our legal and regulatory obligations.</li>
                <li>Ads on the Free plan: personalization is <strong>off by default</strong>; you can turn it on in the app.</li>
                <li>Marketing emails: only with your separate, optional consent. Unsubscribe at any time.</li>
              </ul>
              <p>We don&apos;t sell your personal information.</p>

              <h2 id="donnees">Where your data is</h2>
              <p>
                The service database and storage (accounts, call records, texts, voicemails) are planned in a data centre in Canada
                (ca-central-1 region). Some providers, such as those that route calls, process payments or provide AI, may process
                information outside Québec or Canada. Before any transfer outside Québec, we assess the privacy factors and sign a
                written agreement that protects your information.
              </p>

              <h2 id="ia">Artificial intelligence</h2>
              <p>
                MIMT offers AI features provided by Claude, from Anthropic: voicemail summaries, suggested replies to your texts and
                checks of doubtful texts. These features are <strong>optional and off by default</strong>. They need your separate
                consent (“AI processing”), given in the app, apart from accepting the terms.
              </p>
              <ul>
                <li>What is sent: a voicemail transcript, or the latest messages of a conversation (10 at most) to suggest a reply.</li>
                <li>Without your consent, nothing is sent to the AI provider; calls, texts and voicemail work normally.</li>
                <li>You can withdraw your consent at any time in the app.</li>
                <li>The AI provider processes this information outside Canada. Retention period at the provider: <Placeholder lang={lang} /></li>
                <li>Rule-based “Likely spam” labels (no AI) apply to everyone and never block a call.</li>
              </ul>
              <p>
                <strong>AI receptionist (MIMT Business).</strong> When a business turns it on, the virtual agent says it is an AI at
                the start of the call and that the conversation is transcribed. The conversation is processed by the AI provider on
                behalf of the business, which first accepts the AI receptionist terms. Payment card numbers spoken during the call are masked before anything is sent.
              </p>

              <h2 id="enregistrement">Call recording (MIMT Business)</h2>
              <p>
                A business on Business Pro can record its calls with outside parties. A message always tells the other person before
                any recording. Recordings are deleted after {DEFAULT_RECORDING_POLICY.retentionDays} days by default, or after the
                period the business sets. For a recording about you, first contact the business you called.
              </p>

              <h2>Our providers</h2>
            </>
          )}
          <div className="table-wrap" role="region" aria-label={fr ? "Fournisseurs" : "Providers"} tabIndex={0}>
            <table className="simple">
              <thead>
                <tr>
                  <th scope="col">{fr ? "Fournisseur" : "Provider"}</th>
                  <th scope="col">{fr ? "Rôle" : "Role"}</th>
                </tr>
              </thead>
              <tbody>
                {PROCESSORS.map((p) => (
                  <tr key={p.name}>
                    <th scope="row">{p.name}</th>
                    <td>{p[lang]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {fr ? (
            <>
              <h2>Combien de temps nous les gardons</h2>
              <p>
                Seulement le temps nécessaire aux fins indiquées ou exigé par la loi. Durées précises par type de renseignement
                (registres d&apos;appels, textos, messages vocaux, adresse 9-1-1, consentements) : <Placeholder lang={lang} />
              </p>

              <h2>Vos droits</h2>
              <ul>
                <li>Accéder à vos renseignements et les faire corriger.</li>
                <li>Retirer votre consentement (par exemple aux courriels marketing).</li>
                <li>Recevoir vos renseignements dans un format technologique structuré et couramment utilisé (portabilité).</li>
                <li>Demander la désindexation ou la suppression lorsque la loi le permet.</li>
              </ul>
              <p>
                Écrivez au responsable ci-dessus. Nous répondons dans un délai de 30 jours. Vous pouvez aussi vous adresser à la
                Commission d&apos;accès à l&apos;information du Québec (cai.gouv.qc.ca) ou au Commissariat à la protection de la vie
                privée du Canada (priv.gc.ca).
              </p>

              <h2>Incidents de confidentialité</h2>
              <p>
                Si un incident présente un risque de préjudice sérieux, nous avisons la Commission d&apos;accès à l&apos;information
                et les personnes concernées, et nous tenons un registre des incidents.
              </p>

              <h2 id="temoins">Témoins (cookies) et publicités Google</h2>
              <p>
                mimt.ca et le forfait Gratuit de app.mimt.ca affichent des annonces de Google AdSense. Google et ses partenaires
                (des fournisseurs tiers) utilisent des témoins pour diffuser des annonces selon vos visites antérieures sur ce site
                et sur d&apos;autres sites. Les témoins publicitaires de Google lui permettent, ainsi qu&apos;à ses partenaires, de
                vous montrer des annonces fondées sur ces visites.
              </p>
              <ul>
                <li>
                  Sans votre accord, les témoins de personnalisation sont refusés et les annonces sont non personnalisées. Vous
                  choisissez dans la bannière, et vous pouvez changer d&apos;idée en tout temps avec le lien « Gérer les témoins »
                  au bas de chaque page.
                </li>
                <li>
                  Vous pouvez aussi désactiver la publicité personnalisée dans les{" "}
                  <a href="https://adssettings.google.com" rel="noopener">paramètres des annonces de Google</a>, ou les
                  témoins de fournisseurs tiers sur <a href="https://www.aboutads.info/choices/" rel="noopener">aboutads.info</a>.
                </li>
                <li>
                  Comment Google utilise ces données :{" "}
                  <a href="https://policies.google.com/technologies/partner-sites?hl=fr-CA" rel="noopener">
                    policies.google.com/technologies/partner-sites
                  </a>
                  .
                </li>
              </ul>
              <p>
                Mesure d&apos;audience : si vous l&apos;acceptez dans la même bannière, Google Analytics 4 et la mesure de
                conversion de Google Ads enregistrent des témoins pour compter les visites et les réservations de numéro. Sans
                votre accord, aucun témoin de mesure n&apos;est déposé. Nous n&apos;utilisons aucun autre outil de suivi.
              </p>
            </>
          ) : (
            <>
              <h2>How long we keep it</h2>
              <p>
                Only as long as needed for the stated purposes or as required by law. Specific periods per type of information (call
                records, texts, voicemails, 9-1-1 address, consents): <Placeholder lang={lang} />
              </p>

              <h2>Your rights</h2>
              <ul>
                <li>Access your information and have it corrected.</li>
                <li>Withdraw your consent (for example to marketing emails).</li>
                <li>Receive your information in a structured, commonly used technological format (portability).</li>
                <li>Ask for de-indexing or deletion where the law allows.</li>
              </ul>
              <p>
                Write to the person in charge above. We answer within 30 days. You can also contact the Commission d&apos;accès à
                l&apos;information du Québec (cai.gouv.qc.ca) or the Office of the Privacy Commissioner of Canada (priv.gc.ca).
              </p>

              <h2>Confidentiality incidents</h2>
              <p>
                If an incident presents a risk of serious injury, we notify the Commission d&apos;accès à l&apos;information and the
                people affected, and we keep an incident register.
              </p>

              <h2 id="temoins">Cookies and Google ads</h2>
              <p>
                mimt.ca and the Free plan of app.mimt.ca show Google AdSense ads. Google and its partners (third-party vendors)
                use cookies to serve ads based on your prior visits to this site and other sites. Google&apos;s advertising cookies
                let it and its partners serve you ads based on those visits.
              </p>
              <ul>
                <li>
                  Without your agreement, personalisation cookies are refused and ads are non-personalised. You choose in the
                  banner and can change your mind at any time with the &quot;Cookie settings&quot; link at the bottom of every page.
                </li>
                <li>
                  You can also turn off personalised advertising in{" "}
                  <a href="https://adssettings.google.com" rel="noopener">Google&apos;s ad settings</a>, or third-party vendor
                  cookies at <a href="https://www.aboutads.info/choices/" rel="noopener">aboutads.info</a>.
                </li>
                <li>
                  How Google uses this data:{" "}
                  <a href="https://policies.google.com/technologies/partner-sites?hl=en-CA" rel="noopener">
                    policies.google.com/technologies/partner-sites
                  </a>
                  .
                </li>
              </ul>
              <p>
                Audience measurement: if you accept in the same banner, Google Analytics 4 and Google Ads conversion measurement set
                cookies to count visits and number holds. Without your agreement, no measurement cookie is set. We use no other
                tracking tools.
              </p>
            </>
          )}
          <p className="fineprint">
            {fr ? "Dernière mise à jour : " : "Last updated: "}
            <Placeholder lang={lang} />
            {fr ? ". Voir aussi nos " : ". See also our "}
            <a href={href(lang, "terms")}>{fr ? "conditions" : "terms"}</a>.
          </p>
        </div>
      </section>
    </Shell>
  );
}
