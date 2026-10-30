import { PageHero, Shell } from "@/components/Shell";
import { FaqList } from "@/components/FaqList";
import { LeadForm } from "@/components/LeadForm";
import type { FaqItem } from "@/lib/faq";
import { faqPageLd } from "@/lib/seo";
import { APP_URL, CCTS_URL, CONTACT_EMAIL, href, type Lang, type RouteKey } from "@/lib/site";

/** Who to write to for what. Only channels that exist in the site and the app; delays only where already published. */
function channels(lang: Lang): { title: string; text: string; link: { href: string; label: string; external?: boolean } }[] {
  const fr = lang === "fr";
  const to = (key: RouteKey, hash?: string) => href(lang, key, hash);
  return fr
    ? [
        {
          title: "Une question sur MIMT",
          text: "Les réponses aux questions les plus fréquentes (forfaits, numéro, 9-1-1, IA, confidentialité) sont regroupées dans notre aide. Souvent, la réponse s'y trouve déjà.",
          link: { href: to("help"), label: "Lire l'aide et la FAQ" },
        },
        {
          title: "Vous êtes client",
          text: "Une fois connecté à l'app Web, la section Aide répond à partir des renseignements de MIMT et vous dirige vers notre équipe quand une personne doit prendre le relais.",
          link: { href: `${APP_URL}/aide`, label: "Ouvrir l'aide dans l'app", external: true },
        },
        {
          title: "MIMT Affaires",
          text: "Pour un système téléphonique d'entreprise, décrivez votre équipe et vos besoins : nombre de lignes, heures d'ouverture, accueil bilingue. Nous vous proposons une démonstration.",
          link: { href: to("business", "demo"), label: "Demander une démo" },
        },
        {
          title: "Une plainte",
          text: "Écrivez-nous avec le sujet « Plainte ». Nous accusons réception, vous donnons un numéro de dossier et visons une réponse complète en 10 jours ouvrables.",
          link: { href: to("complaints"), label: "Voir le processus de plaintes" },
        },
        {
          title: "Vos renseignements personnels",
          text: "Accès, correction, retrait du consentement ou portabilité : écrivez au responsable de la protection des renseignements personnels. Nous répondons dans un délai de 30 jours.",
          link: { href: to("privacy", "responsable"), label: "Joindre le responsable" },
        },
        {
          title: "Accessibilité",
          text: "Un obstacle sur le site ou dans l'app, ou besoin d'un document en format adapté (gros caractères, texte brut)? Les formats adaptés sont offerts sans frais.",
          link: { href: to("accessibility"), label: "Notre engagement en accessibilité" },
        },
        {
          title: "Médias et partenariats",
          text: "Journalistes, partenaires et organismes : choisissez le sujet « Médias et partenariats » dans le formulaire et décrivez votre demande.",
          link: { href: "#ecrire", label: "Aller au formulaire" },
        },
        {
          title: "Devenir agent affilié",
          text: "Pour recommander MIMT et recevoir une commission, la demande se fait en ligne avec un formulaire dédié.",
          link: { href: to("affiliates"), label: "Programme d'agents affiliés" },
        },
      ]
    : [
        {
          title: "A question about MIMT",
          text: "Answers to the most common questions (plans, numbers, 9-1-1, AI, privacy) are gathered on our help page. The answer is often already there.",
          link: { href: to("help"), label: "Read help and FAQ" },
        },
        {
          title: "You are a customer",
          text: "Once you are signed in to the web app, the Help section answers from MIMT's information and points you to our team when a person needs to step in.",
          link: { href: `${APP_URL}/aide`, label: "Open help in the app", external: true },
        },
        {
          title: "MIMT Business",
          text: "For a business phone system, describe your team and needs: number of lines, business hours, bilingual greeting. We'll offer you a demo.",
          link: { href: to("business", "demo"), label: "Request a demo" },
        },
        {
          title: "A complaint",
          text: "Write to us with the topic “Complaint”. We acknowledge it, give you a file number and aim to give a full answer within 10 business days.",
          link: { href: to("complaints"), label: "See the complaints process" },
        },
        {
          title: "Your personal information",
          text: "Access, correction, withdrawing consent or portability: write to the person in charge of the protection of personal information. We answer within 30 days.",
          link: { href: to("privacy", "responsable"), label: "Reach the privacy officer" },
        },
        {
          title: "Accessibility",
          text: "Found a barrier on the site or in the app, or need a document in an alternative format (large print, plain text)? Alternative formats are free.",
          link: { href: to("accessibility"), label: "Our accessibility commitment" },
        },
        {
          title: "Media and partnerships",
          text: "Journalists, partners and organizations: choose the topic “Media and partnerships” in the form and describe your request.",
          link: { href: "#ecrire", label: "Go to the form" },
        },
        {
          title: "Become an affiliate agent",
          text: "To recommend MIMT and earn a commission, apply online with a dedicated form.",
          link: { href: to("affiliates"), label: "Affiliate agent program" },
        },
      ];
}

