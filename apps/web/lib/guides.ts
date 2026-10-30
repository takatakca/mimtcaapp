// « Guides »: practical articles for people in Québec about phone numbers, 9-1-1, scams and small-business phones.
// Rules (same as the rest of the site): French first, only facts we can source, official bodies named with links,
// prices from @mimt/shared, no competitor or carrier names, no urgency wording.
// Inline links use [label](href); lib/guides-render turns them into <a> elements.

import { PLANS, formatCad } from "@mimt/shared";
import { cityAreaCodes } from "./landing.ts";
import { CCTS_URL, ROUTES, type Lang, type RouteKey } from "./site.ts";

export interface GuideBlock {
  h2: string;
  p?: string[];
  ul?: string[];
  ol?: string[];
}

export interface GuideSource {
  label: string;
  url: string;
}

export interface GuideCopy {
  /** Page heading. */
  h1: string;
  /** <title> (without the " | MIMT" suffix) and meta description: search-result lengths. */
  title: string;
  description: string;
  /** Short summary for the guides index card. */
  summary: string;
  intro: string;
  body: GuideBlock[];
  sources: GuideSource[];
}

export interface Guide {
  id: string;
  slug: Record<Lang, string>;
  /** ISO date of the last factual review. */
  updated: string;
  related: RouteKey[];
  copy: (lang: Lang) => GuideCopy;
}

/** Official sources, checked 2026-10-29. */
const SRC = {
  crtcPort: { fr: "https://crtc.gc.ca/fra/phone/mobile/num.htm", en: "https://crtc.gc.ca/eng/phone/mobile/num.htm" },
  crtc911: { fr: "https://crtc.gc.ca/fra/phone/911/voip.htm", en: "https://crtc.gc.ca/eng/phone/911/voip.htm" },
  crtcFraud: { fr: "https://crtc.gc.ca/fra/phone/telemarketing/fraud.htm", en: "https://crtc.gc.ca/eng/phone/telemarketing/fraud.htm" },
  dncl: { fr: "https://lnnte-dncl.gc.ca/fr", en: "https://lnnte-dncl.gc.ca/en" },
  cafc: { fr: "https://www.antifraudcentre-centreantifraude.ca/index-fra.htm", en: "https://www.antifraudcentre-centreantifraude.ca/index-eng.htm" },
  cai: { fr: "https://www.cai.gouv.qc.ca", en: "https://www.cai.gouv.qc.ca" },
  law25: {
    fr: "https://www.cai.gouv.qc.ca/protection-renseignements-personnels/sujets-et-domaines-dinteret/principaux-changements-loi-25",
    en: "https://www.cai.gouv.qc.ca/protection-renseignements-personnels/sujets-et-domaines-dinteret/principaux-changements-loi-25",
  },
} as const;

const r = (lang: Lang, key: RouteKey, hash?: string) => ROUTES[key][lang] + (hash ? `#${hash}` : "");

// ---------------------------------------------------------------------------------------------------------------
// 1. Keeping your number when you switch providers

