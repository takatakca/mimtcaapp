// « Guides », second batch (2026-10-30): Wi‑Fi calling, comparing second-number apps, business VoIP, Law 25 and
// phone data, choosing a Québec area code. Same rules as lib/guides.ts: French first, official bodies named and
// linked, prices from @mimt/shared, no competitor or carrier names, no urgency wording.

import { PLANS, formatCad, type PlanCode } from "@mimt/shared";
import type { Guide } from "./guides.ts";
import { CCTS_URL, ROUTES, type Lang, type RouteKey } from "./site.ts";

/** Official sources, checked 2026-10-30. */
const SRC = {
  crtc: { fr: "https://crtc.gc.ca/fra/home-accueil.htm", en: "https://crtc.gc.ca/eng/home-accueil.htm" },
  crtcPort: { fr: "https://crtc.gc.ca/fra/phone/mobile/num.htm", en: "https://crtc.gc.ca/eng/phone/mobile/num.htm" },
  crtc911: { fr: "https://crtc.gc.ca/fra/phone/911/voip.htm", en: "https://crtc.gc.ca/eng/phone/911/voip.htm" },
  ised: { fr: "https://ised-isde.canada.ca/site/isde/fr", en: "https://ised-isde.canada.ca/site/ised/en" },
  cai: { fr: "https://www.cai.gouv.qc.ca", en: "https://www.cai.gouv.qc.ca" },
  law25: {
    fr: "https://www.cai.gouv.qc.ca/protection-renseignements-personnels/sujets-et-domaines-dinteret/principaux-changements-loi-25",
    en: "https://www.cai.gouv.qc.ca/protection-renseignements-personnels/sujets-et-domaines-dinteret/principaux-changements-loi-25",
  },
  p391: { fr: "https://www.legisquebec.gouv.qc.ca/fr/document/lc/P-39.1", en: "https://www.legisquebec.gouv.qc.ca/en/document/cs/P-39.1" },
  opc_priv: { fr: "https://www.priv.gc.ca/fr/", en: "https://www.priv.gc.ca/en/" },
  opc: { fr: "https://www.opc.gouv.qc.ca", en: "https://www.opc.gouv.qc.ca/en/" },
  oqlf: { fr: "https://www.oqlf.gouv.qc.ca", en: "https://www.oqlf.gouv.qc.ca" },
  cna: { fr: "https://www.cnac.ca", en: "https://www.cnac.ca" },
} as const;

const r = (lang: Lang, key: RouteKey) => ROUTES[key][lang];
const price = (code: PlanCode, lang: Lang) => formatCad(PLANS[code].monthlyPriceCents, lang);

// ---------------------------------------------------------------------------------------------------------------
// Les appels par Wi‑Fi expliqués simplement

