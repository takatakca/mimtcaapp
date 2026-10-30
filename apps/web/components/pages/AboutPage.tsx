import { PageHero, Shell } from "@/components/Shell";
import { APP_URL, COMPANY, CONTACT_EMAIL, href, type Lang } from "@/lib/site";

/** Company facts the owner has confirmed (lib/site.ts COMPANY); a line appears only when its value is set. */
function CompanyFacts({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  const rows: [string, string][] = [];
  if (COMPANY.legalName) rows.push([fr ? "Raison sociale" : "Legal name", COMPANY.legalName]);
  if (COMPANY.president) rows.push([fr ? "Président" : "President", COMPANY.president]);
  if (COMPANY.founded) rows.push([fr ? "Fondation" : "Founded", COMPANY.founded]);
  if (COMPANY.address) rows.push([fr ? "Adresse" : "Address", COMPANY.address]);
  if (COMPANY.phone) rows.push([fr ? "Téléphone" : "Phone", COMPANY.phone]);
  if (rows.length === 0) return null;
  return (
    <dl className="facts">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AboutPage({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  return (
    <Shell lang={lang} page="about">
      <PageHero
        eyebrow={fr ? "À propos" : "About"}
        title={fr ? "Qui est derrière MIMT" : "Who is behind MIMT"}
        lead={
          fr
            ? "MIMT (Mobile Innovation Modern Telecommunications) est un service de télécommunications de GROUPE TAKATAK, à Montréal. Fait au Québec, en français d'abord."
            : "MIMT (Mobile Innovation Modern Telecommunications) is a telecommunications service of GROUPE TAKATAK, in Montréal. Made in Québec, French first."
        }
      />
      <section className="section">
        <div className="container prose">
          {fr ? (
            <>
              <h2>Notre mission</h2>
              <p>
                Rendre le téléphone simple, abordable et honnête pour les gens et les petites entreprises du Québec. Un numéro de
                téléphone ne devrait pas dépendre d&apos;un appareil, d&apos;une carte SIM ou d&apos;un contrat de deux ans. Il
                devrait vous suivre, sur votre cellulaire comme sur votre ordinateur, avec des prix affichés d&apos;avance, un
                service en français et des règles claires sur vos renseignements personnels.
              </p>
              <h2>Ce qu&apos;est MIMT</h2>
              <p>
                MIMT donne un vrai numéro canadien qui fonctionne dans une app : appels, textos et messagerie vocale par Wi‑Fi ou
                données, sur le téléphone ou dans le navigateur à <a href={APP_URL}>app.mimt.ca</a>. Il s&apos;ajoute à votre
                cellulaire : vous gardez votre forfait et votre numéro actuels, et vous ajoutez un deuxième numéro pour le travail,
                une petite annonce ou un projet. Le forfait Gratuit, sans numéro de téléphone, permet de texter et d&apos;appeler
                les autres utilisateurs MIMT avec un identifiant @nom.
              </p>
              <p>
                Pour les entreprises, MIMT Affaires remplace le système téléphonique de bureau : postes, accueil bilingue,
                groupes de sonnerie, heures d&apos;ouverture avec les jours fériés du Québec et, en option, un réceptionniste IA
                qui se présente toujours comme tel. Il n&apos;y a aucun appareil à acheter : les employés utilisent l&apos;app.
              </p>
              <h2>Ce que MIMT ne fait pas</h2>
              <p>
                MIMT n&apos;est pas un fournisseur cellulaire ni un fournisseur d&apos;Internet : le service a besoin d&apos;une
                connexion. Le 9-1-1 par Internet a des limites, que nous expliquons sur la page{" "}
                <a href={href(lang, "e911")}>9-1-1</a> avant toute utilisation. Nous ne vendons pas vos renseignements
                personnels et nous n&apos;affichons ni faux avis ni fausse urgence.
              </p>
              <h2>GROUPE TAKATAK</h2>
              <p>
                MIMT est un service de GROUPE TAKATAK, une entreprise de solutions numériques de Montréal (sites Web,
                hébergement, marketing, outils d&apos;IA et automatisation). GROUPE TAKATAK fournit aussi le compte qui permet de
                se connecter à MIMT. MIMT est dirigée par le président de GROUPE TAKATAK, qui est aussi le responsable de la
                protection des renseignements personnels au sens de la Loi 25. En savoir plus :{" "}
                <a href="https://takatak.ca" rel="noopener">
                  takatak.ca
                </a>
                .
              </p>
              <CompanyFacts lang={lang} />
              <h2>Fait au Québec</h2>
              <p>
                MIMT est conçu et exploité à Montréal. Le site, l&apos;app, les factures et le soutien sont en français
                d&apos;abord, aussi en anglais. Les heures d&apos;ouverture de MIMT Affaires connaissent les jours fériés du
                Québec, les numéros locaux couvrent les indicatifs de toute la province, et vos renseignements sont protégés selon
                la Loi 25.
              </p>
              <h2>Comment ça fonctionne</h2>
              <p>
                Les appels et les textos passent par le réseau de Twilio, un fournisseur de télécommunications reconnu, qui
                achemine aussi les appels au 9-1-1. Le compte, la facturation et vos données sont gérés par MIMT. Les paiements
                sur le Web passent par Stripe. La connexion se fait avec votre compte TAKATAK ou un code par texto. La liste de
                nos fournisseurs est dans notre <a href={href(lang, "privacy")}>politique de confidentialité</a>.
              </p>
              <h2>Nos engagements</h2>
              <ul>
                <li>Les prix et les limites de chaque forfait sont affichés avant l&apos;achat, taxes en sus clairement indiquées.</li>
                <li>Le 9-1-1 n&apos;est jamais bloqué, même sur le forfait Gratuit.</li>
                <li>Le transfert de votre numéro chez MIMT est sans frais MIMT, et vous pouvez repartir avec votre numéro.</li>
                <li>Le site et l&apos;app sont en français d&apos;abord, aussi en anglais.</li>
                <li>Les fonctions d&apos;IA sont facultatives et exigent votre consentement distinct.</li>
                <li>Vos renseignements sont protégés selon la Loi 25.</li>
              </ul>
              <h2>Nous joindre</h2>
              <p>
                Courriel : <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Toutes les options sont sur la page{" "}
                <a href={href(lang, "contact")}>Nous joindre</a>. Pour une plainte, voyez notre{" "}
                <a href={href(lang, "complaints")}>processus de plaintes</a>. Nos <a href={href(lang, "guides")}>guides pratiques</a>{" "}
                répondent aux questions courantes sur les numéros, le 9-1-1 et les arnaques.
              </p>
            </>
          ) : (
            <>
              <h2>Our mission</h2>
              <p>
                Make the phone simple, affordable and honest for people and small businesses in Québec. A phone number shouldn&apos;t
                depend on a device, a SIM card or a two-year contract. It should follow you, on your mobile as on your computer,
                with prices shown up front, service in French and clear rules about your personal information.
              </p>
              <h2>What MIMT is</h2>
              <p>
                MIMT gives you a real Canadian number that works in an app: calls, texts and voicemail over Wi‑Fi or data, on your
                phone or in the browser at <a href={APP_URL}>app.mimt.ca</a>. It adds to your mobile: you keep your current plan
                and number, and add a second number for work, a listing or a project. The Free plan, with no phone number, lets you
                text and call other MIMT users with an @name handle.
              </p>
              <p>
                For businesses, MIMT Business replaces the office phone system: extensions, bilingual greeting, ring groups,
                business hours with Québec statutory holidays and, as an option, an AI receptionist that always says it is one.
                There is no hardware to buy: staff use the app.
              </p>
              <h2>What MIMT does not do</h2>
              <p>
                MIMT is not a mobile carrier or an internet provider: the service needs a connection. 9-1-1 over the internet has
                limits, which we explain on the <a href={href(lang, "e911")}>9-1-1 page</a> before any use. We don&apos;t sell your
                personal information, and we show no fake reviews and no false urgency.
              </p>
              <h2>GROUPE TAKATAK</h2>
              <p>
                MIMT is a service of GROUPE TAKATAK, a Montréal digital solutions company (websites, hosting, marketing, AI tools
                and automation). GROUPE TAKATAK also provides the account you use to sign in to MIMT. MIMT is led by the president of
                GROUPE TAKATAK, who is also the person in charge of the protection of personal information under Law 25. Learn
                more at{" "}
                <a href="https://takatak.ca" rel="noopener">
                  takatak.ca
                </a>
                .
              </p>
              <CompanyFacts lang={lang} />
              <h2>Made in Québec</h2>
              <p>
                MIMT is designed and run in Montréal. The site, app, invoices and support are French first, English too. MIMT
                Business hours know Québec&apos;s statutory holidays, local numbers cover area codes across the province, and your
                information is protected under Law 25.
              </p>
              <h2>How it works</h2>
              <p>
                Calls and texts travel over the network of Twilio, an established telecom provider, which also routes 9-1-1 calls.
                Your account, billing and data are run by MIMT. Web payments go through Stripe. You sign in with your TAKATAK account
                or a code by text. The list of our providers is in our <a href={href(lang, "privacy")}>privacy policy</a>.
              </p>
              <h2>What we commit to</h2>
              <ul>
                <li>Every plan&apos;s price and limits are shown before you buy, with taxes clearly marked as extra.</li>
                <li>9-1-1 is never blocked, even on the Free plan.</li>
                <li>Transferring your number to MIMT has no MIMT fee, and you can leave with your number.</li>
                <li>The site and app are French first, English too.</li>
                <li>AI features are optional and need your separate consent.</li>
                <li>Your information is protected under Québec&apos;s Law 25.</li>
              </ul>
              <h2>Contact</h2>
              <p>
                Email: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Every option is on the{" "}
                <a href={href(lang, "contact")}>contact page</a>. For a complaint, see our{" "}
                <a href={href(lang, "complaints")}>complaints process</a>. Our <a href={href(lang, "guides")}>practical guides</a>{" "}
                answer common questions about numbers, 9-1-1 and scams.
              </p>
            </>
          )}
        </div>
      </section>
    </Shell>
  );
}