function contactFaq(lang: Lang): FaqItem[] {
  return lang === "fr"
    ? [
        {
          id: "contact-langue",
          topic: "general",
          q: "Dans quelle langue puis-je vous écrire?",
          a: "En français ou en anglais. Le français est notre langue par défaut : le site, l'app, les conditions et le service sont offerts en français d'abord.",
        },
        {
          id: "contact-telephone",
          topic: "general",
          q: "Puis-je vous joindre par téléphone?",
          a: "Nous répondons par écrit : courriel, formulaire de contact et aide dans l'app. Indiquez votre numéro de téléphone dans votre message si vous préférez qu'on vous rappelle.",
        },
        {
          id: "contact-connexion",
          topic: "mobile",
          q: "Je n'arrive pas à me connecter. Que faire?",
          a: "Essayez la connexion avec un code reçu par texto sur votre numéro de cellulaire, ou avec votre compte TAKATAK. Si ça ne fonctionne toujours pas, écrivez-nous avec votre numéro MIMT et une description du problème, sans jamais inclure le code reçu.",
          link: { route: "webapp", label: "À propos de l'app Web" },
        },
        {
          id: "contact-annuler",
          topic: "legal",
          q: "Comment annuler mon abonnement?",
          a: "L'abonnement se résilie dans votre compte. Vous pouvez aussi nous écrire : précisez le numéro MIMT concerné.",
          link: { route: "terms", label: "Conditions d'utilisation" },
        },
        {
          id: "contact-suivi",
          topic: "legal",
          q: "Comment suivre une plainte déjà envoyée?",
          a: "Répondez au courriel d'accusé de réception en gardant le numéro de dossier. Si notre réponse ne vous satisfait pas, demandez une révision; si le problème n'est toujours pas réglé, vous pouvez vous adresser gratuitement à la CPRST.",
          link: { route: "complaints", label: "Processus de plaintes" },
        },
        {
          id: "contact-urgence",
          topic: "legal",
          q: "Et en cas d'urgence?",
          a: "N'utilisez jamais le courriel ou le formulaire pour une urgence : composez le 9-1-1. Avec un service de téléphonie par Internet, le 9-1-1 a des limites; lisez-les avant d'utiliser MIMT.",
          link: { route: "e911", label: "Limites du 9-1-1" },
        },
      ]
    : [
        {
          id: "contact-langue",
          topic: "general",
          q: "In which language can I write to you?",
          a: "French or English. French is our default language: the site, the app, the terms and the service are offered in French first.",
        },
        {
          id: "contact-telephone",
          topic: "general",
          q: "Can I reach you by phone?",
          a: "We answer in writing: email, contact form and help in the app. Include your phone number in your message if you would rather we call you back.",
        },
        {
          id: "contact-connexion",
          topic: "mobile",
          q: "I can't sign in. What should I do?",
          a: "Try signing in with a code sent by text to your mobile number, or with your TAKATAK account. If it still doesn't work, write to us with your MIMT number and a description of the problem, never including the code you received.",
          link: { route: "webapp", label: "About the web app" },
        },
        {
          id: "contact-annuler",
          topic: "legal",
          q: "How do I cancel my subscription?",
          a: "The subscription cancels in your account. You can also write to us: include the MIMT number concerned.",
          link: { route: "terms", label: "Terms of service" },
        },
        {
          id: "contact-suivi",
          topic: "legal",
          q: "How do I follow up on a complaint I already sent?",
          a: "Reply to the acknowledgment email, keeping the file number. If our answer doesn't satisfy you, ask for a review; if the problem still isn't resolved, you can go to the CCTS free of charge.",
          link: { route: "complaints", label: "Complaints process" },
        },
        {
          id: "contact-urgence",
          topic: "legal",
          q: "What about emergencies?",
          a: "Never use email or the form for an emergency: dial 9-1-1. With an internet phone service, 9-1-1 has limits; read them before using MIMT.",
          link: { route: "e911", label: "9-1-1 limitations" },
        },
      ];
}