const wifiCalling: Guide = {
  id: "appels-wifi",
  slug: { fr: "appels-wifi-explique", en: "wifi-calling-explained" },
  updated: "2026-10-30",
  related: ["useVirtual", "e911", "webapp"],
  copy: (lang) =>
    lang === "fr"
      ? {
          h1: "Les appels par Wi‑Fi expliqués simplement",
          title: "Appels par Wi‑Fi : comment ça marche",
          description: "Appels Wi‑Fi de votre fournisseur cellulaire ou appels dans une application : les différences, la qualité, les données utilisées, le 9-1-1 et les bons réglages.",
          summary: "La différence entre les appels Wi‑Fi de votre cellulaire et ceux d'une application, ce qui fait la qualité d'un appel et les précautions pour le 9-1-1.",
          intro: "« Appels Wi‑Fi », « téléphonie IP », « VoIP » : on entend ces mots partout, souvent pour désigner des choses différentes. Ce guide explique ce qui se passe vraiment quand vous appelez par Wi‑Fi, pourquoi un appel est parfois parfait et parfois haché, combien de données il consomme et ce qu'il faut savoir pour le 9-1-1.",
          body: [
            {
              h2: "Deux façons d'appeler par Wi‑Fi",
              p: [
                "La première est une fonction de votre fournisseur cellulaire, souvent appelée « Appels Wi‑Fi » dans les réglages du téléphone. Quand le signal cellulaire est faible, par exemple au sous-sol ou dans un chalet, le téléphone fait passer vos appels et vos textos ordinaires par le Wi‑Fi. C'est votre numéro de cellulaire habituel, facturé selon votre forfait cellulaire; vous n'installez rien.",
                "La deuxième passe par une application de téléphonie par Internet. L'application a son propre numéro, ou parfois seulement un identifiant, et elle fonctionne aussi bien par Wi‑Fi que par données mobiles, sur un téléphone, une tablette ou un ordinateur. C'est le principe d'un numéro virtuel ou d'un système téléphonique d'entreprise par Internet. Les deux approches utilisent la même technologie de base, la voix sur IP, mais elles ne dépendent pas du même fournisseur et ne suivent pas les mêmes règles de facturation.",
              ],
            },
            {
              h2: "Ce qui se passe pendant un appel",
              p: [
                "Votre voix est captée par le micro, convertie en données par un codec, découpée en petits paquets, puis envoyée par Internet plusieurs dizaines de fois par seconde. De l'autre côté, les paquets sont remis dans l'ordre et reconvertis en son. Si des paquets arrivent en retard ou se perdent, l'application doit deviner ce qui manque : c'est ce qui donne une voix robotique, des coupures ou un léger écho.",
                "Pour la voix, la vitesse de téléchargement compte moins qu'on le pense. Un appel demande peu de débit, mais il a besoin d'une connexion stable : peu de délai, peu de variation de ce délai et peu de pertes. Une connexion très rapide mais encombrée, par exemple pendant un gros téléchargement ou une vidéo en haute définition sur un autre appareil, peut donner un appel moins bon qu'une connexion modeste mais calme.",
              ],
            },
            {
              h2: "Combien de données un appel utilise",
              p: [
                "Un appel vocal par Internet consomme généralement moins de 1 Mo par minute, selon le codec et la qualité choisie par l'application. Une heure d'appels représente donc quelques dizaines de mégaoctets, beaucoup moins qu'une vidéo. Par Wi‑Fi à la maison, c'est négligeable. Par données mobiles, c'est raisonnable, mais vérifiez votre forfait si vous appelez beaucoup en déplacement. Les appels vidéo, eux, consomment beaucoup plus.",
              ],
            },
            {
              h2: "Améliorer la qualité de vos appels",
              ol: [
                "Rapprochez-vous du routeur ou ajoutez un point d'accès : un mur de béton ou un plancher peut affaiblir beaucoup le signal.",
                "Si votre routeur offre deux bandes, la bande de 5 GHz est souvent moins encombrée, mais porte moins loin que celle de 2,4 GHz. Essayez les deux.",
                "Évitez les gros téléchargements et la vidéo en haute définition sur le même réseau pendant un appel important.",
                "Redémarrez de temps en temps le modem et le routeur, et gardez leur logiciel à jour.",
                "Sur un réseau Wi‑Fi public, attendez d'être bien connecté : certains réseaux exigent d'accepter des conditions dans une page Web avant de laisser passer les appels.",
                "Utilisez des écouteurs avec micro : ils réduisent l'écho et les bruits ambiants.",
                "Gardez l'application et le système du téléphone à jour, et laissez l'application envoyer des notifications, sinon les appels entrants peuvent ne pas sonner.",
              ],
            },
            {
              h2: "Passer du Wi‑Fi aux données mobiles",
              p: [
                "Quand vous sortez de chez vous en pleine conversation, le téléphone passe du Wi‑Fi aux données mobiles. Selon l'application et le téléphone, l'appel peut continuer, faire une courte pause ou couper. Si un appel important commence à la maison et doit continuer dans l'auto, mieux vaut le commencer directement sur les données mobiles, ou rappeler une fois sorti. À l'inverse, désactivez le Wi‑Fi si votre téléphone s'accroche à un réseau faible dont le signal est pire que celui de vos données mobiles.",
              ],
            },
            {
              h2: "En voyage",
              p: [
                "À l'étranger, un appel par une application, sur le Wi‑Fi de l'hôtel, peut vous éviter les frais d'itinérance pour joindre le Canada. Les conditions varient d'un service à l'autre : vérifiez ce que votre forfait inclut et si les appels vers le Canada sont comptés comme des appels locaux. Pour la fonction Appels Wi‑Fi de votre fournisseur cellulaire, les règles de facturation à l'étranger sont celles de ce fournisseur : renseignez-vous avant de partir. Dans tous les cas, désactivez l'itinérance des données si vous voulez être certain de n'utiliser que le Wi‑Fi.",
              ],
            },
            {
              h2: "Le 9-1-1 et les appels par Wi‑Fi",
              p: [
                "C'est le point le plus important. Un appel au 9-1-1 passé par Internet ne permet pas toujours de vous situer automatiquement. Avec la fonction Appels Wi‑Fi de votre fournisseur cellulaire, celui-ci vous demande d'habitude d'inscrire une adresse d'urgence. Avec une application de téléphonie par Internet, le Conseil de la radiodiffusion et des télécommunications canadiennes (CRTC) exige que le fournisseur vous informe des limites du 9-1-1 et vous demande l'adresse où vous utilisez le service. Gardez cette adresse à jour, et sachez que sans Internet ou sans courant, l'appel ne passera pas. Lisez notre [guide sur le 9-1-1 et la téléphonie par Internet](/guides/9-1-1-telephonie-internet/) pour les détails.",
              ],
            },
            {
              h2: "Qui encadre quoi",
              p: [
                "Le Wi‑Fi utilise des bandes de fréquences radio dont la gestion relève d'Innovation, Sciences et Développement économique Canada (ISDE), qui certifie aussi les appareils radio vendus au Canada, comme les routeurs et les téléphones. Les services de téléphonie, eux, sont encadrés par le CRTC, notamment pour le 9-1-1 et la transférabilité des numéros. Si vous avez un problème non réglé avec un fournisseur de téléphonie, la Commission des plaintes relatives aux services de télécom-télévision (CPRST) peut vous aider.",
              ],
            },
            {
              h2: "Avec MIMT",
              p: [
                `MIMT est une application de téléphonie par Internet : votre numéro canadien fonctionne par Wi‑Fi ou par données mobiles, sur votre cellulaire et dans votre navigateur à app.mimt.ca. Vous gardez votre forfait cellulaire et sa fonction Appels Wi‑Fi; MIMT s'y ajoute. Avant votre premier appel vers un numéro de téléphone, l'app vous demande votre adresse pour le 9-1-1. Voir [l'App Web](${r("fr", "webapp")}) et [les limites du 9-1-1](${r("fr", "e911")}).`,
              ],
            },
          ],
          sources: [
            { label: "CRTC : Obligations des fournisseurs de services VoIP locaux à l'égard du 9-1-1", url: SRC.crtc911.fr },
            { label: "Innovation, Sciences et Développement économique Canada (ISDE)", url: SRC.ised.fr },
            { label: "Commission des plaintes relatives aux services de télécom-télévision (CPRST)", url: CCTS_URL },
          ],
        }
      : {
          h1: "Wi‑Fi calling explained simply",
          title: "Wi‑Fi calling: how it works",
          description: "Your carrier's Wi‑Fi calling versus calls in an app: the differences, call quality, data use, 9-1-1 and the right settings.",
          summary: "The difference between your phone's Wi‑Fi calling and calls in an app, what makes call quality and the precautions for 9-1-1.",
          intro: "\"Wi‑Fi calling\", \"IP telephony\", \"VoIP\": these words are everywhere, often for different things. This guide explains what really happens when you call over Wi‑Fi, why a call is sometimes perfect and sometimes choppy, how much data it uses and what to know about 9-1-1.",
          body: [
            {
              h2: "Two ways to call over Wi‑Fi",
              p: [
                "The first is a feature of your mobile carrier, often called \"Wi‑Fi Calling\" in the phone's settings. When the cellular signal is weak, for example in a basement or at a cottage, the phone sends your ordinary calls and texts over Wi‑Fi. It is your usual mobile number, billed under your mobile plan; you install nothing.",
                "The second goes through an internet phone app. The app has its own number, or sometimes only a handle, and it works over Wi‑Fi or mobile data alike, on a phone, a tablet or a computer. That is how a virtual number or an internet business phone system works. Both approaches use the same basic technology, voice over IP, but they don't depend on the same provider and don't follow the same billing rules.",
              ],
            },
            {
              h2: "What happens during a call",
              p: [
                "Your voice is picked up by the microphone, turned into data by a codec, cut into small packets, then sent over the internet dozens of times per second. On the other side, the packets are put back in order and turned back into sound. If packets arrive late or get lost, the app has to guess what is missing: that is what causes a robotic voice, dropouts or a slight echo.",
                "For voice, download speed matters less than people think. A call needs little bandwidth, but it needs a stable connection: little delay, little variation in that delay and little loss. A very fast but busy connection, for example during a big download or a high-definition video on another device, can give a worse call than a modest but quiet connection.",
              ],
            },
            {
              h2: "How much data a call uses",
              p: [
                "An internet voice call usually uses less than 1 MB per minute, depending on the codec and the quality the app chooses. An hour of calls is therefore a few dozen megabytes, much less than a video. Over Wi‑Fi at home, it is negligible. Over mobile data, it is reasonable, but check your plan if you call a lot on the go. Video calls use much more.",
              ],
            },
            {
              h2: "Improving your call quality",
              ol: [
                "Move closer to the router or add an access point: a concrete wall or a floor can weaken the signal a lot.",
                "If your router has two bands, the 5 GHz band is often less crowded but reaches less far than 2.4 GHz. Try both.",
                "Avoid big downloads and high-definition video on the same network during an important call.",
                "Restart the modem and router from time to time, and keep their software up to date.",
                "On public Wi‑Fi, wait until you are fully connected: some networks require you to accept terms on a web page before calls can go through.",
                "Use earphones with a microphone: they reduce echo and background noise.",
                "Keep the app and the phone's system up to date, and let the app send notifications, otherwise incoming calls may not ring.",
              ],
            },
            {
              h2: "Moving from Wi‑Fi to mobile data",
              p: [
                "When you leave home in the middle of a conversation, the phone switches from Wi‑Fi to mobile data. Depending on the app and the phone, the call may continue, pause briefly or drop. If an important call starts at home and has to continue in the car, it is better to start it on mobile data, or to call back once you are out. On the other hand, turn off Wi‑Fi if your phone clings to a weak network whose signal is worse than your mobile data.",
              ],
            },
            {
              h2: "Travelling",
              p: [
                "Abroad, a call through an app over the hotel Wi‑Fi can save you roaming charges to reach Canada. Conditions vary from one service to another: check what your plan includes and whether calls to Canada count as local calls. For your carrier's Wi‑Fi Calling feature, the billing rules abroad are your carrier's: ask before you leave. Either way, turn off data roaming if you want to be sure to use Wi‑Fi only.",
              ],
            },
            {
              h2: "9-1-1 and Wi‑Fi calls",
              p: [
                "This is the most important point. A 9-1-1 call over the internet does not always let emergency services locate you automatically. With your carrier's Wi‑Fi Calling, the carrier usually asks you to register an emergency address. With an internet phone app, the Canadian Radio-television and Telecommunications Commission (CRTC) requires the provider to tell you about 9-1-1 limits and ask for the address where you use the service. Keep that address up to date, and know that with no internet or no power, the call will not go through. Read our [guide to 9-1-1 and internet phone service](/en/guides/9-1-1-internet-phone-service/) for details.",
              ],
            },
            {
              h2: "Who oversees what",
              p: [
                "Wi‑Fi uses radio frequency bands managed by Innovation, Science and Economic Development Canada (ISED), which also certifies radio devices sold in Canada, such as routers and phones. Phone services are overseen by the CRTC, in particular for 9-1-1 and number portability. If you have an unresolved problem with a phone provider, the Commission for Complaints for Telecom-television Services (CCTS) can help.",
              ],
            },
            {
              h2: "With MIMT",
              p: [
                `MIMT is an internet phone app: your Canadian number works over Wi‑Fi or mobile data, on your mobile and in your browser at app.mimt.ca. You keep your mobile plan and its Wi‑Fi Calling feature; MIMT adds to it. Before your first call to a phone number, the app asks for your 9-1-1 address. See [the web app](${r("en", "webapp")}) and [the 9-1-1 limits](${r("en", "e911")}).`,
              ],
            },
          ],
          sources: [
            { label: "CRTC: Obligations of local VoIP service providers regarding 9-1-1", url: SRC.crtc911.en },
            { label: "Innovation, Science and Economic Development Canada (ISED)", url: SRC.ised.en },
            { label: "Commission for Complaints for Telecom-television Services (CCTS)", url: CCTS_URL },
          ],
        },
};

// ---------------------------------------------------------------------------------------------------------------
// Comment comparer les applications de deuxième numéro

