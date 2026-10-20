import { PageHero, Shell } from "@/components/Shell";
import { APP_URL, CONTACT_EMAIL, href, type Lang } from "@/lib/site";

export function AboutPage({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  return (
    <Shell lang={lang} page="about">
      <PageHero
        eyebrow={fr ? "À propos" : "About"}
        title={fr ? "Qui est derrière MIMT" : "Who is behind MIMT"}
        lead={
          fr
            ? "MIMT (Mobile Innovation Modern Telecommunications) est une entreprise de GROUPE TAKATAK, à Montréal."
            : "MIMT (Mobile Innovation Modern Telecommunications) is a GROUPE TAKATAK company based in Montréal."
        }
      />
      <section className="section">
        <div className="container prose">
          {fr ? (
            <>
              <h2>Ce que nous faisons</h2>
              <p>
                Nous donnons un vrai numéro canadien qui fonctionne dans une app : appels, textos et messagerie vocale par Wi‑Fi ou
                données, sur le téléphone ou dans le navigateur à <a href={APP_URL}>app.mimt.ca</a>. Pour les entreprises, MIMT
                Affaires remplace le système téléphonique de bureau.
              </p>
              <h2>Comment ça fonctionne</h2>
              <p>
                Les appels et les textos passent par le réseau de Twilio, un fournisseur de télécommunications reconnu. Le compte,
                la facturation et vos données sont gérés par MIMT. La connexion se fait avec votre compte TAKATAK ou un code par
                texto.
              </p>
              <h2>Nos engagements</h2>
              <ul>
                <li>Les prix et les limites de chaque forfait sont affichés avant l&apos;achat.</li>
                <li>Le 9-1-1 n&apos;est jamais bloqué, même sur le forfait Gratuit.</li>
                <li>Le site et l&apos;app sont en français d&apos;abord, aussi en anglais.</li>
                <li>Vos renseignements sont protégés selon la Loi 25.</li>
              </ul>
              <h2>Nous joindre</h2>
              <p>
                Courriel : <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Toutes les options sont sur la page{" "}
                <a href={href(lang, "contact")}>Nous joindre</a>.
              </p>
            </>
          ) : (
            <>
              <h2>What we do</h2>
              <p>
                We give you a real Canadian number that works in an app: calls, texts and voicemail over Wi‑Fi or data, on your
                phone or in the browser at <a href={APP_URL}>app.mimt.ca</a>. For businesses, MIMT Business replaces the office
                phone system.
              </p>
              <h2>How it works</h2>
              <p>
                Calls and texts travel over the network of Twilio, an established telecom provider. Your account, billing and data
                are run by MIMT. You sign in with your TAKATAK account or a code by text.
              </p>
              <h2>What we commit to</h2>
              <ul>
                <li>Every plan&apos;s price and limits are shown before you buy.</li>
                <li>9-1-1 is never blocked, even on the Free plan.</li>
                <li>The site and app are French first, English too.</li>
                <li>Your information is protected under Québec&apos;s Law 25.</li>
              </ul>
              <h2>Contact</h2>
              <p>
                Email: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Every option is on the{" "}
                <a href={href(lang, "contact")}>contact page</a>.
              </p>
            </>
          )}
        </div>
      </section>
    </Shell>
  );
}