const porting: Guide = {
  id: "transfert",
  slug: { fr: "garder-son-numero-transfert", en: "keep-your-number-porting" },
  updated: "2026-10-29",
  related: ["useVirtual", "e911", "help"],
  copy: (lang) =>
    lang === "fr"
      ? {
          h1: "Garder son numéro en changeant de fournisseur au Québec",
          title: "Transfert de numéro : garder son numéro au Québec",
          description:
            "Comment transférer votre numéro de téléphone chez un nouveau fournisseur au Québec : étapes, renseignements à préparer, délais, frais et cas de la VoIP.",
          summary: "Les étapes d'un transfert de numéro, ce qu'il faut préparer, les délais et le cas particulier de la téléphonie par Internet.",
          intro:
            "Changer de fournisseur de téléphone ne veut pas dire changer de numéro. Au Canada, la transférabilité des numéros permet souvent de garder le même numéro d'un fournisseur à l'autre. Voici comment ça se passe, ce qu'il faut préparer et les pièges à éviter, surtout quand un service de téléphonie par Internet (VoIP) est en cause.",
          body: [
            {
              h2: "Le principe : c'est le nouveau fournisseur qui fait la demande",
              p: [
                "Le Conseil de la radiodiffusion et des télécommunications canadiennes (CRTC) recommande de demander à votre nouveau fournisseur de transférer vos services en votre nom. Vous n'avez pas à appeler votre fournisseur actuel : le nouveau envoie la demande de transfert, et l'ancien service est annulé quand le numéro a changé de mains.",
                "Le CRTC précise aussi qu'aucun préavis de 30 jours n'est nécessaire pour annuler un service de téléphonie, de cellulaire, d'Internet ou de télévision.",
              ],
            },
            {
              h2: "La règle d'or : ne résiliez pas avant le transfert",
              p: [
                "Si vous annulez votre service actuel avant que le nouveau fournisseur ait lancé le transfert, le numéro reste chez votre ancien fournisseur et vous risquez de le perdre pour de bon. Gardez l'ancien service actif, payez ce qui est dû et laissez le transfert fermer le compte pour vous.",
              ],
            },
            {
              h2: "Les renseignements à préparer",
              ul: [
                "Le nom du titulaire du compte, écrit exactement comme sur la facture (pour une entreprise, son nom légal).",
                "Le numéro de compte chez le fournisseur actuel; il figure sur la facture.",
                "L'adresse de service liée au compte.",
                "Le NIP ou le mot de passe de transfert, si votre fournisseur en utilise un (c'est fréquent pour les cellulaires).",
                "Une facture récente, que certains fournisseurs demandent pour confirmer le compte.",
                "La liste complète des numéros à transférer, si vous en avez plusieurs.",
              ],
              p: [
                "La plupart des refus viennent d'une petite différence : une lettre dans le nom, un ancien numéro de compte, une adresse qui ne correspond pas. Vérifiez ces renseignements avant d'envoyer la demande : vous gagnerez des jours.",
              ],
            },
            {
              h2: "Le cas particulier de la téléphonie par Internet (VoIP)",
              p: [
                "Le CRTC indique qu'on peut garder son numéro entre lignes terrestres et cellulaires, mais qu'on pourrait devoir changer de numéro en passant d'une ligne terrestre ou d'un cellulaire vers un service VoIP, ou l'inverse. Tout dépend du numéro, de sa zone d'appel local et des ententes du fournisseur.",
                "Avant de vous engager, demandez au nouveau fournisseur de confirmer que votre numéro précis peut être transféré chez lui. Si vous déménagez dans une autre province ou une autre zone d'appel local, posez la même question : le numéro pourrait ne pas suivre.",
              ],
            },
            {
              h2: "Combien de temps ça prend",
              p: [
                "Selon le CRTC, un transfert entre cellulaires peut se faire en quelques heures, et un transfert entre une ligne terrestre et un cellulaire prend généralement deux jours ouvrables. Quand un service VoIP est en cause, le délai dépend des fournisseurs : prévoyez quelques jours ouvrables, parfois davantage si un renseignement doit être corrigé.",
                "Pendant la bascule, une courte interruption est possible, y compris du 9-1-1. Le jour prévu, gardez un autre moyen d'appeler à portée de main. Il arrive aussi que les appels arrivent sur le nouveau service quelques heures avant les textos, ou l'inverse; si la situation dure, avisez le nouveau fournisseur.",
              ],
            },
            {
              h2: "Les frais à prévoir",
              p: [
                "Le transfert lui-même est souvent gratuit, mais votre contrat actuel peut prévoir des frais d'annulation. Pour les contrats de cellulaire, le CRTC encadre ces frais : ils diminuent chaque mois et doivent atteindre 0 $ au plus tard après 24 mois. Un contrat sans date de fin ne peut pas entraîner de frais d'annulation.",
                "Réglez aussi tout solde impayé : le CRTC rappelle qu'il faut payer ce qui est dû et régler les problèmes de compte avant d'annuler ou de transférer un service.",
              ],
            },
            {
              h2: "Après le transfert",
              ul: [
                "Faites un appel et envoyez un texto de test, dans les deux sens.",
                "Mettez à jour l'adresse 9-1-1 associée au numéro chez le nouveau fournisseur.",
                "Vérifiez que vos comptes importants (banque, impôts, courriel) reçoivent bien leurs codes de vérification.",
                "Conservez la confirmation du transfert et la dernière facture de l'ancien fournisseur.",
              ],
            },
            {
              h2: "Avec MIMT",
              p: [
                `MIMT ne facture aucuns frais de transfert de numéro. Le transfert vers MIMT se fait en ligne, avec une autorisation signée électroniquement; les frais ou le contrat de votre fournisseur actuel restent de votre responsabilité. Une fois transféré, le numéro utilise l'adresse 9-1-1 inscrite dans votre compte MIMT : vérifiez-la avant la date prévue. Si vous quittez MIMT un jour, votre nouveau fournisseur pourra demander le transfert de votre numéro, selon les mêmes règles. Les réponses courtes sont dans notre [aide](${r("fr", "help")}).`,
              ],
            },
            {
              h2: "En résumé",
              ol: [
                "Confirmez que votre numéro peut être transféré vers le nouveau service.",
                "Rassemblez les renseignements exacts du compte actuel.",
                "Demandez le transfert au nouveau fournisseur, pas à l'ancien.",
                "Gardez l'ancien service actif jusqu'à la confirmation du transfert.",
                "Testez les appels et les textos, puis mettez à jour l'adresse 9-1-1.",
              ],
              p: [`En cas de différend avec un fournisseur que vous n'arrivez pas à régler, la [Commission des plaintes relatives aux services de télécom-télévision (CPRST)](${CCTS_URL}) peut vous aider gratuitement.`],
            },
          ],
          sources: [
            { label: "CRTC : Changez de fournisseur et conservez votre numéro", url: SRC.crtcPort.fr },
            { label: "CPRST : Commission des plaintes relatives aux services de télécom-télévision", url: CCTS_URL },
          ],
        }
      : {
          h1: "Keeping your number when you switch providers in Québec",
          title: "Number transfer: keep your number in Québec",
          description:
            "How to transfer your phone number to a new provider in Québec: steps, information to prepare, timelines, fees and the special case of VoIP.",
          summary: "The steps of a number transfer, what to prepare, how long it takes and the special case of internet phone service.",
          intro:
            "Switching phone providers doesn't have to mean switching numbers. In Canada, number portability often lets you keep the same number from one provider to the next. Here is how it works, what to prepare and the traps to avoid, especially when an internet phone (VoIP) service is involved.",
          body: [
            {
              h2: "The principle: the new provider makes the request",
              p: [
                "The Canadian Radio-television and Telecommunications Commission (CRTC) recommends asking your new provider to transfer your services on your behalf. You don't have to call your current provider: the new one sends the transfer request, and the old service is cancelled once the number has moved.",
                "The CRTC also notes that no 30-day notice is needed to cancel a phone, mobile, internet or TV service.",
              ],
            },
            {
              h2: "The golden rule: don't cancel before the transfer",
              p: [
                "If you cancel your current service before the new provider has started the transfer, the number stays with your old provider and you may lose it for good. Keep the old service active, pay what is owed and let the transfer close the account for you.",
              ],
            },
            {
              h2: "Information to prepare",
              ul: [
                "The account holder's name, spelled exactly as on the bill (for a business, its legal name).",
                "The account number with your current provider; it is on the bill.",
                "The service address on the account.",
                "The transfer PIN or password, if your provider uses one (common for mobiles).",
                "A recent bill, which some providers ask for to confirm the account.",
                "The full list of numbers to transfer, if you have several.",
              ],
              p: [
                "Most rejections come from a small mismatch: one letter in the name, an old account number, an address that doesn't match. Check these details before sending the request: it saves days.",
              ],
            },
            {
              h2: "The special case of internet phone service (VoIP)",
              p: [
                "The CRTC says you can keep your number between landlines and mobiles, but you might have to change numbers when moving from a landline or mobile to a VoIP service, or the other way around. It depends on the number, its local calling area and the provider's agreements.",
                "Before you commit, ask the new provider to confirm that your specific number can be transferred to them. If you are moving to another province or local calling area, ask the same question: the number might not follow.",
              ],
            },
            {
              h2: "How long it takes",
              p: [
                "According to the CRTC, a transfer between mobiles can take a few hours, and a transfer between a landline and a mobile usually takes two business days. When a VoIP service is involved, timing depends on the providers: plan for a few business days, sometimes more if a detail has to be corrected.",
                "During the switch-over, a short interruption is possible, including of 9-1-1. On the scheduled day, keep another way to call within reach. Calls sometimes reach the new service a few hours before texts, or the other way around; if it lasts, tell the new provider.",
              ],
            },
            {
              h2: "Fees to expect",
              p: [
                "The transfer itself is often free, but your current contract may include cancellation fees. For mobile contracts, the CRTC limits these fees: they go down every month and must reach $0 within 24 months. A contract with no end date cannot carry a cancellation fee.",
                "Settle any unpaid balance too: the CRTC reminds consumers to pay what is owed and sort out account problems before cancelling or transferring a service.",
              ],
            },
            {
              h2: "After the transfer",
              ul: [
                "Make a test call and send a test text, both ways.",
                "Update the 9-1-1 address tied to the number with the new provider.",
                "Check that your important accounts (bank, taxes, email) still receive their verification codes.",
                "Keep the transfer confirmation and the old provider's last bill.",
              ],
            },
            {
              h2: "With MIMT",
              p: [
                `MIMT charges no number transfer fee. Transfers to MIMT are done online, with an electronically signed authorization; your current provider's fees or contract remain your responsibility. Once transferred, the number uses the 9-1-1 address in your MIMT account: check it before the scheduled date. If you ever leave MIMT, your new provider can request the transfer of your number under the same rules. Short answers are in our [help page](${r("en", "help")}).`,
              ],
            },
            {
              h2: "In short",
              ol: [
                "Confirm that your number can be transferred to the new service.",
                "Gather the exact details of your current account.",
                "Ask the new provider for the transfer, not the old one.",
                "Keep the old service active until the transfer is confirmed.",
                "Test calls and texts, then update the 9-1-1 address.",
              ],
              p: [`If you have a dispute with a provider that you can't resolve, the [Commission for Complaints for Telecom-television Services (CCTS)](${CCTS_URL}) can help, free of charge.`],
            },
          ],
          sources: [
            { label: "CRTC: Switch providers and keep your number", url: SRC.crtcPort.en },
            { label: "CCTS: Commission for Complaints for Telecom-television Services", url: CCTS_URL },
          ],
        },
};

// ---------------------------------------------------------------------------------------------------------------
// 2. Virtual numbers: what they are for and how to choose