const compareApps: Guide = {
  id: "comparer-applications",
  slug: { fr: "comparer-applications-deuxieme-numero", en: "compare-second-number-apps" },
  updated: "2026-10-30",
  related: ["compare", "plans", "useSecond"],
  copy: (lang) =>
    lang === "fr"
      ? {
          h1: "Comment comparer les applications de deuxième numéro",
          title: "Comparer les applications de deuxième numéro",
          description: "Prix réel, type de numéro, 9-1-1, confidentialité, soutien en français : les critères pour choisir une application de deuxième numéro au Canada.",
          summary: "Une grille de critères simple pour comparer les applications de deuxième numéro : prix réel, numéro, 9-1-1, confidentialité et français.",
          intro: "Les applications qui donnent un deuxième numéro se ressemblent toutes à première vue : une icône, un numéro, un bouton pour appeler. Les différences apparaissent après quelques semaines, sur la facture, au moment de transférer le numéro ou le jour où vous avez besoin du 9-1-1. Voici les critères à vérifier avant de choisir, et les questions à poser à n'importe quel fournisseur.",
          body: [
            {
              h2: "1. Le prix réel, pas le prix affiché",
              p: [
                "Comparez le prix total pour un mois normal d'utilisation, pas seulement le prix d'appel. Additionnez le forfait, les taxes (TPS et TVQ au Québec), la taxe municipale 9-1-1 s'il y a lieu, les frais de numéro, les options payantes et les frais de transfert. Un service gratuit financé par la publicité peut convenir pour un usage occasionnel, mais lisez ce qu'il exige en échange : publicités, limites de minutes, numéro récupéré après une période d'inactivité.",
              ],
              ul: [
                "Combien de minutes et de textos sont inclus, et vers quelles destinations?",
                "Que se passe-t-il quand la limite est atteinte : blocage, frais par minute ou passage automatique à un forfait plus cher?",
                "Le prix annoncé est-il mensuel ou annuel? Y a-t-il un engagement?",
                "Les messages photo (MMS), la transcription de la messagerie vocale ou le renvoi d'appels sont-ils inclus ou en option?",
              ],
            },
            {
              h2: "2. Le numéro lui-même",
              p: [
                "Vérifiez que l'application vous donne un vrai numéro canadien à dix chiffres, avec l'indicatif régional que vous voulez, et non seulement un identifiant utilisable dans l'application. Demandez ce qui arrive au numéro si vous cessez de l'utiliser quelques semaines, et si vous pouvez le garder en changeant de forfait. Surtout, vérifiez que vous pouvez transférer le numéro chez un autre fournisseur si vous partez : un numéro que vous ne pouvez pas emporter vous attache au service.",
              ],
            },
            {
              h2: "3. Le 9-1-1",
              p: [
                "Une application qui permet d'appeler des numéros de téléphone ordinaires au Canada doit, selon les règles du Conseil de la radiodiffusion et des télécommunications canadiennes (CRTC), donner accès au 9-1-1 et vous informer de ses limites. Un service sérieux vous présente un avis 9-1-1 clair, vous demande l'adresse où vous utilisez le service et vous permet de la modifier facilement. Méfiez-vous d'un service qui n'en parle pas du tout, ou qui bloque le 9-1-1 quand votre crédit est épuisé.",
              ],
            },
            {
              h2: "4. La confidentialité",
              p: [
                "Un deuxième numéro sert souvent à protéger votre vie privée. Il serait dommage que l'application fasse le contraire. Lisez la politique de confidentialité en cherchant des réponses précises :",
              ],
              ul: [
                "Qui est la personne responsable de la protection des renseignements personnels, et comment la joindre?",
                "Où sont conservés vos textos, vos messages vocaux et vos registres d'appels, et pendant combien de temps?",
                "Les publicités sont-elles personnalisées par défaut? Pouvez-vous refuser?",
                "Les fonctions d'intelligence artificielle lisent-elles vos messages? Avec votre consentement distinct, ou par défaut?",
                "Pouvez-vous supprimer votre compte vous-même, et qu'est-ce qui est réellement effacé?",
              ],
            },
            {
              h2: "5. Le français et le soutien",
              p: [
                "Au Québec, vous avez le droit d'être servi en français. Vérifiez que l'application, ses messages, ses factures, ses conditions et son service à la clientèle sont offerts en français, et pas seulement traduits à moitié. Regardez aussi comment joindre le soutien : formulaire, courriel, délai de réponse annoncé, et processus de plainte écrit. Un fournisseur qui explique comment s'adresser à la Commission des plaintes relatives aux services de télécom-télévision (CPRST) quand une plainte n'est pas réglée montre qu'il connaît ses obligations.",
              ],
            },
            {
              h2: "6. L'usage au quotidien",
              ul: [
                "Fonctionne-t-elle sur plusieurs appareils à la fois : cellulaire, tablette, ordinateur?",
                "Les appels entrants sonnent-ils de façon fiable quand l'application est fermée?",
                "Peut-on régler des heures de silence, bloquer un numéro, personnaliser la messagerie vocale?",
                "Les codes de vérification envoyés par texto sont-ils reçus? Certaines plateformes refusent les numéros par Internet; testez avec les services qui comptent pour vous.",
                "L'application affiche-t-elle clairement votre consommation de minutes et de textos?",
              ],
            },
            {
              h2: "7. Ce qui arrive le jour où vous partez",
              p: [
                "On choisit un service en pensant au premier jour, rarement au dernier. Pourtant, c'est là que les différences se voient. Avant de vous abonner, cherchez dans les conditions comment annuler (dans l'application, par courriel, par téléphone), si l'abonnement reste actif jusqu'à la fin de la période payée, et comment se passe un remboursement. Vérifiez aussi ce que devient votre numéro : pouvez-vous le transférer ailleurs, et dans quel délai? Enfin, regardez la politique de confidentialité : vos textos, vos messages vocaux et vos registres sont-ils supprimés après la fermeture du compte, et après combien de jours?",
              ],
            },
            {
              h2: "Une méthode simple pour décider",
              p: [
                "Dressez un petit tableau avec les critères qui comptent pour vous, par exemple le prix total, le transfert du numéro, le 9-1-1, la confidentialité et le français, et notez chaque service de 1 à 3 en vous basant uniquement sur ce qui est écrit dans ses conditions et sa politique de confidentialité. Méfiez-vous des promesses floues comme « illimité » sans limite d'utilisation raisonnable précisée, et des comparaisons qui ne citent pas leurs sources. Si une offre vous pousse à décider tout de suite, prenez au contraire le temps de lire.",
                "L'Office de la protection du consommateur du Québec rappelle aussi vos droits pour les contrats de services à distance, et Innovation, Sciences et Développement économique Canada (ISDE) publie de l'information sur les services de télécommunication au Canada.",
              ],
            },
            {
              h2: "Avec MIMT",
              p: [
                `Pour être transparents, voici nos propres réponses : forfaits Essentiel (${price("lock", "fr")}/mois) et Premium (${price("premium", "fr")}/mois) avec limites affichées d'avance, taxes en sus; vrai numéro canadien, transfert vers MIMT sans frais MIMT; avis 9-1-1 et adresse demandés avant le premier appel vers un numéro de téléphone, 9-1-1 jamais bloqué; publicité personnalisée et IA désactivées par défaut; français d'abord. Notre [page de comparaison](${r("fr", "compare")}) cite ses sources, et [nos forfaits](${r("fr", "plans")}) détaillent chaque limite.`,
              ],
            },
          ],
          sources: [
            { label: "CRTC : Obligations des fournisseurs de services VoIP locaux à l'égard du 9-1-1", url: SRC.crtc911.fr },
            { label: "CRTC : Changez de fournisseur et conservez votre numéro", url: SRC.crtcPort.fr },
            { label: "Commission des plaintes relatives aux services de télécom-télévision (CPRST)", url: CCTS_URL },
            { label: "Commission d'accès à l'information du Québec (CAI)", url: SRC.cai.fr },
            { label: "Office de la protection du consommateur", url: SRC.opc.fr },
            { label: "Innovation, Sciences et Développement économique Canada (ISDE)", url: SRC.ised.fr },
          ],
        }
      : {
          h1: "How to compare second-number apps",
          title: "How to compare second-number apps",
          description: "Real price, type of number, 9-1-1, privacy, French-language support: the criteria for choosing a second-number app in Canada.",
          summary: "A simple checklist to compare second-number apps: real price, the number, 9-1-1, privacy and French.",
          intro: "Apps that give you a second number all look alike at first: an icon, a number, a button to call. The differences show up after a few weeks, on the bill, when you try to port the number, or the day you need 9-1-1. Here are the criteria to check before choosing, and the questions to ask any provider.",
          body: [
            {
              h2: "1. The real price, not the advertised price",
              p: [
                "Compare the total price for a normal month of use, not just the price per call. Add up the plan, taxes (GST and QST in Québec), the 9-1-1 municipal tax if any, number fees, paid add-ons and porting fees. A free service paid for by ads may suit occasional use, but read what it asks in return: ads, minute limits, a number reclaimed after a period of inactivity.",
              ],
              ul: [
                "How many minutes and texts are included, and to which destinations?",
                "What happens when you reach the limit: blocking, per-minute charges or an automatic move to a pricier plan?",
                "Is the advertised price monthly or yearly? Is there a commitment?",
                "Are picture messages (MMS), voicemail transcription or call forwarding included or extra?",
              ],
            },
            {
              h2: "2. The number itself",
              p: [
                "Check that the app gives you a real ten-digit Canadian number, with the area code you want, and not just a handle usable inside the app. Ask what happens to the number if you stop using it for a few weeks, and whether you can keep it when you change plans. Above all, check that you can port the number to another provider if you leave: a number you can't take with you ties you to the service.",
              ],
            },
            {
              h2: "3. 9-1-1",
              p: [
                "An app that lets you call ordinary phone numbers in Canada must, under the rules of the Canadian Radio-television and Telecommunications Commission (CRTC), give access to 9-1-1 and tell you about its limits. A serious service shows you a clear 9-1-1 notice, asks for the address where you use the service and lets you change it easily. Be wary of a service that doesn't mention it at all, or that blocks 9-1-1 when your credit runs out.",
              ],
            },
            {
              h2: "4. Privacy",
              p: [
                "A second number is often meant to protect your privacy. It would be a shame if the app did the opposite. Read the privacy policy looking for precise answers:",
              ],
              ul: [
                "Who is the person in charge of the protection of personal information, and how do you reach them?",
                "Where are your texts, voicemails and call records stored, and for how long?",
                "Are ads personalized by default? Can you say no?",
                "Do artificial intelligence features read your messages? With your separate consent, or by default?",
                "Can you delete your account yourself, and what is actually erased?",
              ],
            },
            {
              h2: "5. French and support",
              p: [
                "In Québec, you have the right to be served in French. Check that the app, its messages, invoices, terms and customer service are available in French, and not just half translated. Also look at how to reach support: form, email, a stated response time, and a written complaints process. A provider that explains how to go to the Commission for Complaints for Telecom-television Services (CCTS) when a complaint isn't resolved shows that it knows its obligations.",
              ],
            },
            {
              h2: "6. Everyday use",
              ul: [
                "Does it work on several devices at once: phone, tablet, computer?",
                "Do incoming calls ring reliably when the app is closed?",
                "Can you set quiet hours, block a number, customize voicemail?",
                "Are verification codes sent by text received? Some platforms refuse internet phone numbers; test with the services that matter to you.",
                "Does the app show your minute and text usage clearly?",
              ],
            },
            {
              h2: "7. What happens the day you leave",
              p: [
                "People choose a service thinking about the first day, rarely the last. Yet that is where the differences show. Before you subscribe, look in the terms for how to cancel (in the app, by email, by phone), whether the subscription stays active until the end of the paid period, and how refunds work. Also check what becomes of your number: can you port it elsewhere, and how quickly? Finally, look at the privacy policy: are your texts, voicemails and records deleted after the account closes, and after how many days?",
              ],
            },
            {
              h2: "A simple way to decide",
              p: [
                "Draw a small table with the criteria that matter to you, for example total price, number porting, 9-1-1, privacy and French, and score each service from 1 to 3 based only on what its terms and privacy policy say. Be wary of vague promises such as \"unlimited\" with no stated fair-use limit, and of comparisons that don't cite their sources. If an offer pushes you to decide right now, take the time to read instead.",
                "Québec's Office de la protection du consommateur also explains your rights for distance service contracts, and Innovation, Science and Economic Development Canada (ISED) publishes information about telecommunications services in Canada.",
              ],
            },
            {
              h2: "With MIMT",
              p: [
                `To be transparent, here are our own answers: Essential (${price("lock", "en")}/month) and Premium (${price("premium", "en")}/month) plans with limits shown up front, taxes extra; a real Canadian number, porting to MIMT with no MIMT fee; 9-1-1 notice and address requested before the first call to a phone number, 9-1-1 never blocked; personalized ads and AI off by default; French first. Our [comparison page](${r("en", "compare")}) cites its sources, and [our plans](${r("en", "plans")}) list every limit.`,
              ],
            },
          ],
          sources: [
            { label: "CRTC: Obligations of local VoIP service providers regarding 9-1-1", url: SRC.crtc911.en },
            { label: "CRTC: Switch providers and keep your number", url: SRC.crtcPort.en },
            { label: "Commission for Complaints for Telecom-television Services (CCTS)", url: CCTS_URL },
            { label: "Commission d'accès à l'information du Québec (CAI)", url: SRC.cai.en },
            { label: "Office de la protection du consommateur (Québec)", url: SRC.opc.en },
            { label: "Innovation, Science and Economic Development Canada (ISED)", url: SRC.ised.en },
          ],
        },
};

