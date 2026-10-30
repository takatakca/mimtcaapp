import { PageHero, Shell } from "@/components/Shell";
import { COMPANY, LEGAL_UPDATED, href, type Lang } from "@/lib/site";

// Legal review (lawyer): contract of adhesion, French version first, Québec Consumer Protection Act, Charter of the
// French language. Only what the code does is promised here (billing: Stripe customer portal, store subscriptions).

export function TermsPage({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  const sections = fr
    ? [
        [
          "Qui nous sommes",
          `MIMT (Mobile Innovation Modern Telecommunications) est un service de GROUPE TAKATAK, Montréal (Québec)${COMPANY.legalName ? `, exploité par ${COMPANY.legalName}` : ""}. Dans ces conditions, « MIMT », « nous » et « notre » désignent ce service; « vous » désigne la personne ou l'entreprise qui utilise MIMT.`,
        ],
        ["Le service", "MIMT fournit un numéro canadien et des appels, textos et messages vocaux par Internet, selon le forfait choisi. Le service exige une connexion Internet et un appareil compatible."],
        ["9-1-1", "Le 9-1-1 par Internet comporte des limites. Vous devez lire et accepter l'avis 9-1-1, enregistrer votre adresse et la garder à jour."],
        ["Forfaits, limites et prix", "Les prix, limites et options de chaque forfait sont affichés sur la page Forfaits. Les taxes (TPS/TVQ) et la taxe municipale 9-1-1 du Québec s'ajoutent. Nous vous avisons avant tout changement de prix."],
        ["Intelligence artificielle", "Les fonctions d'IA (résumés de messages vocaux, réponses suggérées, analyse de textos) sont facultatives et exigent votre consentement distinct, que vous pouvez retirer en tout temps. Les suggestions ne sont jamais envoyées sans votre action. L'IA peut se tromper : vérifiez les résumés importants en écoutant le message original."],
        ["MIMT Affaires", "L'entreprise cliente est responsable de l'usage de ses lignes. Si elle active l'enregistrement des appels, un avis est toujours présenté à l'autre personne avant l'enregistrement; l'entreprise fixe la durée de conservation. Si elle active le réceptionniste IA, elle accepte d'abord ses conditions, et l'agent se présente toujours comme une IA."],
        ["Utilisation acceptable", "Interdit : pourriel, fraude, harcèlement, appels ou textos automatisés non sollicités, revente du service. Nous pouvons suspendre une ligne pour protéger le réseau et les autres clients."],
        ["Numéros", "Le numéro du forfait Gratuit peut être récupéré après une période d'inactivité, avec avis préalable. Vous pouvez transférer votre numéro chez un autre fournisseur."],
        [
          "Annulation et remboursement",
          "Les forfaits payants sont des abonnements mensuels ou annuels qui se renouvellent à la fin de chaque période. Un abonnement payé sur le Web s'annule en tout temps dans l'app (Compte › « Gérer la facturation », portail de paiement sécurisé de Stripe); il n'est alors plus renouvelé. Un abonnement acheté dans l'App Store ou Google Play s'annule dans les réglages du magasin, reste actif jusqu'à la fin de la période déjà payée, et toute demande de remboursement suit les règles d'Apple ou de Google. La suppression du compte annule aussitôt les abonnements payés sur le Web. Pour le reste, les droits d'annulation et de remboursement sont ceux que prévoit la loi applicable, notamment la Loi sur la protection du consommateur du Québec; rien dans ces conditions ne limite ces droits.",
        ],
        [
          "Responsabilité",
          "MIMT fonctionne par Internet : la qualité des appels et des textos dépend de votre connexion, de votre appareil et des réseaux de nos fournisseurs. Le 9-1-1 comporte les limites décrites dans l'avis 9-1-1 (panne d'Internet ou de courant, adresse pas à jour, utilisation hors du Canada); lisez-le et gardez un autre moyen d'appeler les secours. Nous ne sommes pas responsables d'un usage contraire à ces conditions. Notre responsabilité est établie selon la loi applicable; aucune clause de ces conditions n'exclut ni ne limite une responsabilité que la Loi sur la protection du consommateur du Québec ou une autre loi d'ordre public interdit d'exclure ou de limiter.",
        ],
        ["Plaintes", "Voir notre processus de plaintes. Si votre plainte n'est pas réglée, vous pouvez vous adresser au CPRST."],
        ["Langue", "Ces conditions sont rédigées d'abord en français. Une version anglaise est offerte à votre demande expresse."],
        ["Droit applicable", "Les lois du Québec et les lois fédérales du Canada qui s'appliquent."],
      ]
    : [
        [
          "Who we are",
          `MIMT (Mobile Innovation Modern Telecommunications) is a service of GROUPE TAKATAK, Montréal, Québec${COMPANY.legalName ? `, operated by ${COMPANY.legalName}` : ""}. In these terms, “MIMT”, “we” and “our” mean this service; “you” means the person or business using MIMT.`,
        ],
        ["The service", "MIMT provides a Canadian number and calls, texts and voicemail over the internet, according to your plan. The service needs an internet connection and a compatible device."],
        ["9-1-1", "9-1-1 over the internet has limits. You must read and accept the 9-1-1 notice, register your address and keep it current."],
        ["Plans, limits and prices", "Each plan's prices, limits and add-ons are shown on the Plans page. Taxes (GST/QST) and the Québec 9-1-1 municipal tax are extra. We notify you before any price change."],
        ["Artificial intelligence", "AI features (voicemail summaries, suggested replies, text checks) are optional and need your separate consent, which you can withdraw at any time. Suggestions are never sent without your action. AI can make mistakes: check important summaries by playing the original message."],
        ["MIMT Business", "The business customer is responsible for how its lines are used. If it turns on call recording, a notice is always given to the other person before recording; the business sets the retention period. If it turns on the AI receptionist, it first accepts its terms, and the agent always says it is an AI."],
        ["Acceptable use", "Not allowed: spam, fraud, harassment, unsolicited automated calls or texts, reselling the service. We may suspend a line to protect the network and other customers."],
        ["Numbers", "A Free plan number may be reclaimed after a period of inactivity, with prior notice. You can port your number to another provider."],
        [
          "Cancellation and refunds",
          "Paid plans are monthly or yearly subscriptions that renew at the end of each period. A subscription paid on the web can be cancelled at any time in the app (Account › “Manage billing”, Stripe's secure payment portal); it then no longer renews. A subscription bought in the App Store or Google Play is cancelled in the store settings, stays active until the end of the period already paid, and any refund request follows Apple's or Google's rules. Deleting your account cancels web subscriptions at once. Otherwise, your cancellation and refund rights are those set by the applicable law, including Québec's Consumer Protection Act; nothing in these terms limits those rights.",
        ],
        [
          "Liability",
          "MIMT works over the internet: call and text quality depends on your connection, your device and our providers' networks. 9-1-1 has the limits described in the 9-1-1 notice (internet or power outage, address not up to date, use outside Canada); read it and keep another way to reach emergency services. We are not responsible for use that breaks these terms. Our liability is determined under the applicable law; no clause in these terms excludes or limits a liability that Québec's Consumer Protection Act or another public-order law forbids excluding or limiting.",
        ],
        ["Complaints", "See our complaints process. If your complaint is not resolved, you can go to the CCTS."],
        ["Language", "These terms are written first in French. This English version is provided at your express request."],
        ["Governing law", "The laws of Québec and the applicable federal laws of Canada."],
      ];
  return (
    <Shell lang={lang} page="terms">
      <PageHero
        eyebrow={fr ? "Légal" : "Legal"}
        title={fr ? "Conditions d'utilisation" : "Terms of service"}
        lead={fr ? "Les règles du service MIMT, en clair." : "The rules of the MIMT service, in plain words."}
      />
      <section className="section">
        <div className="container prose">
          <p className="legal-updated">
            {fr ? "Dernière mise à jour : " : "Last updated: "}
            <time dateTime={LEGAL_UPDATED.iso}>{LEGAL_UPDATED[lang]}</time>
            {fr ? null : (
              <>
                {" · "}
                <a href={href("fr", "terms")} hrefLang="fr-CA" lang="fr-CA">
                  Version française
                </a>
              </>
            )}
          </p>
          <p>
            {fr
              ? "Ces conditions forment le contrat entre vous et MIMT quand vous utilisez le site mimt.ca, l'application Web app.mimt.ca ou les applications MIMT. Elles sont écrites en langage clair. En créant un compte, vous les acceptez, ainsi que l'avis 9-1-1. Lisez aussi notre politique de confidentialité, qui explique comment nous traitons vos renseignements personnels."
              : "These terms are the contract between you and MIMT when you use the mimt.ca website, the app.mimt.ca web app or the MIMT apps. They are written in plain language. By creating an account, you accept them and the 9-1-1 notice. Please also read our privacy policy, which explains how we handle your personal information."}
          </p>
          <ol className="terms">
            {sections.map(([title, text]) => (
              <li key={title}>
                <h2>{title}</h2>
                <p>{text}</p>
              </li>
            ))}
          </ol>
          <p>
            {fr ? "Voir aussi : " : "See also: "}
            <a href={href(lang, "e911")}>9-1-1</a> · <a href={href(lang, "privacy")}>{fr ? "Confidentialité" : "Privacy"}</a> ·{" "}
            <a href={href(lang, "complaints")}>{fr ? "Plaintes" : "Complaints"}</a> ·{" "}
            <a href={href(lang, "plans")}>{fr ? "Forfaits" : "Plans"}</a>
          </p>
        </div>
      </section>
    </Shell>
  );
}