const virtualNumber: Guide = {
  id: "numero-virtuel",
  slug: { fr: "numero-virtuel-comment-choisir", en: "virtual-number-how-to-choose" },
  updated: "2026-10-29",
  related: ["useVirtual", "cityMontreal", "plans"],
  copy: (lang) => {
    const lock = formatCad(PLANS.lock.monthlyPriceCents, lang);
    const mtl = cityAreaCodes("cityMontreal").join(", ");
    const qc = cityAreaCodes("cityQuebec").join(", ");
    const gat = cityAreaCodes("cityGatineau").join(", ");
    return lang === "fr"
      ? {
          h1: "Numéro virtuel : à quoi ça sert et comment bien le choisir",
          title: "Numéro virtuel : à quoi ça sert et comment choisir",
          description:
            "Ce qu'est un numéro de téléphone virtuel, à quoi il sert au quotidien, comment choisir l'indicatif et le service, et les limites à connaître avant de l'adopter.",
          summary: "Ce qu'est un numéro virtuel, les usages courants, le choix de l'indicatif et les critères pour comparer les services.",
          intro:
            "Un numéro virtuel est un vrai numéro de téléphone qui n'est pas attaché à une carte SIM. Il vit dans une application et sonne partout où vous avez Internet. Pratique pour séparer ses usages ou garder un numéro local, il a aussi des limites qu'il vaut mieux connaître. Ce guide vous aide à décider s'il vous convient et à choisir le bon.",
          body: [
            {
              h2: "Qu'est-ce qu'un numéro virtuel?",
              p: [
                "C'est un numéro nord-américain ordinaire, à dix chiffres, que vos contacts composent comme n'importe quel autre. La différence est du côté de la technologie : les appels et les textos passent par Internet (voix sur IP, ou VoIP) au lieu du réseau cellulaire. Le numéro est relié à votre compte chez le fournisseur, et vous l'utilisez dans une app sur votre téléphone ou dans votre navigateur.",
                "Vous gardez votre cellulaire et son numéro : le numéro virtuel s'ajoute. Il fonctionne par Wi‑Fi ou avec vos données mobiles.",
              ],
            },
            {
              h2: "À quoi ça sert, concrètement",
              ul: [
                "Séparer le travail et la vie personnelle sans transporter deux téléphones.",
                "Publier une petite annonce, vendre en ligne ou utiliser une application de rencontre sans donner son numéro personnel.",
                "Donner un numéro local à une petite entreprise ou à un travailleur autonome, joignable aussi depuis l'ordinateur.",
                "Avoir un numéro dans une autre ville, par exemple pour être joignable localement par des clients d'une autre région.",
                "Rester joignable sur un numéro canadien en voyage, partout où il y a Internet.",
              ],
            },
            {
              h2: "Choisir l'indicatif régional",
              p: [
                `Un numéro local rassure vos contacts et leur évite des frais interurbains. Au Québec, par exemple, les numéros de Montréal commencent par ${mtl}, ceux de Québec par ${qc} et ceux de Gatineau et de l'Outaouais par ${gat}. Choisissez l'indicatif de la région où se trouvent la plupart des gens qui vous appellent.`,
                "Les numéros sont une ressource limitée. Dans les régions très demandées, certains indicatifs peuvent être moins disponibles à un moment donné. Un bon service vous montre les numéros réellement libres et vous dit clairement quand il vous propose un indicatif voisin.",
              ],
            },
            {
              h2: "Les critères pour comparer les services",
              ul: [
                "Les textos : vérifiez que le numéro peut envoyer et recevoir des textos, pas seulement des appels.",
                "Les limites : minutes, textos et pays inclus doivent être écrits clairement, avant le paiement.",
                "Le sort du numéro : certains services gratuits reprennent les numéros inactifs. Sachez à quelles conditions votre numéro reste à vous.",
                "La sortie : demandez si vous pourrez transférer le numéro ailleurs si vous partez un jour.",
                "Le 9-1-1 : le service doit vous demander votre adresse et vous expliquer les limites du 9-1-1 par Internet.",
                "La vie privée : où sont gardées vos données, qui y a accès et comment vous y consentez. Au Québec, la Loi 25 encadre ces questions.",
                "La langue et le soutien : un service en français, des conditions en français et un recours clair en cas de plainte.",
              ],
            },
            {
              h2: "Les limites à connaître",
              p: [
                "Sans connexion Internet, un numéro virtuel ne peut ni appeler ni recevoir d'appels. La qualité dépend de votre réseau : un Wi‑Fi faible ou un signal de données instable se ressent pendant l'appel. En itinérance, les appels consomment des données mobiles; vérifiez votre forfait de données.",
                "Certains sites, comme des banques ou des plateformes en ligne, refusent d'envoyer des codes de vérification à des numéros de téléphonie par Internet. Avant d'utiliser un numéro virtuel pour un compte important, assurez-vous qu'il est accepté.",
                `Enfin, le 9-1-1 fonctionne différemment d'un cellulaire. Lisez notre [guide sur le 9-1-1 et la téléphonie par Internet](${ROUTES.guides.fr}9-1-1-telephonie-internet/) avant d'en faire votre seul numéro.`,
              ],
            },
            {
              h2: "Avec MIMT",
              p: [
                `Le forfait Gratuit de MIMT permet d'appeler et de texter les autres utilisateurs de MIMT, sans numéro de téléphone. Pour un vrai numéro canadien, le forfait Essentiel coûte ${lock} par mois avant taxes, et le numéro reste à vous tant que le forfait est payé. Le sélecteur de numéros affiche en direct les numéros libres; celui que vous choisissez est réservé 10 minutes pendant que vous créez votre compte. Comparez les [forfaits](${r("fr", "plans")}) ou voyez la page [Numéro virtuel](${r("fr", "useVirtual")}).`,
              ],
            },
          ],
          sources: [
            { label: "CRTC : Obligations des fournisseurs de services VoIP locaux à l'égard du 9-1-1", url: SRC.crtc911.fr },
            { label: "Commission d'accès à l'information du Québec : principaux changements de la Loi 25", url: SRC.law25.fr },
          ],
        }
      : {
          h1: "Virtual numbers: what they are for and how to choose one",
          title: "Virtual phone numbers: uses and how to choose",
          description:
            "What a virtual phone number is, what it is useful for, how to pick the area code and the service, and the limits to know before you rely on one.",
          summary: "What a virtual number is, common uses, choosing the area code and the criteria for comparing services.",
          intro:
            "A virtual number is a real phone number that isn't tied to a SIM card. It lives in an app and rings wherever you have internet. Handy for keeping things separate or holding a local number, it also has limits worth knowing. This guide helps you decide whether one suits you and how to choose well.",
          body: [
            {
              h2: "What is a virtual number?",
              p: [
                "It is an ordinary ten-digit North American number that your contacts dial like any other. The difference is the technology: calls and texts travel over the internet (voice over IP, or VoIP) instead of the cellular network. The number is tied to your account with the provider, and you use it in an app on your phone or in your browser.",
                "You keep your mobile and its number: the virtual number is added on top. It works over Wi‑Fi or your mobile data.",
              ],
            },
            {
              h2: "What it is useful for",
              ul: [
                "Keeping work and personal life apart without carrying two phones.",
                "Posting a classified ad, selling online or using a dating app without giving out your personal number.",
                "Giving a small business or a freelancer a local number that also works from a computer.",
                "Having a number in another city, for example to be reachable locally by clients in another region.",
                "Staying reachable on a Canadian number while travelling, wherever there is internet.",
              ],
            },
            {
              h2: "Choosing the area code",
              p: [
                `A local number reassures your contacts and spares them long-distance charges. In Québec, for example, Montréal numbers start with ${mtl}, Québec City numbers with ${qc}, and Gatineau and Outaouais numbers with ${gat}. Pick the area code of the region where most of your callers are.`,
                "Phone numbers are a limited resource. In busy regions, some area codes may be harder to get at a given time. A good service shows you the numbers that are actually free and tells you clearly when it offers a neighbouring area code.",
              ],
            },
            {
              h2: "Criteria for comparing services",
              ul: [
                "Texts: check that the number can send and receive texts, not only calls.",
                "Limits: minutes, texts and countries included should be written clearly, before you pay.",
                "What happens to the number: some free services take back inactive numbers. Know the conditions under which your number stays yours.",
                "Leaving: ask whether you can transfer the number elsewhere if you leave one day.",
                "9-1-1: the service should ask for your address and explain the limits of 9-1-1 over the internet.",
                "Privacy: where your data is kept, who can access it and how you consent. In Québec, Law 25 covers these questions.",
                "Language and support: service in French, terms in French and a clear path if you have a complaint.",
              ],
            },
            {
              h2: "Limits to know",
              p: [
                "Without an internet connection, a virtual number can't make or receive calls. Quality depends on your network: weak Wi‑Fi or an unstable data signal shows during the call. When roaming, calls use mobile data; check your data plan.",
                "Some sites, such as banks or online platforms, refuse to send verification codes to internet phone numbers. Before using a virtual number for an important account, make sure it is accepted.",
                `Finally, 9-1-1 works differently than on a mobile. Read our [guide to 9-1-1 and internet phone service](${ROUTES.guides.en}9-1-1-internet-phone-service/) before making it your only number.`,
              ],
            },
            {
              h2: "With MIMT",
              p: [
                `MIMT's Free plan lets you call and text other MIMT users, without a phone number. For a real Canadian number, the Essential plan costs ${lock} a month before taxes, and the number stays yours as long as the plan is paid. The number picker shows free numbers live; the one you choose is held for 10 minutes while you create your account. Compare the [plans](${r("en", "plans")}) or see the [virtual number](${r("en", "useVirtual")}) page.`,
              ],
            },
          ],
          sources: [
            { label: "CRTC: Obligations of local VoIP service providers regarding 9-1-1", url: SRC.crtc911.en },
            { label: "Commission d'accès à l'information du Québec: main changes under Law 25 (French)", url: SRC.law25.en },
          ],
        };
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 3. 9-1-1 and internet phone service

const e911: Guide = {
  id: "9-1-1",
  slug: { fr: "9-1-1-telephonie-internet", en: "9-1-1-internet-phone-service" },
  updated: "2026-10-29",
  related: ["e911", "accessibility", "help"],
  copy: (lang) =>
    lang === "fr"
      ? {
          h1: "Le 9-1-1 et la téléphonie par Internet : ce qu'il faut savoir",
          title: "9-1-1 et téléphonie par Internet : à savoir",
          description:
            "Pourquoi le 9-1-1 fonctionne autrement avec un service de téléphonie par Internet, quand il peut ne pas fonctionner et comment vous préparer, chez vous comme au chalet.",
          summary: "Comment un appel au 9-1-1 est acheminé avec un service par Internet, ses limites et les gestes simples pour être prêt.",
          intro:
            "Avec un téléphone fixe, les services d'urgence savent d'où vient l'appel. Avec un cellulaire, le réseau aide à vous situer. Avec un service de téléphonie par Internet que l'on peut utiliser partout, c'est différent. Ce guide explique pourquoi, ce que le CRTC exige des fournisseurs et ce que vous pouvez faire pour être prêt le jour où vous en aurez besoin.",
          body: [
            {
              h2: "Fixe, nomade : deux types de service par Internet",
              p: [
                "Le CRTC distingue les services de téléphonie par Internet fixes, utilisés à une seule adresse, et les services nomades, que l'on peut utiliser partout où il y a une connexion. Une application sur votre cellulaire ou votre ordinateur est un service nomade : le réseau ne peut pas savoir automatiquement où vous êtes au moment de l'appel.",
              ],
            },
            {
              h2: "Comment un appel au 9-1-1 est acheminé",
              p: [
                "Avec un service nomade, l'appel au 9-1-1 est généralement reçu d'abord par un centre d'appels d'urgence spécialisé. Un préposé vous demande où vous êtes, puis transfère l'appel au centre 9-1-1 de la région. Cette étape de plus explique pourquoi il faut parler clairement de votre emplacement dès le début.",
              ],
              ul: [
                "Dites tout de suite votre adresse, votre ville et votre province.",
                "Ne raccrochez pas avant qu'on vous le dise; si l'appel coupe, rappelez.",
                "Le préposé peut ne pas avoir votre numéro de rappel ou votre adresse à l'écran.",
              ],
            },
            {
              h2: "Ce que le CRTC exige des fournisseurs",
              p: [
                "Les fournisseurs de services de téléphonie par Internet locaux doivent offrir l'accès au 9-1-1 et informer clairement leurs clients des limites du service, avant le début du service et de façon continue. Ils doivent aussi obtenir la confirmation que le client a bien compris ces limites. C'est pourquoi une application sérieuse vous présente un avis 9-1-1 et vous demande votre adresse avant votre premier appel.",
              ],
            },
            {
              h2: "Quand le 9-1-1 peut ne pas fonctionner",
              ul: [
                "Panne d'Internet, Wi‑Fi coupé, données mobiles indisponibles ou connexion trop faible.",
                "Panne de courant, ou téléphone, modem ou ordinateur déchargé.",
                "Application fermée par le système, désinstallée ou pas à jour.",
                "Adresse enregistrée inexacte ou oubliée après un déménagement.",
                "Utilisation à l'extérieur du Canada : l'appel peut ne pas joindre les secours locaux.",
              ],
            },
            {
              h2: "Cinq gestes pour être prêt",
              ol: [
                "Inscrivez l'adresse municipale exacte où vous utilisez le service, et mettez-la à jour chaque fois que vous changez d'endroit : chalet, déménagement, séjour prolongé.",
                "Gardez un autre moyen d'appeler : un cellulaire chargé ou une ligne fixe, surtout si le numéro par Internet est votre ligne principale.",
                "Si votre modem est votre seul accès, pensez à une alimentation de secours; sans courant, pas d'Internet.",
                "Informez les autres personnes qui utilisent la ligne (famille, gardienne, employés, invités) de ces limites.",
                "Gardez l'application à jour et vérifiez de temps en temps que vous pouvez appeler.",
              ],
            },
            {
              h2: "Personnes sourdes, malentendantes ou ayant un trouble de la parole",
              p: [
                "Le service de 9-1-1 par texto (T9-1-1) est offert par les fournisseurs cellulaires, aux personnes inscrites auprès de leur fournisseur; il ne passe pas par une application de téléphonie par Internet. Les services de relais peuvent aussi comporter des limites pour le 9-1-1. Renseignez-vous auprès de votre fournisseur cellulaire et de votre service de relais.",
              ],
            },
            {
              h2: "Avec MIMT",
              p: [
                `MIMT est un service nomade. Le 9-1-1 n'est jamais bloqué par votre forfait, vos limites de minutes ou votre solde. Les appels sortants vers des numéros de téléphone sont activés seulement après l'enregistrement de votre adresse et l'acceptation de l'avis 9-1-1. Lisez notre [page 9-1-1](${r("fr", "e911")}) avant d'utiliser le service.`,
              ],
            },
          ],
          sources: [
            { label: "CRTC : Obligations des fournisseurs de services VoIP locaux à l'égard du 9-1-1", url: SRC.crtc911.fr },
          ],
        }
      : {
          h1: "9-1-1 and internet phone service: what you need to know",
          title: "9-1-1 and internet phone service: what to know",
          description:
            "Why 9-1-1 works differently with an internet phone service, when it may not work and how to get ready, at home or at the cottage.",
          summary: "How a 9-1-1 call is routed on an internet phone service, its limits and simple steps to be ready.",
          intro:
            "With a landline, emergency services know where the call comes from. With a mobile, the network helps locate you. With an internet phone service you can use anywhere, it is different. This guide explains why, what the CRTC requires of providers and what you can do to be ready the day you need it.",
          body: [
            {
              h2: "Fixed and nomadic: two kinds of internet phone service",
              p: [
                "The CRTC distinguishes fixed internet phone services, used at a single address, from nomadic services, which can be used wherever there is a connection. An app on your mobile or computer is a nomadic service: the network can't automatically know where you are when you call.",
              ],
            },
            {
              h2: "How a 9-1-1 call is routed",
              p: [
                "With a nomadic service, a 9-1-1 call is usually answered first by a specialized emergency call centre. An agent asks where you are, then transfers the call to the local 9-1-1 centre. That extra step is why you should state your location clearly right away.",
              ],
              ul: [
                "Say your address, city and province right away.",
                "Don't hang up until you are told to; if the call drops, call back.",
                "The agent may not have your callback number or address on screen.",
              ],
            },
            {
              h2: "What the CRTC requires of providers",
              p: [
                "Local internet phone service providers must give access to 9-1-1 and clearly inform their customers of the service's limits, before service starts and on an ongoing basis. They must also get confirmation that the customer understands these limits. That is why a serious app shows you a 9-1-1 notice and asks for your address before your first call.",
              ],
            },
            {
              h2: "When 9-1-1 may not work",
              ul: [
                "Internet outage, Wi‑Fi down, mobile data unavailable or a connection that is too weak.",
                "Power outage, or a phone, modem or computer with a dead battery.",
                "App closed by the system, uninstalled or out of date.",
                "Registered address wrong, or forgotten after a move.",
                "Use outside Canada: the call may not reach local emergency services.",
              ],
            },
            {
              h2: "Five steps to be ready",
              ol: [
                "Register the exact civic address where you use the service, and update it every time you change location: cottage, move, long stay.",
                "Keep another way to call: a charged mobile or a landline, especially if the internet number is your main line.",
                "If your modem is your only access, consider backup power; no power means no internet.",
                "Tell the other people who use the line (family, babysitter, staff, guests) about these limits.",
                "Keep the app up to date and check from time to time that you can call.",
              ],
            },
            {
              h2: "Deaf, hard of hearing or speech-impaired people",
              p: [
                "Text with 9-1-1 (T9-1-1) is offered by mobile carriers to people registered with their carrier; it doesn't go through an internet phone app. Relay services may also have 9-1-1 limits. Check with your mobile carrier and your relay service.",
              ],
            },
            {
              h2: "With MIMT",
              p: [
                `MIMT is a nomadic service. 9-1-1 is never blocked by your plan, minute limits or balance. Outgoing calls to phone numbers are turned on only after you register your address and accept the 9-1-1 notice. Read our [9-1-1 page](${r("en", "e911")}) before using the service.`,
              ],
            },
          ],
          sources: [{ label: "CRTC: Obligations of local VoIP service providers regarding 9-1-1", url: SRC.crtc911.en }],
        },
};

// ---------------------------------------------------------------------------------------------------------------
// 4. A second number to separate work and personal life

const secondNumber: Guide = {
  id: "deuxieme-numero",
  slug: { fr: "deuxieme-numero-vie-pro-vie-perso", en: "second-number-work-personal-life" },
  updated: "2026-10-29",
  related: ["useSecond", "plans", "help"],
  copy: (lang) =>
    lang === "fr"
      ? {
          h1: "Séparer vie pro et vie perso avec un deuxième numéro",
          title: "Deuxième numéro : séparer vie pro et vie perso",
          description:
            "Pourquoi et comment séparer vos appels de travail et vos appels personnels : les options possibles, les bonnes pratiques et les pièges à éviter.",
          summary: "Les options pour avoir deux numéros, leurs avantages et inconvénients, et les habitudes qui rendent la séparation efficace.",
          intro:
            "Les clients qui textent à 22 h, le numéro personnel publié sur une annonce, les appels de travail pendant les vacances : quand un seul numéro sert à tout, la frontière entre le travail et la vie privée s'efface vite. Un deuxième numéro est une solution simple. Voici les options, comment les comparer et les habitudes qui font la différence.",
          body: [
            {
              h2: "Pourquoi séparer",
              ul: [
                "Protéger votre vie privée : votre numéro personnel reste entre les mains de vos proches.",
                "Décrocher vraiment : vous choisissez quand le numéro de travail sonne.",
                "Avoir l'air professionnel : un message d'accueil d'entreprise, des textos clairement identifiés.",
                "Mieux gérer les renseignements de vos clients : leurs messages ne se mêlent pas à vos conversations personnelles, ce qui facilite le respect de la Loi 25.",
              ],
            },
            {
              h2: "Les options, sans détour",
              p: [
                "Deux téléphones : la séparation est parfaite, mais il faut payer, charger et transporter deux appareils.",
                "Un téléphone avec deux cartes SIM ou une eSIM : un seul appareil, mais deux forfaits cellulaires, et tous les téléphones ne le permettent pas.",
                "Un numéro virtuel dans une application : un seul appareil et un seul forfait de données. Le deuxième numéro fonctionne par Internet, et souvent aussi sur l'ordinateur. En contrepartie, il faut une connexion pour l'utiliser, et le 9-1-1 a des limites propres aux services par Internet.",
              ],
            },
            {
              h2: "Les habitudes qui rendent la séparation efficace",
              ol: [
                "Fixez des heures. Utilisez le mode Ne pas déranger sur le numéro de travail le soir et la fin de semaine, et dites-le dans votre message d'accueil.",
                "Enregistrez un message d'accueil professionnel : votre nom ou celui de l'entreprise, vos heures et le délai habituel de réponse.",
                "Donnez le bon numéro au bon endroit : cartes professionnelles, site Web et annonces avec le numéro de travail, famille et amis avec le numéro personnel.",
                "Ne mêlez pas les contacts. Gardez les clients dans le carnet associé au numéro de travail.",
                "Vérifiez quel numéro s'affiche avant de rappeler quelqu'un : c'est l'erreur la plus fréquente.",
                "Conservez les échanges importants (soumissions, confirmations) dans un endroit prévu à cet effet, et effacez ce qui n'est plus utile.",
              ],
            },
            {
              h2: "Ventes en ligne, annonces et rencontres",
              p: [
                `Quand vous publiez une annonce ou que vous parlez à des inconnus, un deuxième numéro évite de donner votre numéro personnel. Vous pouvez bloquer un appelant ou cesser d'utiliser ce numéro sans toucher à votre ligne principale. Restez prudent : ne partagez jamais un code de vérification reçu par texto, même si on vous le demande poliment. Notre [guide sur les arnaques par texto](${ROUTES.guides.fr}arnaques-par-texto/) donne d'autres conseils.`,
              ],
            },
            {
              h2: "Travailleurs autonomes et petites équipes",
              p: [
                "Si votre activité grandit, demandez-vous à qui appartient le numéro. Un numéro au nom de l'entreprise peut passer d'une personne à l'autre si quelqu'un quitte l'équipe; un numéro personnel, non. Pour plusieurs personnes, un système téléphonique d'entreprise avec des postes, un accueil et des heures d'ouverture est souvent plus simple qu'une série de numéros individuels.",
              ],
            },
            {
              h2: "Avec MIMT",
              p: [
                `Le deuxième numéro MIMT vit dans l'app sur votre cellulaire et dans le navigateur à app.mimt.ca : appels, textos et messagerie vocale séparés de votre ligne personnelle. Vos appels et textos affichent ce numéro, jamais celui de votre cellulaire. Les forfaits avec numéro commencent à ${formatCad(PLANS.lock.monthlyPriceCents, "fr")} par mois avant taxes; pour une équipe, voyez [MIMT Affaires](${r("fr", "business")}). Plus de détails sur la page [Deuxième numéro](${r("fr", "useSecond")}).`,
              ],
            },
          ],
          sources: [{ label: "Commission d'accès à l'information du Québec : principaux changements de la Loi 25", url: SRC.law25.fr }],
        }
      : {
          h1: "Separating work and personal life with a second number",
          title: "Second number: separate work and personal life",
          description:
            "Why and how to keep work calls apart from personal calls: the options available, good habits and the traps to avoid.",
          summary: "The ways to have two numbers, their pros and cons, and the habits that make the separation work.",
          intro:
            "Clients texting at 10 p.m., a personal number posted on an ad, work calls during holidays: when one number does everything, the line between work and private life blurs fast. A second number is a simple fix. Here are the options, how to compare them and the habits that make a difference.",
          body: [
            {
              h2: "Why separate",
              ul: [
                "Protect your privacy: your personal number stays with the people close to you.",
                "Truly switch off: you decide when the work number rings.",
                "Look professional: a business greeting and clearly identified texts.",
                "Handle your clients' information better: their messages don't mix with your personal conversations, which helps with Québec's Law 25.",
              ],
            },
            {
              h2: "The options, plainly",
              p: [
                "Two phones: perfect separation, but you pay for, charge and carry two devices.",
                "One phone with two SIM cards or an eSIM: one device, but two mobile plans, and not every phone supports it.",
                "A virtual number in an app: one device and one data plan. The second number works over the internet, and often on your computer too. On the other hand, you need a connection to use it, and 9-1-1 has limits specific to internet services.",
              ],
            },
            {
              h2: "Habits that make the separation work",
              ol: [
                "Set hours. Use Do Not Disturb on the work number in the evening and on weekends, and say so in your greeting.",
                "Record a professional greeting: your name or the business's, your hours and your usual response time.",
                "Give the right number in the right place: business cards, website and ads with the work number; family and friends with the personal one.",
                "Don't mix contacts. Keep clients in the address book tied to the work number.",
                "Check which number is shown before you call someone back: it is the most common mistake.",
                "Keep important exchanges (quotes, confirmations) somewhere meant for them, and delete what you no longer need.",
              ],
            },
            {
              h2: "Online sales, classified ads and dating",
              p: [
                `When you post an ad or talk with strangers, a second number keeps your personal one private. You can block a caller or stop using that number without touching your main line. Stay careful: never share a verification code you received by text, even if asked politely. Our [guide to text message scams](${ROUTES.guides.en}text-message-scams/) has more tips.`,
              ],
            },
            {
              h2: "Freelancers and small teams",
              p: [
                "As your business grows, ask yourself who owns the number. A number in the business's name can move from one person to another if someone leaves the team; a personal number can't. For several people, a business phone system with extensions, a greeting and business hours is often simpler than a set of individual numbers.",
              ],
            },
            {
              h2: "With MIMT",
              p: [
                `A MIMT second number lives in the app on your mobile and in the browser at app.mimt.ca: calls, texts and voicemail kept apart from your personal line. Your calls and texts show that number, never your mobile's. Plans with a number start at ${formatCad(PLANS.lock.monthlyPriceCents, "en")} a month before taxes; for a team, see [MIMT Business](${r("en", "business")}). More on the [second number](${r("en", "useSecond")}) page.`,
              ],
            },
          ],
          sources: [{ label: "Commission d'accès à l'information du Québec: main changes under Law 25 (French)", url: SRC.law25.en }],
        },
};

// ---------------------------------------------------------------------------------------------------------------
// 5. AI receptionist for a small business: good practices

const aiReceptionist: Guide = {
  id: "receptionniste-ia",
  slug: { fr: "receptionniste-ia-bonnes-pratiques", en: "ai-receptionist-good-practices" },
  updated: "2026-10-29",
  related: ["ai", "business", "privacy"],
  copy: (lang) =>
    lang === "fr"
      ? {
          h1: "Réceptionniste IA pour petite entreprise : bonnes pratiques",
          title: "Réceptionniste IA : bonnes pratiques pour PME",
          description:
            "Comment mettre en place un réceptionniste IA au téléphone dans une petite entreprise du Québec : transparence, consignes, français, Loi 25 et transfert à une personne.",
          summary: "Ce qu'un réceptionniste IA fait bien, comment l'encadrer, et les règles de transparence et de vie privée à respecter au Québec.",
          intro:
            "Un réceptionniste virtuel peut répondre aux appels quand personne n'est disponible : il donne vos heures, répond aux questions fréquentes et prend des messages. Bien encadré, il évite des appels manqués. Mal encadré, il frustre vos clients. Voici les pratiques qui font la différence, en tenant compte des règles québécoises.",
          body: [
            {
              h2: "Ce qu'un réceptionniste IA fait bien",
              ul: [
                "Donner les heures d'ouverture, l'adresse et les jours de fermeture.",
                "Répondre aux questions fréquentes que vous avez écrites vous-même.",
                "Diriger l'appel vers la bonne personne ou le bon service.",
                "Prendre un message complet : nom, numéro de rappel, motif de l'appel.",
                "Répondre en dehors des heures d'ouverture, sans laisser sonner dans le vide.",
              ],
              p: [
                "Il ne remplace pas le jugement d'une personne. Les plaintes, les situations délicates et les décisions qui engagent l'entreprise doivent revenir à un humain.",
              ],
            },
            {
              h2: "Soyez transparent dès la première phrase",
              p: [
                "Vos clients doivent savoir qu'ils parlent à une intelligence artificielle et que la conversation est transcrite. C'est une question de confiance, et c'est cohérent avec la Loi 25, qui exige d'informer les personnes de la façon dont leurs renseignements sont recueillis et utilisés. Si les appels sont enregistrés, un avis doit être donné avant l'enregistrement.",
              ],
            },
            {
              h2: "Gardez toujours une porte vers une personne",
              p: [
                "Prévoyez un transfert vers un poste ou un cellulaire de garde, ou au minimum la prise de message avec un engagement de rappel. Dites clairement à l'appelant ce qui va se passer : « Je transmets votre message; quelqu'un vous rappellera aujourd'hui avant 17 h » vaut mieux qu'une promesse vague.",
              ],
            },
            {
              h2: "Écrivez de bonnes consignes",
              ol: [
                "Listez les faits exacts : heures, adresse, services offerts, modes de paiement acceptés, politique de rendez-vous.",
                "Dites ce qu'il ne doit pas faire : annoncer un prix non confirmé, promettre un remboursement, donner un avis médical, juridique ou financier.",
                "Précisez quand transférer : plainte, urgence, client insatisfait, question hors liste.",
                "Pour une urgence, la consigne est simple : inviter la personne à raccrocher et à composer le 9-1-1.",
                "Relisez et mettez à jour ces consignes à chaque changement d'horaire ou de service.",
              ],
            },
            {
              h2: "Le français d'abord",
              p: [
                "Au Québec, la Charte de la langue française donne aux consommateurs le droit d'être informés et servis en français. Configurez l'accueil en français d'abord, avec l'anglais au choix de l'appelant si vous servez une clientèle bilingue, et vérifiez la prononciation des noms de rues et de produits.",
              ],
            },
            {
              h2: "Les renseignements personnels",
              ul: [
                "Ne demandez que ce qui est nécessaire pour rappeler et traiter la demande.",
                "Ne faites jamais prendre de numéro de carte de crédit par l'IA au téléphone.",
                "Limitez l'accès aux transcriptions et aux résumés aux personnes qui en ont besoin.",
                "Fixez une durée de conservation et supprimez ce qui n'est plus utile.",
                "Mentionnez le réceptionniste IA et son fournisseur dans votre politique de confidentialité.",
              ],
              p: [`La [Commission d'accès à l'information du Québec](${SRC.cai.fr}) publie des ressources pour les entreprises sur la Loi 25.`],
            },
            {
              h2: "Testez, puis ajustez",
              p: [
                "Avant de le mettre en ligne, appelez vous-même : posez les questions habituelles, puis des questions imprévues, parlez vite, changez de langue. Pendant les premières semaines, lisez les résumés d'appels chaque semaine pour repérer les questions sans réponse et améliorer les consignes.",
              ],
            },
            {
              h2: "Avec MIMT",
              p: [
                `Le réceptionniste IA de MIMT Affaires se présente toujours comme un agent d'intelligence artificielle dès le début de l'appel et précise que la conversation est transcrite. Il répond à partir de vos heures et de vos questions fréquentes, transfère à une personne ou prend un message. L'IA est fournie par Claude, d'Anthropic, et chaque compte a un plafond mensuel de coût d'IA; une fois atteint, les appels continuent normalement. Voyez [l'IA de MIMT](${r("fr", "ai")}) et [MIMT Affaires](${r("fr", "business")}).`,
              ],
            },
          ],
          sources: [
            { label: "Commission d'accès à l'information du Québec", url: SRC.cai.fr },
            { label: "Commission d'accès à l'information du Québec : principaux changements de la Loi 25", url: SRC.law25.fr },
          ],
        }
      : {
          h1: "AI receptionist for a small business: good practices",
          title: "AI receptionist: good practices for small business",
          description:
            "How to set up a phone AI receptionist in a small Québec business: transparency, instructions, French first, Law 25 and handing calls to a person.",
          summary: "What an AI receptionist does well, how to frame it, and the transparency and privacy rules to follow in Québec.",
          intro:
            "A virtual receptionist can answer calls when nobody is available: it gives your hours, answers common questions and takes messages. Well framed, it prevents missed calls. Poorly framed, it frustrates your customers. Here are the practices that make a difference, with Québec's rules in mind.",
          body: [
            {
              h2: "What an AI receptionist does well",
              ul: [
                "Giving business hours, the address and closing days.",
                "Answering the common questions you wrote yourself.",
                "Directing the call to the right person or department.",
                "Taking a complete message: name, callback number, reason for the call.",
                "Answering after hours instead of letting the phone ring out.",
              ],
              p: ["It doesn't replace a person's judgment. Complaints, sensitive situations and decisions that commit the business should go to a human."],
            },
            {
              h2: "Be transparent from the first sentence",
              p: [
                "Your customers should know they are talking to an artificial intelligence and that the conversation is transcribed. It is a matter of trust, and it is consistent with Québec's Law 25, which requires telling people how their information is collected and used. If calls are recorded, a notice must be given before recording.",
              ],
            },
            {
              h2: "Always keep a door to a person",
              p: [
                "Plan a transfer to an extension or an on-call mobile, or at least a message with a callback commitment. Tell callers clearly what will happen: “I'm passing on your message; someone will call you back today before 5 p.m.” is better than a vague promise.",
              ],
            },
            {
              h2: "Write good instructions",
              ol: [
                "List the exact facts: hours, address, services offered, payment methods accepted, appointment policy.",
                "Say what it must not do: quote an unconfirmed price, promise a refund, give medical, legal or financial advice.",
                "Specify when to transfer: complaint, emergency, unhappy customer, question not on the list.",
                "For an emergency, the instruction is simple: ask the person to hang up and dial 9-1-1.",
                "Review and update these instructions whenever your hours or services change.",
              ],
            },
            {
              h2: "French first",
              p: [
                "In Québec, the Charter of the French language gives consumers the right to be informed and served in French. Set up the greeting in French first, with English at the caller's choice if you serve a bilingual clientele, and check how street and product names are pronounced.",
              ],
            },
            {
              h2: "Personal information",
              ul: [
                "Ask only for what is needed to call back and handle the request.",
                "Never have the AI take a credit card number over the phone.",
                "Limit access to transcripts and summaries to the people who need them.",
                "Set a retention period and delete what is no longer useful.",
                "Mention the AI receptionist and its provider in your privacy policy.",
              ],
              p: [`The [Commission d'accès à l'information du Québec](${SRC.cai.en}) publishes resources for businesses on Law 25.`],
            },
            {
              h2: "Test, then adjust",
              p: [
                "Before going live, call it yourself: ask the usual questions, then unexpected ones, speak fast, switch languages. During the first weeks, read the call summaries every week to spot unanswered questions and improve the instructions.",
              ],
            },
            {
              h2: "With MIMT",
              p: [
                `The MIMT Business AI receptionist always introduces itself as an artificial intelligence agent at the start of the call and says the conversation is transcribed. It answers from your hours and frequently asked questions, transfers to a person or takes a message. The AI is provided by Claude, from Anthropic, and each account has a monthly AI cost cap; once reached, calls keep working normally. See [MIMT AI](${r("en", "ai")}) and [MIMT Business](${r("en", "business")}).`,
              ],
            },
          ],
          sources: [
            { label: "Commission d'accès à l'information du Québec", url: SRC.cai.en },
            { label: "Commission d'accès à l'information du Québec: main changes under Law 25 (French)", url: SRC.law25.en },
          ],
        },
};

// ---------------------------------------------------------------------------------------------------------------
// 6. Protecting your number from text message scams

const scams: Guide = {
  id: "arnaques",
  slug: { fr: "arnaques-par-texto", en: "text-message-scams" },
  updated: "2026-10-29",
  related: ["ai", "privacy", "help"],
  copy: (lang) =>
    lang === "fr"
      ? {
          h1: "Protéger son numéro contre les arnaques par texto",
          title: "Arnaques par texto : les reconnaître et se protéger",
          description:
            "Les arnaques par texto les plus courantes au Canada, les signes qui doivent vous alerter, quoi faire si vous avez cliqué et comment protéger votre numéro.",
          summary: "Les arnaques par texto courantes, les signaux d'alerte, les bons réflexes et quoi faire si vous avez été victime.",
          intro:
            "Un colis en attente, un remboursement à réclamer, un compte bancaire « bloqué » : les messages frauduleux imitent des organisations connues pour vous faire cliquer ou donner un code. Ce guide présente les ruses courantes, les signaux d'alerte et les gestes qui protègent votre numéro et vos comptes.",
          body: [
            {
              h2: "Les arnaques les plus courantes",
              ul: [
                "Le faux colis : « Votre livraison est en attente, confirmez votre adresse » avec un lien qui demande un petit paiement.",
                "Le faux remboursement ou la fausse amende : un organisme public vous devrait de l'argent, ou vous réclamerait un paiement immédiat.",
                "La fausse banque : un « avis de sécurité » qui vous envoie vers une page imitant celle de votre institution financière.",
                "Le code de vérification : quelqu'un vous demande de lui renvoyer le code que vous venez de recevoir. Ce code sert à prendre le contrôle d'un de vos comptes.",
                "Le proche qui a « changé de numéro » et qui a besoin d'argent rapidement.",
              ],
            },
            {
              h2: "Les signaux d'alerte",
              ul: [
                "Un ton pressant : délai très court, menace de fermeture de compte ou de poursuite.",
                "Un lien raccourci ou une adresse Web qui ressemble presque à la vraie.",
                "Une demande de code, de mot de passe, de NIP ou de numéro de carte.",
                "Un expéditeur inconnu qui sait pourtant votre prénom.",
                "Un paiement demandé en cartes-cadeaux, en cryptomonnaie ou par virement à un inconnu.",
              ],
              p: ["Une organisation sérieuse ne vous demandera jamais un code de vérification ou un mot de passe par texto."],
            },
            {
              h2: "Les bons réflexes",
              ol: [
                "Ne cliquez pas et ne répondez pas, même pour dire « arrêtez ».",
                "Vérifiez par un canal que vous connaissez : l'application officielle, le site tapé vous-même ou le numéro inscrit au dos de votre carte.",
                "Signalez le message. Chez la plupart des fournisseurs cellulaires canadiens, on peut transférer un texto indésirable au 7726 (SPAM); renseignez-vous auprès du vôtre.",
                "Bloquez l'expéditeur, puis supprimez le message.",
              ],
            },
            {
              h2: "Protéger votre numéro lui-même",
              p: [
                "Votre numéro sert souvent à confirmer votre identité. Un fraudeur qui en prend le contrôle peut recevoir vos codes de vérification. Quelques gestes réduisent ce risque :",
              ],
              ul: [
                "Ne partagez jamais un code reçu par texto, avec qui que ce soit.",
                "Demandez à votre fournisseur s'il offre un NIP ou un mot de passe de transfert, et activez-le.",
                "Pour vos comptes importants, privilégiez une application d'authentification ou une clé d'accès plutôt que le texto quand c'est possible.",
                "Publiez votre numéro personnel le moins possible; utilisez un deuxième numéro pour les annonces et les inconnus.",
                "Si votre téléphone perd soudainement le service sans raison, communiquez tout de suite avec votre fournisseur.",
              ],
            },
            {
              h2: "Et la Liste nationale de numéros exclus?",
              p: [
                `Inscrire votre numéro sur la [Liste nationale de numéros de télécommunication exclus](${SRC.dncl.fr}) (LNNTE) réduit les appels de télémarketing légitimes. Le CRTC rappelle toutefois que les fraudeurs n'en tiennent pas compte : vous pouvez recevoir des appels frauduleux même si votre numéro y est inscrit.`,
              ],
            },
            {
              h2: "Si vous avez été victime",
              ol: [
                "Communiquez immédiatement avec votre institution financière si vous avez donné des renseignements bancaires.",
                "Changez les mots de passe des comptes touchés et activez la vérification en deux étapes.",
                "Avisez votre fournisseur de téléphone si vous croyez que quelqu'un a tenté de transférer votre numéro.",
                `Signalez la fraude au [Centre antifraude du Canada](${SRC.cafc.fr}) (1-888-495-8501) et, au besoin, à votre service de police.`,
              ],
            },
            {
              h2: "Avec MIMT",
              p: [
                `MIMT affiche une étiquette « Spam probable » sur les appels et les textos douteux, selon des règles simples, sur tous les forfaits. C'est une étiquette, pas un blocage : vous décidez, et les rappels des services d'urgence sonnent toujours. Avec votre consentement, l'IA peut aider à évaluer un texto ambigu. Voyez [l'IA de MIMT](${r("fr", "ai")}).`,
              ],
            },
          ],
          sources: [
            { label: "CRTC : Comment vous protéger contre les arnaqueurs", url: SRC.crtcFraud.fr },
            { label: "Centre antifraude du Canada", url: SRC.cafc.fr },
            { label: "Liste nationale de numéros de télécommunication exclus", url: SRC.dncl.fr },
          ],
        }
      : {
          h1: "Protecting your number from text message scams",
          title: "Text message scams: spot them, protect yourself",
          description:
            "The most common text message scams in Canada, the warning signs, what to do if you clicked and how to protect your phone number.",
          summary: "Common text scams, the warning signs, good reflexes and what to do if you were a victim.",
          intro:
            "A parcel on hold, a refund to claim, a bank account “locked”: fraudulent messages imitate well-known organizations to get you to click or hand over a code. This guide covers the usual tricks, the warning signs and the steps that protect your number and your accounts.",
          body: [
            {
              h2: "The most common scams",
              ul: [
                "The fake parcel: “Your delivery is on hold, confirm your address”, with a link asking for a small payment.",
                "The fake refund or fine: a public body supposedly owes you money, or demands immediate payment.",
                "The fake bank: a “security notice” that sends you to a page imitating your financial institution's.",
                "The verification code: someone asks you to send back the code you just received. That code is used to take over one of your accounts.",
                "The relative who “changed numbers” and needs money quickly.",
              ],
            },
            {
              h2: "Warning signs",
              ul: [
                "Pressure: a very short deadline, a threat to close an account or take legal action.",
                "A shortened link or a web address that looks almost like the real one.",
                "A request for a code, password, PIN or card number.",
                "An unknown sender who somehow knows your first name.",
                "Payment requested in gift cards, cryptocurrency or a transfer to a stranger.",
              ],
              p: ["A legitimate organization will never ask for a verification code or password by text."],
            },
            {
              h2: "Good reflexes",
              ol: [
                "Don't click and don't reply, not even to say “stop”.",
                "Check through a channel you know: the official app, the website typed yourself or the number on the back of your card.",
                "Report the message. With most Canadian mobile carriers, you can forward an unwanted text to 7726 (SPAM); check with yours.",
                "Block the sender, then delete the message.",
              ],
            },
            {
              h2: "Protecting the number itself",
              p: ["Your number is often used to confirm your identity. A fraudster who takes control of it can receive your verification codes. A few steps lower that risk:"],
              ul: [
                "Never share a code you received by text, with anyone.",
                "Ask your provider whether it offers a transfer PIN or password, and turn it on.",
                "For important accounts, prefer an authenticator app or a passkey over text messages when possible.",
                "Publish your personal number as little as possible; use a second number for ads and strangers.",
                "If your phone suddenly loses service for no reason, contact your provider right away.",
              ],
            },
            {
              h2: "What about the National Do Not Call List?",
              p: [
                `Registering your number on the [National Do Not Call List](${SRC.dncl.en}) (DNCL) reduces legitimate telemarketing calls. The CRTC points out, however, that fraudsters ignore it: you can receive fraudulent calls even if your number is registered.`,
              ],
            },
            {
              h2: "If you were a victim",
              ol: [
                "Contact your financial institution right away if you gave banking information.",
                "Change the passwords of the affected accounts and turn on two-step verification.",
                "Tell your phone provider if you think someone tried to transfer your number.",
                `Report the fraud to the [Canadian Anti-Fraud Centre](${SRC.cafc.en}) (1-888-495-8501) and, if needed, to your police service.`,
              ],
            },
            {
              h2: "With MIMT",
              p: [
                `MIMT shows a “Likely spam” label on doubtful calls and texts, based on simple rules, on every plan. It is a label, not a block: you decide, and callbacks from emergency services always ring through. With your consent, AI can help assess an ambiguous text. See [MIMT AI](${r("en", "ai")}).`,
              ],
            },
          ],
          sources: [
            { label: "CRTC: How to protect yourself from scammers", url: SRC.crtcFraud.en },
            { label: "Canadian Anti-Fraud Centre", url: SRC.cafc.en },
            { label: "National Do Not Call List", url: SRC.dncl.en },
          ],
        },
};

export const GUIDES: readonly Guide[] = [porting, virtualNumber, e911, secondNumber, aiReceptionist, scams];

export function guidePath(g: Guide, lang: Lang): string {
  return `${ROUTES.guides[lang]}${g.slug[lang]}/`;
}

export function guideBySlug(lang: Lang, slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug[lang] === slug);
}

/** Words in the visible article text (headings, paragraphs, lists), links reduced to their label. */
export function guideWordCount(g: Guide, lang: Lang): number {
  const c = g.copy(lang);
  const text = [c.h1, c.intro, ...c.body.flatMap((b) => [b.h2, ...(b.p ?? []), ...(b.ul ?? []), ...(b.ol ?? [])])].join(" ");
  return (text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

/** Rough reading time, at 200 words a minute. */
export function readingMinutes(g: Guide, lang: Lang): number {
  return Math.max(1, Math.round(guideWordCount(g, lang) / 200));
}