// ---------------------------------------------------------------------------------------------------------------
// La téléphonie IP pour les petites entreprises du Québec

const businessVoip: Guide = {
  id: "telephonie-ip-pme",
  slug: { fr: "telephonie-ip-petite-entreprise", en: "voip-for-small-business" },
  updated: "2026-10-30",
  related: ["useVoip", "business", "ai"],
  copy: (lang) =>
    lang === "fr"
      ? {
          h1: "La téléphonie IP pour les petites entreprises du Québec",
          title: "Téléphonie IP pour petite entreprise : le guide",
          description: "Ce qu'un système téléphonique par Internet apporte à une petite entreprise : fonctions, connexion nécessaire, transfert du numéro, 9-1-1, français et coûts à prévoir.",
          summary: "Ce qu'un standard téléphonique par Internet fait, ce qu'il demande comme connexion, et les points à régler : numéro, 9-1-1, français, enregistrement.",
          intro: "Pendant longtemps, un système téléphonique d'entreprise voulait dire une boîte dans un placard, des téléphones de bureau et un contrat de plusieurs années. Aujourd'hui, une petite entreprise peut avoir les mêmes fonctions dans une application, sur les cellulaires et les ordinateurs de son équipe. Ce guide explique comment ça fonctionne, ce qu'il faut vérifier avant de changer et les règles à respecter au Québec.",
          body: [
            {
              h2: "Ce qu'est la téléphonie IP",
              p: [
                "La téléphonie IP, ou voix sur IP (VoIP), transporte les appels par Internet au lieu d'une ligne téléphonique traditionnelle. Dans un système d'entreprise hébergé, le « standard » qui répartit les appels n'est plus un appareil chez vous : il fonctionne chez le fournisseur, et vous le configurez dans un portail Web. Les employés répondent dans une application, sur leur cellulaire ou leur ordinateur, ou sur un téléphone de bureau compatible si l'entreprise en a déjà.",
              ],
            },
            {
              h2: "Les fonctions qui changent le quotidien",
              ul: [
                "Accueil automatique : « Pour le service en français, faites le 1; for service in English, press 2 », puis le choix d'un service ou d'un poste.",
                "Postes et numéros directs : chaque employé a son poste, et au besoin son propre numéro.",
                "Groupes de sonnerie : un appel fait sonner plusieurs personnes à la fois ou l'une après l'autre.",
                "Heures d'ouverture : en dehors des heures, et les jours fériés, l'appel va à la messagerie ou à un message adapté.",
                "Messagerie vocale par poste, avec avis par courriel.",
                "Renvoi vers le cellulaire : l'employé sur la route ne manque pas l'appel, et son numéro personnel reste privé.",
                "Rapports d'appels : qui a appelé, quand, et quels appels ont été manqués.",
              ],
            },
            {
              h2: "La connexion Internet nécessaire",
              p: [
                "La voix demande peu de débit, de l'ordre d'une centaine de kilobits par seconde par appel en cours, mais elle a besoin d'une connexion stable. Pour une petite équipe, une connexion Internet d'affaires ordinaire suffit généralement; ce qui compte, c'est le nombre d'appels simultanés, et ce que le reste du bureau fait pendant ce temps. Si vos employés téléversent de gros fichiers ou font beaucoup de vidéoconférences, un routeur qui donne la priorité à la voix (qualité de service, ou QoS) fait une vraie différence.",
                "Pensez aussi aux pannes. Que se passe-t-il si Internet coupe au bureau? Un bon système renvoie alors les appels vers les cellulaires ou la messagerie, au lieu de laisser sonner dans le vide. Vérifiez ce réglage avant d'en avoir besoin.",
              ],
            },
            {
              h2: "Garder le numéro de l'entreprise",
              p: [
                "Le numéro principal est un actif de l'entreprise : il est sur l'enseigne, le site Web et les factures. Au Canada, la transférabilité des numéros, encadrée par le Conseil de la radiodiffusion et des télécommunications canadiennes (CRTC), permet généralement de l'apporter chez le nouveau fournisseur. La règle d'or : ne résiliez pas l'ancien service avant que le transfert soit terminé. Notre [guide sur le transfert de numéro](/guides/garder-son-numero-transfert/) explique les étapes.",
              ],
            },
            {
              h2: "Le 9-1-1 quand l'équipe travaille partout",
              p: [
                "Avec un système par Internet, un employé peut répondre au bureau, chez lui ou sur un chantier. Comme pour tout service nomade, le réseau ne connaît pas automatiquement l'endroit d'où part un appel au 9-1-1. L'adresse associée à chaque ligne doit être tenue à jour, et chaque employé doit connaître les limites du service. Gardez un téléphone fixe ou un cellulaire accessible là où des gens travaillent seuls.",
              ],
            },
            {
              h2: "Le français d'abord",
              p: [
                "Au Québec, la Charte de la langue française donne aux consommateurs le droit d'être informés et servis en français. Votre accueil téléphonique, vos messages d'attente et votre messagerie vocale devraient donc commencer en français, puis offrir l'anglais au besoin. L'Office québécois de la langue française (OQLF) publie de l'information pour les entreprises sur ces obligations.",
              ],
            },
            {
              h2: "Enregistrer les appels et utiliser l'IA",
              p: [
                "Enregistrer les appels peut servir à la formation ou à régler un litige, mais ce sont des renseignements personnels. Selon la Loi 25, informez clairement l'appelant avant l'enregistrement, n'enregistrez que pour une raison précise, limitez l'accès, fixez une durée de conservation et supprimez ensuite. Il en va de même pour les transcriptions et les résumés produits par l'intelligence artificielle. La Commission d'accès à l'information du Québec (CAI) publie des guides pour les entreprises.",
              ],
            },
            {
              h2: "Les coûts à prévoir",
              ul: [
                "L'abonnement, généralement par ligne (par employé) et par mois.",
                "Les taxes, et la taxe municipale 9-1-1 du Québec si elle s'applique.",
                "Les numéros supplémentaires, le numéro sans frais ou les appels interurbains, s'ils ne sont pas inclus.",
                "Les appareils, seulement si vous voulez des téléphones de bureau ou des casques : une application suffit souvent.",
                "Le temps de configuration : prévoyez une heure ou deux pour l'accueil, les postes et les heures d'ouverture.",
              ],
            },
            {
              h2: "Passer à la téléphonie IP en cinq étapes",
              ol: [
                "Faites la liste de vos numéros, de vos employés et de ce que doit faire chaque appel entrant.",
                "Vérifiez votre connexion Internet et votre routeur.",
                "Configurez le nouveau système avec un numéro temporaire et testez-le avec votre équipe.",
                "Demandez le transfert de votre numéro principal, sans résilier l'ancien service.",
                "Le jour du transfert, faites des appels d'essai, puis résiliez l'ancien service une fois tout confirmé.",
              ],
            },
            {
              h2: "Avec MIMT",
              p: [
                `MIMT Affaires est un système téléphonique par Internet pensé pour le Québec : postes, accueil bilingue, groupes de sonnerie, heures d'ouverture avec les jours fériés du Québec, renvoi vers le cellulaire et, avec Affaires Pro, enregistrement des appels toujours annoncé. Prix par ligne : ${price("business", "fr")} par mois pour Affaires, ${price("business_pro", "fr")} pour Affaires Pro, taxes en sus, sans appareil à acheter. Voir [MIMT Affaires](${r("fr", "business")}) et [la téléphonie IP d'affaires](${r("fr", "useVoip")}).`,
              ],
            },
          ],
          sources: [
            { label: "CRTC : Changez de fournisseur et conservez votre numéro", url: SRC.crtcPort.fr },
            { label: "CRTC : Obligations des fournisseurs de services VoIP locaux à l'égard du 9-1-1", url: SRC.crtc911.fr },
            { label: "Office québécois de la langue française (OQLF)", url: SRC.oqlf.fr },
            { label: "Commission d'accès à l'information du Québec (CAI)", url: SRC.cai.fr },
            { label: "Innovation, Sciences et Développement économique Canada (ISDE)", url: SRC.ised.fr },
          ],
        }
      : {
          h1: "VoIP phone systems for small businesses in Québec",
          title: "VoIP for small business: the guide",
          description: "What an internet phone system brings a small business: features, the connection it needs, porting the number, 9-1-1, French and the costs to plan for.",
          summary: "What an internet phone system does, what connection it needs, and the points to settle: number, 9-1-1, French, recording.",
          intro: "For a long time, a business phone system meant a box in a closet, desk phones and a contract of several years. Today, a small business can get the same features in an app, on its team's mobiles and computers. This guide explains how it works, what to check before switching and the rules to follow in Québec.",
          body: [
            {
              h2: "What IP telephony is",
              p: [
                "IP telephony, or voice over IP (VoIP), carries calls over the internet instead of a traditional phone line. In a hosted business system, the \"switchboard\" that routes calls is no longer a device at your place: it runs at the provider, and you configure it in a web portal. Staff answer in an app, on their mobile or computer, or on a compatible desk phone if the business already has some.",
              ],
            },
            {
              h2: "The features that change everyday work",
              ul: [
                "Auto attendant: \"Pour le service en français, faites le 1; for service in English, press 2\", then a choice of department or extension.",
                "Extensions and direct numbers: each employee has an extension and, if needed, their own number.",
                "Ring groups: a call rings several people at once or one after another.",
                "Business hours: after hours and on statutory holidays, the call goes to voicemail or a suitable message.",
                "Voicemail per extension, with email notices.",
                "Forwarding to a mobile: an employee on the road doesn't miss the call, and their personal number stays private.",
                "Call reports: who called, when, and which calls were missed.",
              ],
            },
            {
              h2: "The internet connection you need",
              p: [
                "Voice needs little bandwidth, around a hundred kilobits per second per active call, but it needs a stable connection. For a small team, an ordinary business internet connection is usually enough; what matters is the number of simultaneous calls, and what the rest of the office is doing at the same time. If staff upload large files or hold many video meetings, a router that gives priority to voice (quality of service, or QoS) makes a real difference.",
                "Think about outages too. What happens if the office internet goes down? A good system then forwards calls to mobiles or to voicemail instead of letting them ring into the void. Check this setting before you need it.",
              ],
            },
            {
              h2: "Keeping the business number",
              p: [
                "The main number is a business asset: it is on the sign, the website and the invoices. In Canada, number portability, overseen by the Canadian Radio-television and Telecommunications Commission (CRTC), generally lets you bring it to the new provider. The golden rule: don't cancel the old service before the port is complete. Our [guide to porting your number](/en/guides/keep-your-number-porting/) explains the steps.",
              ],
            },
            {
              h2: "9-1-1 when the team works everywhere",
              p: [
                "With an internet system, an employee can answer at the office, at home or on a job site. As with any nomadic service, the network doesn't automatically know where a 9-1-1 call comes from. The address tied to each line must be kept up to date, and every employee must know the service's limits. Keep a landline or a mobile within reach where people work alone.",
              ],
            },
            {
              h2: "French first",
              p: [
                "In Québec, the Charter of the French language gives consumers the right to be informed and served in French. Your phone greeting, hold messages and voicemail should therefore start in French, then offer English as needed. The Office québécois de la langue française (OQLF) publishes information for businesses about these obligations.",
              ],
            },
            {
              h2: "Recording calls and using AI",
              p: [
                "Recording calls can help with training or settling a dispute, but recordings are personal information. Under Law 25, tell the caller clearly before recording, record only for a specific reason, limit access, set a retention period and delete afterwards. The same goes for transcripts and summaries produced by artificial intelligence. Québec's Commission d'accès à l'information (CAI) publishes guides for businesses.",
              ],
            },
            {
              h2: "The costs to plan for",
              ul: [
                "The subscription, usually per line (per employee) per month.",
                "Taxes, and Québec's 9-1-1 municipal tax where it applies.",
                "Extra numbers, a toll-free number or long-distance calls, if they are not included.",
                "Devices, only if you want desk phones or headsets: an app is often enough.",
                "Setup time: plan an hour or two for the greeting, extensions and business hours.",
              ],
            },
            {
              h2: "Switching to VoIP in five steps",
              ol: [
                "List your numbers, your staff and what each incoming call should do.",
                "Check your internet connection and your router.",
                "Set up the new system with a temporary number and test it with your team.",
                "Request the port of your main number, without cancelling the old service.",
                "On the day of the port, make test calls, then cancel the old service once everything is confirmed.",
              ],
            },
            {
              h2: "With MIMT",
              p: [
                `MIMT Business is an internet phone system built for Québec: extensions, bilingual greeting, ring groups, business hours with Québec statutory holidays, forwarding to mobiles and, with Business Pro, call recording that is always announced. Price per line: ${price("business", "en")} a month for Business, ${price("business_pro", "en")} for Business Pro, taxes extra, with no hardware to buy. See [MIMT Business](${r("en", "business")}) and [business VoIP](${r("en", "useVoip")}).`,
              ],
            },
          ],
          sources: [
            { label: "CRTC: Switch providers and keep your number", url: SRC.crtcPort.en },
            { label: "CRTC: Obligations of local VoIP service providers regarding 9-1-1", url: SRC.crtc911.en },
            { label: "Office québécois de la langue française (OQLF)", url: SRC.oqlf.en },
            { label: "Commission d'accès à l'information du Québec (CAI)", url: SRC.cai.en },
            { label: "Innovation, Science and Economic Development Canada (ISED)", url: SRC.ised.en },
          ],
        },
};

