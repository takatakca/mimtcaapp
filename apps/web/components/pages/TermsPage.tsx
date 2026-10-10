import { PageHero, Shell } from "@/components/Shell";
import { LegalReview } from "@/components/LegalReview";
import { TBC, href, type Lang } from "@/lib/site";

export function TermsPage({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  const sections = fr
    ? [
        ["Qui nous sommes", `MIMT (Mobile Innovation Modern Telecommunications) est exploité par ${TBC.fr} (raison sociale), membre de l'écosystème GROUPE TAKATAK, Montréal (Québec).`],
        ["Le service", "MIMT fournit un numéro canadien et des appels, textos et messages vocaux par Internet, selon le forfait choisi. Le service exige une connexion Internet et un appareil compatible."],
        ["9-1-1", "Le 9-1-1 par Internet comporte des limites. Vous devez lire et accepter l'avis 9-1-1, enregistrer votre adresse et la garder à jour."],
        ["Forfaits, limites et prix", "Les prix, limites et options de chaque forfait sont affichés sur la page Forfaits. Les taxes (TPS/TVQ) et la taxe municipale 9-1-1 du Québec s'ajoutent. Nous vous avisons avant tout changement de prix."],
        ["Intelligence artificielle", "Les fonctions d'IA (résumés de messages vocaux, réponses suggérées, analyse de textos) sont facultatives et exigent votre consentement distinct, que vous pouvez retirer en tout temps. Les suggestions ne sont jamais envoyées sans votre action. L'IA peut se tromper : vérifiez les résumés importants en écoutant le message original."],
        ["MIMT Affaires", "L'entreprise cliente est responsable de l'usage de ses lignes. Si elle active l'enregistrement des appels, un avis est toujours présenté à l'autre personne avant l'enregistrement; l'entreprise fixe la durée de conservation. Si elle active le réceptionniste IA, elle accepte d'abord ses conditions, et l'agent se présente toujours comme une IA."],
        ["Utilisation acceptable", "Interdit : pourriel, fraude, harcèlement, appels ou textos automatisés non sollicités, revente du service. Nous pouvons suspendre une ligne pour protéger le réseau et les autres clients."],
        ["Numéros", "Le numéro du forfait Gratuit peut être récupéré après une période d'inactivité, avec avis préalable. Vous pouvez transférer votre numéro chez un autre fournisseur."],
        ["Annulation et remboursement", `${TBC.fr} — selon la Loi sur la protection du consommateur du Québec et les règles des boutiques d'applications.`],
        ["Responsabilité", TBC.fr],
        ["Plaintes", "Voir notre processus de plaintes. Si votre plainte n'est pas réglée, vous pouvez vous adresser au CPRST."],
        ["Langue", "Ces conditions sont rédigées d'abord en français. Une version anglaise est offerte à votre demande expresse."],
        ["Droit applicable", "Les lois du Québec et les lois fédérales du Canada qui s'appliquent."],
      ]
    : [
        ["Who we are", `MIMT (Mobile Innovation Modern Telecommunications) is operated by ${TBC.en} (legal name), a member of the GROUPE TAKATAK ecosystem, Montréal, Québec.`],
        ["The service", "MIMT provides a Canadian number and calls, texts and voicemail over the internet, according to your plan. The service needs an internet connection and a compatible device."],
        ["9-1-1", "9-1-1 over the internet has limits. You must read and accept the 9-1-1 notice, register your address and keep it current."],
        ["Plans, limits and prices", "Each plan's prices, limits and add-ons are shown on the Plans page. Taxes (GST/QST) and the Québec 9-1-1 municipal tax are extra. We notify you before any price change."],
        ["Artificial intelligence", "AI features (voicemail summaries, suggested replies, text checks) are optional and need your separate consent, which you can withdraw at any time. Suggestions are never sent without your action. AI can make mistakes: check important summaries by playing the original message."],
        ["MIMT Business", "The business customer is responsible for how its lines are used. If it turns on call recording, a notice is always given to the other person before recording; the business sets the retention period. If it turns on the AI receptionist, it first accepts its terms, and the agent always says it is an AI."],
        ["Acceptable use", "Not allowed: spam, fraud, harassment, unsolicited automated calls or texts, reselling the service. We may suspend a line to protect the network and other customers."],
        ["Numbers", "A Free plan number may be reclaimed after a period of inactivity, with prior notice. You can port your number to another provider."],
        ["Cancellation and refunds", `${TBC.en} — under the Québec Consumer Protection Act and app store rules.`],
        ["Liability", TBC.en],
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
      <LegalReview note="conditions d'utilisation (contrat d'adhésion, version française d'abord, LPC du Québec, Charte de la langue française)" />
      <section className="section">
        <div className="container prose">
          <div className="notice notice--info" role="note">
            {fr
              ? "Version préliminaire, en cours de validation juridique. La version finale vous sera présentée avant toute inscription."
              : "Preliminary version, under legal review. The final version will be shown to you before any sign-up."}
            {fr ? null : (
              <>
                {" "}
                <a href={href("fr", "terms")} hrefLang="fr-CA" lang="fr-CA">
                  Version française
                </a>
              </>
            )}
          </div>
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
