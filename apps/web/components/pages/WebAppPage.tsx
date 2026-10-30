import { PageHero, Shell } from "@/components/Shell";
import { Icon, type IconName } from "@/components/Visuals";
import { APP_URL, href, type Lang } from "@/lib/site";

const ITEMS: { icon: IconName; fr: [string, string]; en: [string, string] }[] = [
  {
    icon: "phone",
    fr: ["Appels dans le navigateur", "Un clavier et un micro suffisent : appelez et répondez avec votre numéro MIMT, sans rien installer."],
    en: ["Calls in the browser", "A keypad and a microphone are enough: call and answer with your MIMT number, nothing to install."],
  },
  {
    icon: "chat",
    fr: ["Textos", "Vos conversations, les mêmes que dans l'app mobile, avec les réponses suggérées par l'IA si vous les avez activées."],
    en: ["Texts", "Your conversations, the same as in the mobile app, with AI suggested replies if you turned them on."],
  },
  {
    icon: "voicemail",
    fr: ["Messagerie vocale", "Écoutez vos messages, lisez la transcription et le résumé selon votre forfait."],
    en: ["Voicemail", "Play your messages, read the transcript and summary depending on your plan."],
  },
  {
    icon: "admin",
    fr: ["Portail MIMT Affaires", "Pour les administrateurs : postes, menus vocaux, groupes de sonnerie, horaires, équipe et enregistrement."],
    en: ["MIMT Business portal", "For admins: extensions, voice menus, ring groups, hours, team and recording."],
  },
];

export function WebAppPage({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  return (
    <Shell lang={lang} page="webapp">
      <PageHero
        photo={{ name: "pro-bureau", alt: fr ? "Une professionnelle appelle depuis son bureau, ordinateur ouvert" : "A professional calls from her desk, laptop open" }}
        eyebrow={fr ? "App Web" : "Web app"}
        title={fr ? "MIMT sur votre ordinateur : app.mimt.ca" : "MIMT on your computer: app.mimt.ca"}
        lead={
          fr
            ? "Le même numéro et le même compte que sur votre téléphone, dans votre navigateur. Pour le bureau, le télétravail et la gestion de MIMT Affaires."
            : "The same number and account as on your phone, in your browser. For the office, remote work and managing MIMT Business."
        }
      />
      <section className="section" aria-labelledby="webapp-what">
        <div className="container">
          <div className="notice notice--info" role="note">
            {fr
              ? "Connectez-vous avec votre compte TAKATAK ou avec un code reçu par texto. Le compte est le même que dans l'app mobile."
              : "Sign in with your TAKATAK account or with a code sent by text. It is the same account as in the mobile app."}
          </div>
          <h2 id="webapp-what">{fr ? "Ce que vous pouvez faire" : "What you can do"}</h2>
          <ul className="grid grid--4 features">
            {ITEMS.map((it) => (
              <li className="card feature" key={it.en[0]}>
                <span className="feature__icon">
                  <Icon name={it.icon} />
                </span>
                <h3>{it[lang][0]}</h3>
                <p>{it[lang][1]}</p>
              </li>
            ))}
          </ul>
          <div className="cta-row mt-l">
            <a className="btn btn--primary btn--lg" href={APP_URL} rel="noopener">
              {fr ? "Ouvrir app.mimt.ca" : "Open app.mimt.ca"}
            </a>
            <a className="btn btn--outline btn--lg" href={href(lang, "plans")}>
              {fr ? "Voir les forfaits" : "See plans"}
            </a>
          </div>
        </div>
      </section>
      <section className="section section--tint" aria-labelledby="webapp-req">
        <div className="container prose">
          <h2 id="webapp-req">{fr ? "Ce qu'il faut" : "What you need"}</h2>
          <ul>
            <li>{fr ? "Un navigateur récent (Chrome, Edge, Firefox ou Safari) sur ordinateur." : "A recent browser (Chrome, Edge, Firefox or Safari) on a computer."}</li>
            <li>{fr ? "Un micro et des haut-parleurs ou un casque; le navigateur vous demandera l'accès au micro." : "A microphone and speakers or a headset; the browser will ask for microphone access."}</li>
            <li>{fr ? "Une connexion Internet stable." : "A stable internet connection."}</li>
            <li>{fr ? "Le même compte MIMT que dans l'app mobile." : "The same MIMT account as in the mobile app."}</li>
          </ul>
          <div className="notice notice--warn" role="note">
            {fr
              ? "Le 9-1-1 dans le navigateur a les mêmes limites que dans l'app : votre adresse enregistrée doit être celle où vous êtes. "
              : "9-1-1 in the browser has the same limits as in the app: your registered address must be where you are. "}
            <a href={href(lang, "e911")}>{fr ? "Lire la page 9-1-1" : "Read the 9-1-1 page"}</a>
          </div>
          <h2>{fr ? "Recevoir les appels et les textos" : "Getting calls and texts"}</h2>
          <p>
            {fr
              ? "Quand app.mimt.ca est ouvert et que vous êtes connecté, vos appels entrants sonnent dans le navigateur; vous pouvez aussi garder l'app sur votre cellulaire. Autorisez les notifications du navigateur pour être averti d'un texto ou d'un message vocal quand l'onglet n'est pas devant vous. Vos conversations, vos messages vocaux et votre historique d'appels sont les mêmes partout, puisqu'ils sont liés à votre compte et non à l'appareil."
              : "When app.mimt.ca is open and you are signed in, incoming calls ring in the browser; you can also keep the app on your mobile. Allow browser notifications to be told about a text or a voicemail when the tab isn't in front of you. Your conversations, voicemails and call history are the same everywhere, since they belong to your account, not to the device."}
          </p>
          <h2>{fr ? "Conseils pour de bons appels" : "Tips for good calls"}</h2>
          <ul>
            <li>{fr ? "Un casque avec micro évite l'écho et les bruits de clavier." : "A headset with a microphone avoids echo and keyboard noise."}</li>
            <li>{fr ? "Un câble réseau ou un Wi‑Fi proche du routeur donne une voix plus stable." : "A network cable or Wi‑Fi close to the router gives a steadier voice."}</li>
            <li>{fr ? "Fermez les gros téléchargements et la vidéo en haute définition pendant un appel important." : "Pause big downloads and high-definition video during an important call."}</li>
            <li>{fr ? "Si le navigateur a refusé le micro, autorisez-le dans les réglages du site (icône à gauche de l'adresse)." : "If the browser blocked the microphone, allow it in the site settings (icon left of the address)."}</li>
          </ul>
          <h2>{fr ? "Sécurité sur un ordinateur partagé" : "Security on a shared computer"}</h2>
          <p>
            {fr
              ? "Sur un ordinateur que d'autres personnes utilisent, déconnectez-vous à la fin de votre session. Dans Mon compte, la section Sécurité montre les appareils connectés à votre compte et vous permet d'en déconnecter un à distance; les sessions inutilisées sont supprimées après 90 jours."
              : "On a computer other people use, sign out at the end of your session. In My account, the Security section shows the devices signed in to your account and lets you sign one out remotely; unused sessions are deleted after 90 days."}
          </p>
        </div>
      </section>
    </Shell>
  );
}