// ---------------------------------------------------------------------------------------------------------------
// La Loi 25 et vos données téléphoniques

const law25: Guide = {
  id: "loi-25",
  slug: { fr: "loi-25-donnees-telephoniques", en: "law-25-phone-data" },
  updated: "2026-10-30",
  related: ["privacy", "ai", "business"],
  copy: (lang) =>
    lang === "fr"
      ? {
          h1: "La Loi 25 et vos données téléphoniques",
          title: "Loi 25 et données téléphoniques : vos droits",
          description: "Registres d'appels, textos, messages vocaux, enregistrements : ce que protège la Loi 25 du Québec, vos droits et les obligations des entreprises.",
          summary: "Ce que la Loi 25 change pour vos registres d'appels, textos, messages vocaux et enregistrements, vos droits et les obligations des entreprises.",
          intro: "Votre téléphone produit beaucoup de renseignements personnels : qui vous appelez, quand, combien de temps, ce que vous écrivez, ce que vous laissez dans une boîte vocale. Au Québec, la Loi 25 a renforcé la protection de ces renseignements. Ce guide explique ce qu'elle protège, les droits qu'elle vous donne et ce qu'elle exige des entreprises, qu'elles soient votre fournisseur de téléphonie ou un commerce qui enregistre ses appels.",
          body: [
            {
              h2: "La Loi 25 en bref",
              p: [
                "La « Loi 25 » est le nom courant de la Loi modernisant des dispositions législatives en matière de protection des renseignements personnels, adoptée en 2021. Elle a modifié la Loi sur la protection des renseignements personnels dans le secteur privé, qui s'applique aux entreprises qui recueillent des renseignements sur des personnes au Québec. Ses obligations sont entrées en vigueur en trois étapes, en septembre 2022, 2023 et 2024. La Commission d'accès à l'information du Québec (CAI) veille à son application.",
                "Les entreprises de télécommunication peuvent aussi être soumises à des règles fédérales : la Loi sur la protection des renseignements personnels et les documents électroniques (LPRPDE), sous la surveillance du Commissariat à la protection de la vie privée du Canada, et des règles du Conseil de la radiodiffusion et des télécommunications canadiennes (CRTC) sur la confidentialité des renseignements des clients.",
              ],
            },
            {
              h2: "Quelles données téléphoniques sont protégées",
              p: [
                "Un renseignement personnel est tout renseignement qui concerne une personne et permet de l'identifier, directement ou indirectement. Au téléphone, cela comprend :",
              ],
              ul: [
                "votre numéro de téléphone, votre nom et l'adresse de votre compte;",
                "les registres d'appels et de textos : numéros, dates, heures et durées, même sans le contenu;",
                "le contenu de vos textos, de vos photos et de vos messages vocaux;",
                "les enregistrements d'appels et leurs transcriptions, y compris les résumés produits par l'intelligence artificielle;",
                "l'adresse que vous inscrivez pour le 9-1-1;",
                "les renseignements techniques liés à votre compte, comme l'adresse IP ou le modèle d'appareil.",
              ],
            },
            {
              h2: "Ce que la loi exige des entreprises",
              ul: [
                "Désigner une personne responsable de la protection des renseignements personnels. Par défaut, c'est la personne qui a la plus haute autorité dans l'entreprise; son titre et ses coordonnées doivent être publiés sur le site Web.",
                "Publier une politique de confidentialité en termes simples et clairs.",
                "Recueillir seulement les renseignements nécessaires, pour des fins déterminées et annoncées.",
                "Obtenir un consentement manifeste, libre et éclairé, demandé à des fins précises et séparément de toute autre information quand il porte sur des renseignements sensibles ou sur des usages secondaires.",
                "Régler par défaut au niveau le plus élevé de confidentialité les paramètres des produits technologiques offerts au public.",
                "Évaluer les facteurs relatifs à la vie privée avant de communiquer des renseignements à l'extérieur du Québec, et encadrer la communication par une entente écrite.",
                "Détruire ou anonymiser les renseignements quand la fin pour laquelle ils ont été recueillis est accomplie, sous réserve des durées imposées par d'autres lois.",
                "Tenir un registre des incidents de confidentialité et aviser la CAI et les personnes concernées quand un incident présente un risque de préjudice sérieux.",
              ],
            },
            {
              h2: "Vos droits",
              p: [
                "L'entreprise doit répondre à une demande d'accès ou de rectification dans un délai de 30 jours. Faites votre demande par écrit à la personne responsable, en précisant ce que vous demandez.",
              ],
              ul: [
                "Savoir quels renseignements une entreprise détient sur vous et en obtenir une copie.",
                "Faire corriger un renseignement inexact, incomplet ou équivoque.",
                "Retirer votre consentement, par exemple aux courriels promotionnels ou au traitement par l'IA.",
                "Recevoir les renseignements que vous avez fournis dans un format technologique structuré et couramment utilisé (portabilité), depuis septembre 2024.",
                "Demander la désindexation d'un renseignement ou la cessation de sa diffusion lorsque la loi le permet.",
                "Être informé quand une décision est prise uniquement par un traitement automatisé, et présenter vos observations.",
              ],
            },
            {
              h2: "Le cas des appels enregistrés",
              p: [
                "« Cet appel peut être enregistré » : ce message n'est pas une simple formule. Il informe la personne avant que l'enregistrement commence. Une entreprise qui enregistre ses appels devrait dire pourquoi elle le fait, qui pourra écouter l'enregistrement et combien de temps elle le garde. Si vous ne voulez pas être enregistré, vous pouvez demander un autre moyen de communication, par exemple le courriel. Plus tard, vous pouvez demander l'accès à un enregistrement qui vous concerne : adressez-vous à l'entreprise que vous avez appelée, pas à son fournisseur de téléphonie.",
              ],
            },
            {
              h2: "L'intelligence artificielle au téléphone",
              p: [
                "Transcription de la messagerie vocale, résumés d'appels, réponses suggérées, réceptionniste virtuel : ces fonctions traitent des renseignements personnels, souvent chez un fournisseur situé à l'extérieur du Québec. Une approche respectueuse de la loi les rend facultatives, demande votre consentement distinct et clair, explique ce qui est envoyé au fournisseur d'IA, et vous permet de retirer ce consentement sans perdre le service de base. Un agent virtuel devrait aussi se présenter comme tel dès le début de l'appel.",
              ],
            },
            {
              h2: "Pour les petites entreprises",
              p: [
                "Votre téléphone d'entreprise contient les coordonnées de vos clients, l'historique de vos échanges et parfois des enregistrements. Quelques gestes simples aident à respecter la loi : choisir un fournisseur qui publie une politique de confidentialité claire et précise où sont stockées les données; limiter l'accès aux registres et aux enregistrements aux employés qui en ont besoin; retirer les accès d'un employé qui quitte l'entreprise; fixer une durée de conservation pour les enregistrements; et noter dans votre registre tout incident, comme un téléphone perdu sans verrouillage.",
                "Les sanctions prévues par la Loi 25 peuvent être importantes : des sanctions administratives pécuniaires jusqu'à 10 millions de dollars ou 2 % du chiffre d'affaires mondial, et des amendes pénales plus élevées encore. La CAI publie des guides pratiques pour les petites organisations.",
              ],
            },
            {
              h2: "Porter plainte",
              p: [
                "Commencez par écrire à la personne responsable de la protection des renseignements personnels de l'entreprise. Si la réponse ne vous satisfait pas, ou si vous n'en recevez pas dans le délai, vous pouvez vous adresser à la Commission d'accès à l'information du Québec. Pour une entreprise de télécommunication sous compétence fédérale, le Commissariat à la protection de la vie privée du Canada peut aussi recevoir votre plainte.",
              ],
            },
            {
              h2: "Avec MIMT",
              p: [
                `Chez MIMT, la personne responsable de la protection des renseignements personnels est le président de GROUPE TAKATAK. Notre [politique de confidentialité](${r("fr", "privacy")}) indique ce que nous recueillons, nos fournisseurs, et les durées de conservation réellement appliquées par nos systèmes. Les fonctions d'IA sont facultatives et désactivées par défaut; voyez [notre page IA](${r("fr", "ai")}).`,
              ],
            },
          ],
          sources: [
            { label: "Commission d'accès à l'information : principaux changements de la Loi 25", url: SRC.law25.fr },
            { label: "Loi sur la protection des renseignements personnels dans le secteur privé (LégisQuébec)", url: SRC.p391.fr },
            { label: "Commissariat à la protection de la vie privée du Canada", url: SRC.opc_priv.fr },
            { label: "CRTC", url: SRC.crtc.fr },
          ],
        }
      : {
          h1: "Law 25 and your phone data",
          title: "Law 25 and phone data: your rights",
          description: "Call logs, texts, voicemails, recordings: what Québec's Law 25 protects, your rights and the duties of businesses that use the phone.",
          summary: "What Law 25 changes for your call logs, texts, voicemails and recordings, your rights and the duties of businesses.",
          intro: "Your phone produces a lot of personal information: who you call, when, for how long, what you write, what you leave in a voicemail box. In Québec, Law 25 strengthened the protection of this information. This guide explains what it protects, the rights it gives you and what it requires of businesses, whether they are your phone provider or a shop that records its calls.",
          body: [
            {
              h2: "Law 25 in brief",
              p: [
                "\"Law 25\" is the common name of the Act to modernize legislative provisions as regards the protection of personal information, passed in 2021. It amended the Act respecting the protection of personal information in the private sector, which applies to businesses that collect information about people in Québec. Its obligations came into force in three steps, in September 2022, 2023 and 2024. Québec's Commission d'accès à l'information (CAI) oversees it.",
                "Telecommunications companies may also be subject to federal rules: the Personal Information Protection and Electronic Documents Act (PIPEDA), overseen by the Office of the Privacy Commissioner of Canada, and rules of the Canadian Radio-television and Telecommunications Commission (CRTC) on the confidentiality of customer information.",
              ],
            },
            {
              h2: "Which phone data is protected",
              p: [
                "Personal information is any information about a person that allows them to be identified, directly or indirectly. On the phone, this includes:",
              ],
              ul: [
                "your phone number, your name and your account address;",
                "call and text records: numbers, dates, times and durations, even without the content;",
                "the content of your texts, pictures and voicemails;",
                "call recordings and their transcripts, including summaries produced by artificial intelligence;",
                "the address you register for 9-1-1;",
                "technical information tied to your account, such as your IP address or device model.",
              ],
            },
            {
              h2: "What the law requires of businesses",
              ul: [
                "Name a person in charge of the protection of personal information. By default, it is the person with the highest authority in the business; their title and contact information must be published on the website.",
                "Publish a privacy policy in clear and simple terms.",
                "Collect only the information needed, for set and stated purposes.",
                "Get consent that is manifest, free and informed, requested for specific purposes and separately from any other information when it covers sensitive information or secondary uses.",
                "Set the privacy settings of technology products offered to the public at the highest level of confidentiality by default.",
                "Assess privacy factors before sending information outside Québec, and cover the transfer with a written agreement.",
                "Destroy or anonymize information once the purpose for which it was collected is achieved, subject to retention periods set by other laws.",
                "Keep a register of confidentiality incidents, and notify the CAI and the people affected when an incident presents a risk of serious injury.",
              ],
            },
            {
              h2: "Your rights",
              p: [
                "The business must answer an access or correction request within 30 days. Make your request in writing to the person in charge, saying what you are asking for.",
              ],
              ul: [
                "Know what information a business holds about you and get a copy.",
                "Have inaccurate, incomplete or ambiguous information corrected.",
                "Withdraw your consent, for example to promotional emails or to AI processing.",
                "Receive the information you provided in a structured, commonly used technological format (portability), since September 2024.",
                "Ask for de-indexing of information or for its distribution to stop where the law allows.",
                "Be told when a decision is made solely by automated processing, and submit your observations.",
              ],
            },
            {
              h2: "Recorded calls",
              p: [
                "\"This call may be recorded\": this message is not just a formula. It informs the person before recording starts. A business that records its calls should say why, who can listen to the recording and how long it keeps it. If you don't want to be recorded, you can ask for another way to communicate, such as email. Later, you can ask for access to a recording about you: contact the business you called, not its phone provider.",
              ],
            },
            {
              h2: "Artificial intelligence on the phone",
              p: [
                "Voicemail transcription, call summaries, suggested replies, virtual receptionist: these features process personal information, often at a provider outside Québec. An approach that respects the law makes them optional, asks for your separate and clear consent, explains what is sent to the AI provider, and lets you withdraw that consent without losing the basic service. A virtual agent should also say it is one at the start of the call.",
              ],
            },
            {
              h2: "For small businesses",
              p: [
                "Your business phone holds your customers' contact details, the history of your exchanges and sometimes recordings. A few simple steps help you follow the law: choose a provider that publishes a clear privacy policy and says where the data is stored; limit access to records and recordings to the staff who need it; remove the access of an employee who leaves; set a retention period for recordings; and log any incident in your register, such as a lost phone with no lock.",
                "Law 25 penalties can be significant: administrative monetary penalties of up to $10 million or 2% of worldwide turnover, and even higher penal fines. The CAI publishes practical guides for small organizations.",
              ],
            },
            {
              h2: "Filing a complaint",
              p: [
                "Start by writing to the business's person in charge of the protection of personal information. If the answer doesn't satisfy you, or you don't get one in time, you can go to Québec's Commission d'accès à l'information. For a federally regulated telecommunications company, the Office of the Privacy Commissioner of Canada can also take your complaint.",
              ],
            },
            {
              h2: "With MIMT",
              p: [
                `At MIMT, the person in charge of the protection of personal information is the president of GROUPE TAKATAK. Our [privacy policy](${r("en", "privacy")}) states what we collect, our providers, and the retention periods our systems actually apply. AI features are optional and off by default; see [our AI page](${r("en", "ai")}).`,
              ],
            },
          ],
          sources: [
            { label: "Commission d'accès à l'information: main changes under Law 25 (French)", url: SRC.law25.en },
            { label: "Act respecting the protection of personal information in the private sector (LégisQuébec)", url: SRC.p391.en },
            { label: "Office of the Privacy Commissioner of Canada", url: SRC.opc_priv.en },
            { label: "CRTC", url: SRC.crtc.en },
          ],
        },
};

