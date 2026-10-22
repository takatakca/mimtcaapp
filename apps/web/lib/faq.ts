// Questions and answers shown on the help page (and in part on the business and AI pages), French first.
// Answers are plain text so the same words feed the visible page, the FAQPage JSON-LD and llms.txt.
// Prices and limits come from @mimt/shared: never type a price here.

import { AI_MONTHLY_BUDGET_CAD_CENTS, DEFAULT_RECORDING_POLICY, PLANS, formatCad } from "@mimt/shared";
import type { Lang, RouteKey } from "./site.ts";

export type FaqTopic = "general" | "mobile" | "business" | "ai" | "legal";

export interface FaqItem {
  id: string;
  topic: FaqTopic;
  q: string;
  a: string;
  /** Optional "read more" link to another page of the site. */
  link?: { route: RouteKey; hash?: string; label: string };
}

export const FAQ_TOPICS: Record<FaqTopic, { fr: string; en: string }> = {
  general: { fr: "MIMT en général", en: "MIMT in general" },
  mobile: { fr: "MIMT Mobile", en: "MIMT Mobile" },
  business: { fr: "MIMT Affaires", en: "MIMT Business" },
  ai: { fr: "Intelligence artificielle", en: "Artificial intelligence" },
  legal: { fr: "9-1-1, vie privée et plaintes", en: "9-1-1, privacy and complaints" },
};