export function ContactPage({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  const faq = contactFaq(lang);
  return (
    <Shell lang={lang} page="contact" ld={[faqPageLd(lang, faq, "contact")]}>
      <PageHero
        eyebrow={fr ? "Soutien" : "Support"}
        title={fr ? "Nous joindre" : "Contact us"}
        lead={
          fr
            ? "Une question, une plainte, un projet d'entreprise? Voici comment joindre l'équipe MIMT, en français ou en anglais, et à qui vous adresser selon votre demande."
            : "A question, a complaint, a business project? Here is how to reach the MIMT team, in French or English, and who to write to for each kind of request."
        }
      />
      <section className="section">
        <div className="container waitlist">
          <div>
            <h2>{fr ? "Par courriel" : "By email"}</h2>
            <p>
              <a className="big-link" href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>
            </p>
            <p>MIMT · GROUPE TAKATAK · Montréal (Québec)</p>
            <p>
              {fr
                ? "Une seule adresse pour toutes les demandes : indiquez le sujet dans l'objet du courriel (par exemple « Plainte », « Confidentialité » ou « Accessibilité ») pour que votre message aille directement à la bonne personne."
                : "One address for every request: put the topic in the subject line (for example “Complaint”, “Privacy” or “Accessibility”) so your message goes straight to the right person."}
            </p>
            <h2 className="mt-l">{fr ? "Raccourcis" : "Shortcuts"}</h2>
            <ul className="link-list">
              <li>
                <a href={href(lang, "help")}>{fr ? "Questions fréquentes" : "FAQ"}</a>
              </li>
              <li>
                <a href={href(lang, "guides")}>{fr ? "Guides pratiques" : "Practical guides"}</a>
              </li>
              <li>
                <a href={href(lang, "business", "demo")}>{fr ? "Demander une démo MIMT Affaires" : "Request a MIMT Business demo"}</a>
              </li>
              <li>
                <a href={href(lang, "complaints")}>{fr ? "Déposer une plainte" : "Make a complaint"}</a>
              </li>
              <li>
                <a href={href(lang, "privacy", "responsable")}>
                  {fr ? "Responsable de la protection des renseignements personnels" : "Privacy officer"}
                </a>
              </li>
            </ul>
          </div>
          <div className="card form-card" id="ecrire">
            <h2 className="form-card__title">{fr ? "Écrivez-nous" : "Write to us"}</h2>
            <LeadForm kind="contact" lang={lang} />
          </div>
        </div>
      </section>

      <section className="section section--tint" aria-labelledby="contact-who">
        <div className="container">
          <h2 id="contact-who">{fr ? "À qui s'adresser" : "Who to write to"}</h2>
          <ul className="grid grid--4 features">
            {channels(lang).map((c) => (
              <li className="card feature" key={c.title}>
                <h3>{c.title}</h3>
                <p>{c.text}</p>
                <p className="mt-s">
                  <a href={c.link.href} rel={c.link.external ? "noopener" : undefined}>
                    {c.link.label}
                  </a>
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section" aria-labelledby="contact-tips">
        <div className="container prose">
          <h2 id="contact-tips">{fr ? "Pour une réponse plus rapide" : "For a faster answer"}</h2>
          <ul>
            <li>{fr ? "Votre numéro MIMT, ou le courriel de votre compte." : "Your MIMT number, or your account email."}</li>
            <li>{fr ? "La date et l'heure approximatives du problème." : "The approximate date and time of the problem."}</li>
            <li>
              {fr
                ? "L'appareil utilisé (cellulaire ou ordinateur) et, pour l'app Web, le navigateur."
                : "The device used (mobile or computer) and, for the web app, the browser."}
            </li>
            <li>{fr ? "Ce que vous attendez de nous : une explication, une correction, un remboursement." : "What you expect from us: an explanation, a fix, a refund."}</li>
          </ul>
          <div className="notice notice--warn" role="note">
            {fr
              ? "N'envoyez jamais de mot de passe, de numéro de carte de paiement complet ni de code de connexion reçu par texto, même à nous."
              : "Never send a password, a full payment card number or a sign-in code you received by text, not even to us."}
          </div>

          <h2>{fr ? "Délais de réponse" : "Response times"}</h2>
          <p>
            {fr
              ? "Nous traitons les messages dans l'ordre où ils arrivent. Pour une plainte, nous visons une réponse complète en 10 jours ouvrables. Pour une demande d'accès ou de correction de vos renseignements personnels, nous répondons dans un délai de 30 jours."
              : "We handle messages in the order they arrive. For a complaint, we aim to give a full answer within 10 business days. For a request to access or correct your personal information, we answer within 30 days."}
          </p>

          <h2>{fr ? "Si nous ne réglons pas votre problème" : "If we don't resolve your problem"}</h2>
          <p>
            {fr ? "Après notre processus de plaintes, vous pouvez vous adresser gratuitement à la " : "After our complaints process, you can go to the "}
            <a href={CCTS_URL} rel="noopener">
              {fr
                ? "Commission des plaintes relatives aux services de télécom-télévision (CPRST)"
                : "Commission for Complaints for Telecom-television Services (CCTS)"}
            </a>
            {fr
              ? ", un organisme indépendant. Pour une question de renseignements personnels, la Commission d'accès à l'information du Québec peut aussi être saisie."
              : ", an independent body, free of charge. For a personal information matter, Québec's Commission d'accès à l'information can also be contacted."}
          </p>

          <h2>{fr ? "Questions sur la façon de nous joindre" : "Questions about reaching us"}</h2>
          <FaqList lang={lang} items={faq} />
        </div>
      </section>
    </Shell>
  );
}