// ---------------------------------------------------------------------------------------------------------------
// Choisir un indicatif régional local au Québec

const areaCode: Guide = {
  id: "indicatif-regional",
  slug: { fr: "choisir-indicatif-regional-quebec", en: "choose-area-code-quebec" },
  updated: "2026-10-30",
  related: ["cityMontreal", "cityQuebec", "useVirtual"],
  copy: (lang) =>
    lang === "fr"
      ? {
          h1: "Choisir un indicatif régional local au Québec",
          title: "Choisir un indicatif régional au Québec",
          description: "514, 438, 450, 418, 819 et les autres : quels indicatifs régionaux couvrent quelles régions du Québec, et comment choisir celui de votre numéro.",
          summary: "Les indicatifs régionaux du Québec, région par région, et les critères pour choisir celui de votre nouveau numéro.",
          intro: "Quand on choisit un nouveau numéro, l'indicatif régional est la première chose que les gens voient. Il dit, à tort ou à raison, d'où vous êtes. Ce guide présente les indicatifs du Québec, explique pourquoi certaines régions en ont plusieurs et vous aide à choisir celui qui convient à votre usage.",
          body: [
            {
              h2: "À quoi sert l'indicatif régional",
              p: [
                "Au Canada, un numéro de téléphone compte dix chiffres : un indicatif régional de trois chiffres, puis un numéro de sept chiffres. L'indicatif désigne une zone géographique. Les numéros canadiens font partie du plan de numérotation nord-américain, partagé avec les États-Unis et plusieurs pays des Caraïbes. Au Canada, les indicatifs sont gérés par l'Administrateur canadien de la numérotation, sous l'autorité du Conseil de la radiodiffusion et des télécommunications canadiennes (CRTC), qui approuve l'ajout de nouveaux indicatifs quand une région manque de numéros.",
              ],
            },
            {
              h2: "Les indicatifs du Québec, région par région",
              p: [
                "Les limites exactes des zones suivent des frontières de circonscriptions téléphoniques qui ne correspondent pas toujours aux limites des villes. En cas de doute, l'Administrateur canadien de la numérotation publie les cartes officielles des indicatifs.",
              ],
              ul: [
                "Île de Montréal : 514, 438 et 263.",
                "Couronnes nord et sud de Montréal, dont Laval, Longueuil, la Rive-Sud, la Rive-Nord et une partie des Laurentides : 450, 579 et 354.",
                "Est du Québec, dont la ville de Québec, Lévis, le Saguenay–Lac-Saint-Jean, le Bas-Saint-Laurent et la Gaspésie : 418, 581 et 367.",
                "Ouest, centre et nord du Québec, dont Gatineau et l'Outaouais, l'Estrie, la Mauricie, le Centre-du-Québec et l'Abitibi-Témiscamingue : 819, 873 et 468.",
              ],
            },
            {
              h2: "Pourquoi plusieurs indicatifs pour une même région",
              p: [
                "Quand une région manque de numéros, on ajoute un nouvel indicatif « superposé » sur la même zone : les anciens numéros ne changent pas, et les nouveaux numéros peuvent recevoir le nouvel indicatif. C'est pour cela qu'à Montréal, un numéro en 263 est tout aussi local qu'un numéro en 514. Depuis ces superpositions, on compose les dix chiffres pour tous les appels locaux au Québec. Un indicatif plus récent n'est donc ni moins local ni moins fiable; il est simplement plus récent.",
              ],
            },
            {
              h2: "Choisir selon votre usage",
              ul: [
                "Pour un usage personnel, choisissez l'indicatif de l'endroit où vivent la plupart de vos proches : c'est lui qu'ils reconnaîtront.",
                "Pour une entreprise locale, choisissez l'indicatif de votre clientèle. Un commerce de Sherbrooke inspire confiance avec un 819; une entreprise de la Rive-Sud, avec un 450.",
                "Pour une entreprise qui sert plusieurs régions, un numéro par région, renvoyé vers le même système, permet aux clients d'appeler un numéro local.",
                "Pour une petite annonce ou un projet ponctuel, l'indicatif importe moins : prenez celui de la région où se trouve l'objet ou le service.",
                "Si vous déménagez, vous pouvez généralement garder votre numéro, même si son indicatif ne correspond plus à votre nouvelle région.",
              ],
            },
            {
              h2: "Ce que l'indicatif change pour vos contacts",
              p: [
                "Avec un forfait de cellulaire canadien typique, appeler un numéro d'une autre région du Canada n'entraîne souvent aucuns frais supplémentaires. Mais certains clients, notamment ceux qui appellent d'une ligne fixe d'entreprise ou d'un forfait de base, peuvent encore payer des frais d'interurbain pour appeler un indicatif éloigné. Un numéro local évite cette question, et il est plus susceptible d'être pris au sérieux par quelqu'un qui hésite à répondre à un numéro inconnu.",
              ],
            },
            {
              h2: "Un numéro d'une autre province",
              p: [
                "Rien n'empêche une personne qui vit au Québec d'avoir un numéro d'une autre province, et l'inverse. C'est utile pour une entreprise qui veut une présence locale à Toronto ou à Ottawa, ou pour quelqu'un qui garde des liens avec une autre région. Ottawa et Gatineau sont un bon exemple : deux villes voisines, deux provinces, et des indicatifs différents (613 et 343 d'un côté, 819, 873 et 468 de l'autre). Si vos clients sont des deux côtés de la rivière, deux numéros locaux peuvent sonner au même endroit.",
              ],
            },
            {
              h2: "Changer d'indicatif plus tard",
              p: [
                "On ne peut pas changer l'indicatif d'un numéro existant : changer d'indicatif veut dire changer de numéro. Avant de choisir, pensez donc à l'avenir. Si vous prévoyez déménager ou étendre votre entreprise à une autre région, un deuxième numéro local, ajouté plus tard, est souvent plus simple que de changer le numéro que vos clients connaissent déjà. Et si vous devez vraiment changer de numéro, gardez l'ancien actif quelques mois, avec un message qui annonce le nouveau.",
              ],
            },
            {
              h2: "Les numéros sans frais",
              p: [
                "Les numéros sans frais (800, 833, 844, 855, 866, 877 et 888) ne sont liés à aucune région : l'appel est gratuit pour la personne qui appelle, et c'est l'entreprise qui le paie. Ils conviennent à une entreprise qui sert tout le Canada. Pour une entreprise locale, un numéro avec l'indicatif de la région donne souvent une image plus proche, et coûte généralement moins cher.",
              ],
            },
            {
              h2: "Un numéro facile à retenir",
              p: [
                "Au-delà de l'indicatif, certains numéros sont plus faciles à retenir : chiffres répétés, suites, fin en 00. Ils sont utiles sur une enseigne ou dans une publicité à la radio. Vérifiez seulement que le numéro n'a pas une histoire encombrante : un numéro récemment remis en service peut encore recevoir des appels destinés à l'ancien abonné pendant quelque temps. Les fournisseurs sérieux gardent les numéros libérés en quarantaine avant de les réattribuer, pour limiter ce problème.",
              ],
            },
            {
              h2: "Avec MIMT",
              p: [
                `Le sélecteur de numéros de MIMT cherche en direct les numéros libres pour toutes les régions du Québec et du Canada, et vous dit clairement si un indicatif est épuisé. Le numéro choisi est réservé 10 minutes pendant que vous créez votre compte. Voir nos pages [Montréal](${r("fr", "cityMontreal")}), [Québec](${r("fr", "cityQuebec")}), [Laval](${r("fr", "cityLaval")}) et [Gatineau](${r("fr", "cityGatineau")}). Les numéros libérés chez MIMT passent 90 jours en quarantaine avant d'être réattribués.`,
              ],
            },
          ],
          sources: [
            { label: "Administrateur canadien de la numérotation", url: SRC.cna.fr },
            { label: "CRTC", url: SRC.crtc.fr },
            { label: "CRTC : Changez de fournisseur et conservez votre numéro", url: SRC.crtcPort.fr },
          ],
        }
      : {
          h1: "Choosing a local area code in Québec",
          title: "Choosing an area code in Québec",
          description: "514, 438, 450, 418, 819 and the others: which area codes cover which regions of Québec, and how to choose the one for your number.",
          summary: "Québec's area codes, region by region, and the criteria for choosing the one for your new number.",
          intro: "When you choose a new number, the area code is the first thing people see. Rightly or wrongly, it tells them where you are from. This guide lists Québec's area codes, explains why some regions have several and helps you choose the right one for your use.",
          body: [
            {
              h2: "What the area code does",
              p: [
                "In Canada, a phone number has ten digits: a three-digit area code, then a seven-digit number. The area code stands for a geographic zone. Canadian numbers are part of the North American Numbering Plan, shared with the United States and several Caribbean countries. In Canada, area codes are managed by the Canadian Numbering Administrator under the authority of the Canadian Radio-television and Telecommunications Commission (CRTC), which approves new area codes when a region runs short of numbers.",
              ],
            },
            {
              h2: "Québec area codes, region by region",
              p: [
                "The exact boundaries follow telephone exchange borders that don't always match city limits. When in doubt, the Canadian Numbering Administrator publishes the official area code maps.",
              ],
              ul: [
                "Island of Montréal: 514, 438 and 263.",
                "The North and South Shores around Montréal, including Laval, Longueuil and part of the Laurentides: 450, 579 and 354.",
                "Eastern Québec, including Québec City, Lévis, Saguenay–Lac-Saint-Jean, Bas-Saint-Laurent and Gaspésie: 418, 581 and 367.",
                "Western, central and northern Québec, including Gatineau and the Outaouais, the Eastern Townships, Mauricie, Centre-du-Québec and Abitibi-Témiscamingue: 819, 873 and 468.",
              ],
            },
            {
              h2: "Why one region has several area codes",
              p: [
                "When a region runs short of numbers, a new \"overlay\" area code is added over the same zone: existing numbers don't change, and new numbers may get the new code. That is why, in Montréal, a 263 number is just as local as a 514 number. Since these overlays, all local calls in Québec are dialled with ten digits. A newer area code is therefore neither less local nor less reliable; it is simply newer.",
              ],
            },
            {
              h2: "Choosing for your use",
              ul: [
                "For personal use, choose the area code where most of your family and friends live: it is the one they will recognize.",
                "For a local business, choose your customers' area code. A Sherbrooke shop inspires trust with an 819; a South Shore business, with a 450.",
                "For a business serving several regions, one number per region, all forwarded to the same system, lets customers call a local number.",
                "For a listing or a one-off project, the area code matters less: take the one where the item or service is.",
                "If you move, you can usually keep your number, even if its area code no longer matches your new region.",
              ],
            },
            {
              h2: "What the area code changes for your contacts",
              p: [
                "With a typical Canadian mobile plan, calling a number in another region of Canada often costs nothing extra. But some customers, especially those calling from a business landline or a basic plan, may still pay long-distance charges to call a distant area code. A local number avoids the question, and it is more likely to be taken seriously by someone who hesitates to answer an unknown number.",
              ],
            },
            {
              h2: "A number from another province",
              p: [
                "Nothing stops someone living in Québec from having a number from another province, and vice versa. It helps a business that wants a local presence in Toronto or Ottawa, or someone who keeps ties with another region. Ottawa and Gatineau are a good example: two neighbouring cities, two provinces, and different area codes (613 and 343 on one side, 819, 873 and 468 on the other). If your customers are on both sides of the river, two local numbers can ring in the same place.",
              ],
            },
            {
              h2: "Changing area code later",
              p: [
                "You can't change the area code of an existing number: changing the area code means changing the number. So think ahead before choosing. If you plan to move or to expand your business to another region, a second local number, added later, is often simpler than changing the number your customers already know. And if you really must change numbers, keep the old one active for a few months, with a message announcing the new one.",
              ],
            },
            {
              h2: "Toll-free numbers",
              p: [
                "Toll-free numbers (800, 833, 844, 855, 866, 877 and 888) are not tied to any region: the call is free for the caller, and the business pays for it. They suit a business that serves all of Canada. For a local business, a number with the region's area code often gives a closer image, and usually costs less.",
              ],
            },
            {
              h2: "A number that is easy to remember",
              p: [
                "Beyond the area code, some numbers are easier to remember: repeated digits, sequences, ending in 00. They help on a sign or in a radio ad. Just check that the number doesn't carry an awkward history: a recently reassigned number may still get calls meant for the previous subscriber for a while. Serious providers keep released numbers in quarantine before reassigning them, to limit this problem.",
              ],
            },
            {
              h2: "With MIMT",
              p: [
                `MIMT's number picker searches live for free numbers in every region of Québec and Canada, and tells you clearly when an area code is sold out. The number you pick is held for 10 minutes while you create your account. See our [Montréal](${r("en", "cityMontreal")}), [Québec City](${r("en", "cityQuebec")}), [Laval](${r("en", "cityLaval")}) and [Gatineau](${r("en", "cityGatineau")}) pages. Numbers released at MIMT spend 90 days in quarantine before they are reassigned.`,
              ],
            },
          ],
          sources: [
            { label: "Canadian Numbering Administrator", url: SRC.cna.en },
            { label: "CRTC", url: SRC.crtc.en },
            { label: "CRTC: Switch providers and keep your number", url: SRC.crtcPort.en },
          ],
        },
};

export const MORE_GUIDES: readonly Guide[] = [wifiCalling, compareApps, businessVoip, law25, areaCode];