export function faqItems(lang: Lang): FaqItem[] {
  const fr = lang === "fr";
  const free = PLANS.free.caps;
  const lock = formatCad(PLANS.lock.monthlyPriceCents, lang);
  const premium = formatCad(PLANS.premium.monthlyPriceCents, lang);
  const biz = formatCad(PLANS.business.monthlyPriceCents, lang);
  const bizPro = formatCad(PLANS.business_pro.monthlyPriceCents, lang);
  const bizMin = PLANS.business.caps.outboundMinutes;
  const retention = DEFAULT_RECORDING_POLICY.retentionDays;
  const aiPremium = formatCad(AI_MONTHLY_BUDGET_CAD_CENTS.premium, lang);

  const items: FaqItem[] = fr
    ? [
        {
          id: "quoi",
          topic: "general",
          q: "Qu'est-ce que MIMT?",
          a: "MIMT (Mobile Innovation Modern Telecommunications) est un service de téléphonie par Internet conçu à Montréal, en français d'abord. MIMT Mobile donne un vrai numéro canadien dans une app pour appeler et texter par Wi‑Fi ou données. MIMT Affaires est un système téléphonique d'entreprise facturé par ligne. MIMT fait partie de l'écosystème GROUPE TAKATAK.",
        },
        {
          id: "quand",
          topic: "general",
          q: "MIMT est-il offert maintenant?",
          a: "Oui. Choisissez votre numéro sur mimt.ca, payez votre forfait et le numéro est activé dès le paiement.",
          link: { route: "home", hash: "numero", label: "Obtenir mon numéro" },
        },
        {
          id: "taxes",
          topic: "general",
          q: "Les prix incluent-ils les taxes?",
          a: "Non. Les prix sont en dollars canadiens, avant la TPS, la TVQ et la taxe municipale 9-1-1 du Québec. Ce sont des prix proposés pour le lancement : ils seront confirmés avant toute inscription payante.",
          link: { route: "plans", label: "Voir les forfaits" },
        },
        {
          id: "gratuit",
          topic: "mobile",
          q: "Le forfait Gratuit est-il vraiment gratuit?",
          a: `Oui, 0 $ par mois, avec des publicités dans l'app. Il fonctionne entre applications MIMT : textos illimités et ${free.onNetMinutes} minutes d'appels par mois. Il ne comprend pas de numéro de téléphone : pour appeler et texter n'importe quel numéro, choisissez Essentiel (${lock}/mois).`,
        },
        {
          id: "garder-numero",
          topic: "mobile",
          q: "Comment garder mon numéro si je l'utilise peu?",
          a: `Avec Essentiel (${lock}/mois) ou Premium (${premium}/mois), votre numéro reste à vous tant que le forfait est payé, même sans activité.`,
        },
        {
          id: "remplace-cellulaire",
          topic: "mobile",
          q: "MIMT remplace-t-il mon fournisseur cellulaire?",
          a: "Non. MIMT Mobile est une application qui utilise le Wi‑Fi ou vos données mobiles. Vous gardez votre forfait cellulaire actuel. Un service cellulaire MIMT est envisagé, mais il exige une entente avec un fournisseur de réseau : aucune date ni aucun prix ne sont annoncés.",
          link: { route: "soon", label: "Voir ce qui s'en vient" },
        },
        {
          id: "sans-wifi",
          topic: "mobile",
          q: "Est-ce que ça fonctionne sans Wi‑Fi?",
          a: "Oui, avec vos données mobiles. Sans connexion Internet, l'app ne peut ni appeler ni texter. Les appels utilisent des données : vérifiez votre forfait de données, surtout en itinérance.",
        },
        {
          id: "ordinateur",
          topic: "mobile",
          q: "Puis-je utiliser MIMT sur mon ordinateur?",
          a: "Oui, une app Web est en préparation à app.mimt.ca : appels, textos et messagerie vocale dans le navigateur, avec le même compte et le même numéro que sur le téléphone.",
          link: { route: "webapp", label: "En savoir plus sur l'app Web" },
        },
        {
          id: "transfert",
          topic: "mobile",
          q: "Puis-je transférer mon numéro actuel chez MIMT?",
          a: "Oui, et MIMT ne facture aucuns frais de transfert. Le transfert se fait en ligne avec une autorisation signée électroniquement; son ouverture sera annoncée au lancement. Les frais ou contrats de votre fournisseur actuel restent votre responsabilité. Si vous quittez MIMT, vous pourrez transférer votre numéro chez un autre fournisseur.",
        },
        {
          id: "international",
          topic: "mobile",
          q: "Et les appels internationaux?",
          a: "Ils ne sont pas inclus dans les forfaits. Ils se paient d'avance avec un crédit international, au tarif affiché dans l'app. Ils ne sont pas offerts avec le forfait Gratuit.",
        },
        {
          id: "affaires-prix",
          topic: "business",
          q: "Combien coûte MIMT Affaires?",
          a: `Affaires : ${biz} par ligne par mois, avec ${bizMin.toLocaleString("fr-CA")} minutes sortantes par ligne. Affaires Pro : ${bizPro} par ligne par mois, avec l'enregistrement des appels. Prix proposés pour le lancement, avant taxes. Aucun appareil à acheter.`,
          link: { route: "business", hash: "prix", label: "Voir les prix Affaires" },
        },
        {
          id: "affaires-accueil",
          topic: "business",
          q: "Le réceptionniste automatique parle-t-il français et anglais?",
          a: "Oui. Le menu d'accueil (« Pour les ventes, faites le 1 ») est en français d'abord, avec une version anglaise. Vous pouvez utiliser la synthèse vocale ou votre propre message enregistré.",
        },
        {
          id: "affaires-feries",
          topic: "business",
          q: "Les jours fériés du Québec sont-ils gérés?",
          a: "Oui. Vous définissez vos heures d'ouverture et le système peut fermer automatiquement les jours fériés du Québec (Jour de l'An, Vendredi saint, Journée nationale des patriotes, Fête nationale, Fête du Canada, Fête du Travail, Action de grâces, Noël), en plus de vos propres fermetures. Les appels hors des heures vont où vous voulez : messagerie vocale, cellulaire de garde ou réceptionniste IA.",
        },
        {
          id: "affaires-enregistrement",
          topic: "business",
          q: "Peut-on enregistrer les appels?",
          a: `Oui, avec Affaires Pro. Un message avise toujours l'autre personne avant tout enregistrement (« Cet appel peut être enregistré… »). Les enregistrements sont supprimés après ${retention} jours par défaut; vous pouvez changer ce délai.`,
        },
        {
          id: "ia-quoi",
          topic: "ai",
          q: "Que fait l'IA de MIMT?",
          a: "Elle résume vos messages vocaux, suggère des réponses courtes à vos textos (jamais envoyées sans vous), étiquette « Spam probable » les appels et textos douteux et, pour les entreprises, peut répondre au téléphone comme réceptionniste virtuel. L'IA est fournie par Claude, d'Anthropic.",
          link: { route: "ai", label: "Découvrir l'IA de MIMT" },
        },
        {
          id: "ia-consentement",
          topic: "ai",
          q: "Mes messages sont-ils envoyés à l'IA sans mon accord?",
          a: "Non. Les résumés de messages vocaux, les réponses suggérées et l'analyse de textos par l'IA demandent votre consentement distinct, que vous pouvez retirer en tout temps. Sans ce consentement, rien n'est envoyé au fournisseur d'IA et le reste du service fonctionne normalement.",
          link: { route: "privacy", hash: "ia", label: "Lire la section IA de la politique" },
        },
        {
          id: "ia-forfaits",
          topic: "ai",
          q: "Quels forfaits incluent l'IA?",
          a: `Premium, Affaires et Affaires Pro. Chaque compte a un plafond mensuel de coût d'IA (par exemple ${aiPremium} par mois pour Premium); une fois atteint, l'IA s'arrête jusqu'au mois suivant, mais les appels, les textos et la messagerie vocale continuent.`,
        },
        {
          id: "ia-receptionniste",
          topic: "ai",
          q: "Les appelants savent-ils qu'ils parlent à une IA?",
          a: "Oui. Le réceptionniste virtuel se présente toujours comme un agent d'intelligence artificielle dès le début de l'appel et précise que la conversation est transcrite. Il peut transférer l'appel à une personne ou prendre un message.",
        },
        {
          id: "911",
          topic: "legal",
          q: "Puis-je appeler le 9-1-1?",
          a: "Oui, mais avec des limites propres aux services par Internet. Vous devez enregistrer votre adresse avant votre premier appel et la garder à jour. Le 9-1-1 n'est jamais bloqué par votre forfait, vos limites ou votre solde.",
          link: { route: "e911", label: "Lire la page 9-1-1" },
        },
        {
          id: "donnees",
          topic: "legal",
          q: "Que faites-vous de mes données?",
          a: "Nous recueillons le minimum pour fournir le service et ne vendons pas vos renseignements. La base de données du service est prévue au Canada. Certains fournisseurs peuvent traiter des renseignements à l'extérieur du Québec; nous évaluons chaque transfert avant de le faire.",
          link: { route: "privacy", label: "Politique de confidentialité" },
        },
        {
          id: "annuler",
          topic: "legal",
          q: "Comment annuler?",
          a: "Vous pourrez annuler dans l'app ou en nous écrivant. Les détails seront dans nos conditions, que vous verrez avant tout paiement.",
          link: { route: "terms", label: "Conditions d'utilisation" },
        },
        {
          id: "plainte",
          topic: "legal",
          q: "J'ai un problème qui n'est pas réglé.",
          a: "Voyez notre processus de plaintes. Si nous ne réglons pas votre plainte, vous pouvez vous adresser gratuitement à la Commission des plaintes relatives aux services de télécom-télévision (CPRST).",
          link: { route: "complaints", label: "Processus de plaintes" },
        },
      ]
    : [
        {
          id: "quoi",
          topic: "general",
          q: "What is MIMT?",
          a: "MIMT (Mobile Innovation Modern Telecommunications) is an internet phone service built in Montréal, French first. MIMT Mobile gives you a real Canadian number in an app to call and text over Wi‑Fi or data. MIMT Business is a business phone system billed per line. MIMT is part of the GROUPE TAKATAK ecosystem.",
        },
        {
          id: "quand",
          topic: "general",
          q: "Is MIMT available now?",
          a: "Yes. Pick your number on mimt.ca, pay for your plan and the number is activated as soon as payment goes through.",
          link: { route: "home", hash: "numero", label: "Get my number" },
        },
        {
          id: "taxes",
          topic: "general",
          q: "Do prices include taxes?",
          a: "No. Prices are in Canadian dollars, before GST, QST and the Québec 9-1-1 municipal tax. They are proposed launch prices and will be confirmed before any paid sign-up.",
          link: { route: "plans", label: "See plans" },
        },
        {
          id: "gratuit",
          topic: "mobile",
          q: "Is the Free plan really free?",
          a: `Yes, $0 per month, with in-app ads. It works between MIMT apps: unlimited texts and ${free.onNetMinutes} minutes of calls per month. It does not include a phone number: to call and text any number, choose Essential (${lock}/month).`,
        },
        {
          id: "garder-numero",
          topic: "mobile",
          q: "How do I keep my number if I rarely use it?",
          a: `With Essential (${lock}/month) or Premium (${premium}/month), your number stays yours as long as the plan is paid, even when inactive.`,
        },
        {
          id: "remplace-cellulaire",
          topic: "mobile",
          q: "Does MIMT replace my cell carrier?",
          a: "No. MIMT Mobile is an app that uses Wi‑Fi or your mobile data. You keep your current cell plan. A MIMT cellular service is being considered, but it needs an agreement with a network provider: no date or price is announced.",
          link: { route: "soon", label: "See what's coming" },
        },
        {
          id: "sans-wifi",
          topic: "mobile",
          q: "Does it work without Wi‑Fi?",
          a: "Yes, over mobile data. Without an internet connection, the app can't call or text. Calls use data: check your data plan, especially when roaming.",
        },
        {
          id: "ordinateur",
          topic: "mobile",
          q: "Can I use MIMT on my computer?",
          a: "Yes, a web app is in preparation at app.mimt.ca: calls, texts and voicemail in your browser, with the same account and number as on your phone.",
          link: { route: "webapp", label: "About the web app" },
        },
        {
          id: "transfert",
          topic: "mobile",
          q: "Can I bring my current number to MIMT?",
          a: "Yes, and MIMT charges no transfer fee. The transfer is done online with an electronically signed authorization; it opens at launch. Your current provider's fees or contracts remain your responsibility. If you leave MIMT, you can port your number to another provider.",
        },
        {
          id: "international",
          topic: "mobile",
          q: "What about international calls?",
          a: "They aren't included in plans. They're prepaid with international credit, at the rate shown in the app. They aren't available on the Free plan.",
        },
        {
          id: "affaires-prix",
          topic: "business",
          q: "How much does MIMT Business cost?",
          a: `Business: ${biz} per line per month, with ${bizMin.toLocaleString("en-CA")} outbound minutes per line. Business Pro: ${bizPro} per line per month, with call recording. Proposed launch prices, before taxes. No hardware to buy.`,
          link: { route: "business", hash: "prix", label: "See Business pricing" },
        },
        {
          id: "affaires-accueil",
          topic: "business",
          q: "Does the auto-attendant speak French and English?",
          a: "Yes. The greeting menu (“For sales, press 1”) is French first, with an English version. Use text-to-speech or your own recorded greeting.",
        },
        {
          id: "affaires-feries",
          topic: "business",
          q: "Are Québec holidays handled?",
          a: "Yes. You set your business hours and the system can close automatically on Québec statutory holidays (New Year's Day, Good Friday, National Patriots' Day, Fête nationale, Canada Day, Labour Day, Thanksgiving, Christmas), plus your own closures. After-hours calls go where you choose: voicemail, an on-call mobile or the AI receptionist.",
        },
        {
          id: "affaires-enregistrement",
          topic: "business",
          q: "Can calls be recorded?",
          a: `Yes, with Business Pro. A message always tells the other person before any recording (“This call may be recorded…”). Recordings are deleted after ${retention} days by default; you can change this period.`,
        },
        {
          id: "ia-quoi",
          topic: "ai",
          q: "What does MIMT's AI do?",
          a: "It summarizes your voicemails, suggests short replies to your texts (never sent without you), labels doubtful calls and texts “Likely spam” and, for businesses, can answer the phone as a virtual receptionist. The AI is provided by Claude, from Anthropic.",
          link: { route: "ai", label: "Discover MIMT AI" },
        },
        {
          id: "ia-consentement",
          topic: "ai",
          q: "Are my messages sent to the AI without my consent?",
          a: "No. Voicemail summaries, suggested replies and AI text analysis need your separate consent, which you can withdraw at any time. Without it, nothing is sent to the AI provider and the rest of the service works normally.",
          link: { route: "privacy", hash: "ia", label: "Read the AI section of the policy" },
        },
        {
          id: "ia-forfaits",
          topic: "ai",
          q: "Which plans include AI?",
          a: `Premium, Business and Business Pro. Each account has a monthly AI cost cap (for example ${aiPremium} per month on Premium); once reached, AI pauses until next month, while calls, texts and voicemail keep working.`,
        },
        {
          id: "ia-receptionniste",
          topic: "ai",
          q: "Do callers know they're talking to an AI?",
          a: "Yes. The virtual receptionist always introduces itself as an artificial intelligence agent at the start of the call and says the conversation is transcribed. It can transfer the call to a person or take a message.",
        },
        {
          id: "911",
          topic: "legal",
          q: "Can I call 9-1-1?",
          a: "Yes, with limits that apply to internet services. You must register your address before your first call and keep it current. 9-1-1 is never blocked by your plan, limits or balance.",
          link: { route: "e911", label: "Read the 9-1-1 page" },
        },
        {
          id: "donnees",
          topic: "legal",
          q: "What do you do with my data?",
          a: "We collect the minimum needed to provide the service and don't sell your information. The service database is planned in Canada. Some providers may process information outside Québec; we assess every transfer before making it.",
          link: { route: "privacy", label: "Privacy policy" },
        },
        {
          id: "annuler",
          topic: "legal",
          q: "How do I cancel?",
          a: "You'll be able to cancel in the app or by writing to us. Details will be in our terms, shown before any payment.",
          link: { route: "terms", label: "Terms of service" },
        },
        {
          id: "plainte",
          topic: "legal",
          q: "My problem isn't solved.",
          a: "See our complaints process. If we don't resolve your complaint, you can go to the Commission for Complaints for Telecom-television Services (CCTS), free of charge.",
          link: { route: "complaints", label: "Complaints process" },
        },
      ];
  return items;
}

export function faqByTopic(lang: Lang, topic: FaqTopic): FaqItem[] {
  return faqItems(lang).filter((i) => i.topic === topic);
}
