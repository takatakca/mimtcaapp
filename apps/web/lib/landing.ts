// Local and use-case landing pages (SEO). French first, English pair on every page. Prices come from PLANS,
// area codes from packages/shared/src/numberSearch.ts; nothing here invents availability, ratings or an address.

import { NUMBER_PLACES, PLANS, formatCad } from "@mimt/shared";
import type { FaqItem } from "./faq.ts";
import type { Lang, RouteKey } from "./site.ts";

export type CityKey = "cityMontreal" | "cityQuebec" | "cityLaval" | "cityGatineau" | "cityToronto";
export type UseKey = "useVirtual" | "useSecond" | "useVoip";
export type LandingKey = CityKey | UseKey;

export const CITY_PAGES: readonly CityKey[] = ["cityMontreal", "cityQuebec", "cityLaval", "cityGatineau", "cityToronto"];
export const USE_PAGES: readonly UseKey[] = ["useVirtual", "useSecond", "useVoip"];
export const LANDING_PAGES: readonly LandingKey[] = [...CITY_PAGES, ...USE_PAGES];

/** City page → NUMBER_PLACES key (area codes, display name). */
const CITY_PLACE: Record<CityKey, keyof typeof NUMBER_PLACES> = {
  cityMontreal: "montreal",
  cityQuebec: "quebec",
  cityLaval: "laval",
  cityGatineau: "gatineau",
  cityToronto: "toronto",
};

export function cityAreaCodes(key: CityKey): readonly string[] {
  return NUMBER_PLACES[CITY_PLACE[key]]!.areaCodes;
}

export function cityName(key: CityKey, lang: Lang): string {
  return NUMBER_PLACES[CITY_PLACE[key]]!.label[lang];
}

export interface LandingSection {
  h2: string;
  p: string;
}

export interface LandingCopy {
  eyebrow: string;
  h1: string;
  lead: string;
  sections: LandingSection[];
  faq: FaqItem[];
  /** Where the page's "next step" link goes besides the number picker. */
  related: RouteKey[];
}

const codesText = (codes: readonly string[], lang: Lang) => {
  const list = [...codes];
  const last = list.pop();
  return list.length ? `${list.join(", ")} ${lang === "fr" ? "et" : "and"} ${last}` : (last ?? "");
};

function cityCopy(key: CityKey, lang: Lang): LandingCopy {
  const fr = lang === "fr";
  const city = cityName(key, lang);
  const codes = cityAreaCodes(key);
  const lock = formatCad(PLANS.lock.monthlyPriceCents, lang);
  const premium = formatCad(PLANS.premium.monthlyPriceCents, lang);
  const quebec = key !== "cityToronto";
  const id = (s: string) => `${key}-${s}`;
  if (fr) {
    return {
      eyebrow: `Numéro local · ${city}`,
      h1: `Numéro de téléphone virtuel à ${city} (${codes.slice(0, 2).join(", ")})`,
      lead: `Un vrai numéro de ${city} dans une app : appels et textos par Wi‑Fi ou données, sur votre cellulaire et votre ordinateur. Dès ${lock} par mois.`,
      sections: [
        {
          h2: `Les indicatifs de ${city}`,
          p: `À ${city}, les numéros locaux commencent par ${codesText(codes, "fr")}. Le sélecteur de numéros montre en direct ceux qui sont libres chez notre fournisseur; si un indicatif est épuisé, il vous propose le plus proche et vous le dit clairement.`,
        },
        {
          h2: "Comment ça fonctionne",
          p: `Choisissez votre numéro, il est réservé 10 minutes pour vous. Créez votre compte, inscrivez votre adresse pour le 9-1-1, payez le forfait Essentiel (${lock}/mois) ou Premium (${premium}/mois), et le numéro s'active tout de suite dans l'app.`,
        },
        {
          h2: quebec ? "Fait au Québec, en français d'abord" : "Un service canadien, en français et en anglais",
          p: quebec
            ? "MIMT est conçu à Montréal par GROUPE TAKATAK. Service et factures en français, protection des renseignements personnels selon la Loi 25."
            : "MIMT est conçu à Montréal par GROUPE TAKATAK. L'app et le soutien sont offerts en français et en anglais.",
        },
        {
          h2: `Vous avez déjà un numéro à ${city}?`,
          p: "Vous pouvez le transférer chez MIMT, sans frais de transfert MIMT. Ne résiliez pas votre service actuel avant la fin du transfert : c'est le nouveau fournisseur qui fait la demande, et l'ancien service se termine de lui-même une fois le numéro transféré.",
        },
        {
          h2: "Sur le cellulaire et l'ordinateur",
          p: "Le même numéro sonne dans l'app sur votre cellulaire et dans votre navigateur à app.mimt.ca. Vous répondez où vous êtes, au bureau, à la maison ou en déplacement, et vos textos et messages vocaux suivent d'un appareil à l'autre.",
        },
      ],
      faq: [
        {
          id: id("local"),
          topic: "mobile",
          q: `Est-ce un vrai numéro de ${city}?`,
          a: `Oui. C'est un numéro canadien local (${codesText(codes, "fr")}) : vos contacts vous appellent et vous textent comme un numéro ordinaire, sans frais interurbains pour eux à ${city}.`,
        },
        {
          id: id("keep"),
          topic: "mobile",
          q: "Puis-je garder mon cellulaire actuel?",
          a: "Oui. MIMT s'ajoute à votre téléphone : vous gardez votre forfait cellulaire et votre numéro, et vous ajoutez un deuxième numéro dans l'app.",
        },
        {
          id: id("911"),
          topic: "legal",
          q: "Et le 9-1-1?",
          a: "Le 9-1-1 n'est jamais bloqué. L'adresse que vous inscrivez est transmise au centre d'urgence; gardez-la à jour si vous changez d'endroit.",
          link: { route: "e911", label: "Limites du 9-1-1 par Internet" },
        },
      ],
      related: ["plans", "e911"],
    };
  }
  return {
    eyebrow: `Local number · ${city}`,
    h1: `Virtual phone number in ${city} (${codes.slice(0, 2).join(", ")})`,
    lead: `A real ${city} number in an app: calls and texts over Wi‑Fi or data, on your phone and your computer. From ${lock} a month.`,
    sections: [
      {
        h2: `${city} area codes`,
        p: `Local ${city} numbers start with ${codesText(codes, "en")}. The number picker shows live which ones our carrier has free; if an area code is sold out, it offers the closest one and tells you so.`,
      },
      {
        h2: "How it works",
        p: `Pick your number and it is held for you for 10 minutes. Create your account, enter your 9-1-1 address, pay for Essential (${lock}/month) or Premium (${premium}/month), and the number turns on right away in the app.`,
      },
      {
        h2: quebec ? "Made in Québec, French first" : "A Canadian service, in English and French",
        p: quebec
          ? "MIMT is built in Montréal by GROUPE TAKATAK. Service and invoices in French and English, privacy under Québec's Law 25."
          : "MIMT is built in Montréal by GROUPE TAKATAK. The app and support are in English and French.",
      },
      {
        h2: `Already have a ${city} number?`,
        p: "You can port it to MIMT, with no MIMT transfer fee. Don't cancel your current service before the port is complete: the new provider makes the request, and the old service ends by itself once the number has moved.",
      },
      {
        h2: "On your mobile and your computer",
        p: "The same number rings in the app on your mobile and in your browser at app.mimt.ca. You answer wherever you are, at the office, at home or on the go, and your texts and voicemails follow you from one device to the other.",
      },
    ],
    faq: [
      {
        id: id("local"),
        topic: "mobile",
        q: `Is it a real ${city} number?`,
        a: `Yes. It is a local Canadian number (${codesText(codes, "en")}): people call and text you like any number, with no long-distance charge for them in ${city}.`,
      },
      {
        id: id("keep"),
        topic: "mobile",
        q: "Can I keep my current mobile?",
        a: "Yes. MIMT adds to your phone: you keep your mobile plan and number, and add a second number in the app.",
      },
      {
        id: id("911"),
        topic: "legal",
        q: "What about 9-1-1?",
        a: "9-1-1 is never blocked. The address you register is sent to the emergency centre; keep it up to date when you move.",
        link: { route: "e911", label: "9-1-1 over the internet: limits" },
      },
    ],
    related: ["plans", "e911"],
  };
}

function useCopy(key: UseKey, lang: Lang): LandingCopy {
  const fr = lang === "fr";
  const lock = formatCad(PLANS.lock.monthlyPriceCents, lang);
  const premium = formatCad(PLANS.premium.monthlyPriceCents, lang);
  const biz = formatCad(PLANS.business.monthlyPriceCents, lang);
  const id = (s: string) => `${key}-${s}`;
  if (key === "useVirtual") {
    return fr
      ? {
          eyebrow: "Numéro virtuel",
          h1: "Numéro de téléphone virtuel canadien",
          lead: `Un numéro canadien qui vit dans une app plutôt que dans une carte SIM. Appels et textos par Wi‑Fi ou données, dès ${lock} par mois.`,
          sections: [
            { h2: "Qu'est-ce qu'un numéro virtuel?", p: "Un vrai numéro de téléphone canadien, relié à votre compte MIMT au lieu d'une puce. Il sonne dans l'app sur votre cellulaire et dans votre navigateur à app.mimt.ca." },
            { h2: "À quoi ça sert", p: "Séparer travail et vie perso, garder un numéro local en voyage, avoir un numéro pour une petite annonce ou un projet, sans changer de cellulaire." },
            { h2: "Sans numéro aussi", p: "Avec votre identifiant MIMT (@nom), vous textez gratuitement les autres utilisateurs MIMT, même sans numéro de téléphone." },
            { h2: "Comment ça fonctionne", p: "Quand quelqu'un compose votre numéro, l'appel arrive chez notre fournisseur de télécommunications, qui le fait sonner dans l'app par Internet. Vos contacts composent un numéro ordinaire; quand vous les appelez, c'est votre numéro MIMT qui s'affiche. Il faut une connexion Wi‑Fi ou des données mobiles, et l'app doit pouvoir recevoir ses notifications." },
            { h2: "Ce qu'il faut savoir avant de choisir", p: "Un numéro par Internet ne remplace pas un cellulaire pour le 9-1-1 : sans Internet ou sans courant, l'appel ne passe pas, et vous devez inscrire l'adresse où vous utilisez le service. Certaines banques et plateformes refusent aussi d'envoyer leurs codes de vérification aux numéros par Internet; gardez votre numéro principal pour ces comptes." },
          ],
          faq: [
            { id: id("sim"), topic: "mobile", q: "Faut-il une nouvelle carte SIM?", a: "Non. Le numéro fonctionne dans l'app, par Wi‑Fi ou par vos données mobiles." },
            { id: id("abroad"), topic: "mobile", q: "Fonctionne-t-il à l'étranger?", a: "Oui, partout où vous avez Internet : vos appels et textos au Canada et aux États-Unis comptent dans votre forfait." },
            { id: id("transfer"), topic: "mobile", q: "Puis-je transférer mon numéro actuel?", a: "Oui, MIMT ne facture aucuns frais de transfert de numéro." },
          ],
          related: ["plans", "webapp"],
        }
      : {
          eyebrow: "Virtual number",
          h1: "Canadian virtual phone number",
          lead: `A Canadian number that lives in an app instead of a SIM card. Calls and texts over Wi‑Fi or data, from ${lock} a month.`,
          sections: [
            { h2: "What is a virtual number?", p: "A real Canadian phone number tied to your MIMT account instead of a chip. It rings in the app on your phone and in your browser at app.mimt.ca." },
            { h2: "What it is for", p: "Keep work and personal life apart, keep a local number while travelling, have a number for a listing or a project, without changing phones." },
            { h2: "Even without a number", p: "With your MIMT handle (@name), you text other MIMT users for free, even without a phone number." },
            { h2: "How it works", p: "When someone dials your number, the call reaches our telecom provider, which rings it in the app over the internet. Your contacts dial an ordinary number; when you call them, your MIMT number shows. You need Wi‑Fi or mobile data, and the app must be able to receive its notifications." },
            { h2: "What to know before choosing", p: "An internet number does not replace a mobile for 9-1-1: with no internet or no power, the call won't go through, and you must register the address where you use the service. Some banks and platforms also refuse to send verification codes to internet numbers; keep your main number for those accounts." },
          ],
          faq: [
            { id: id("sim"), topic: "mobile", q: "Do I need a new SIM card?", a: "No. The number works in the app, over Wi‑Fi or your mobile data." },
            { id: id("abroad"), topic: "mobile", q: "Does it work abroad?", a: "Yes, anywhere you have internet: your calls and texts to Canada and the US count in your plan." },
            { id: id("transfer"), topic: "mobile", q: "Can I transfer my current number?", a: "Yes, MIMT charges no number transfer fee." },
          ],
          related: ["plans", "webapp"],
        };
  }
  if (key === "useSecond") {
    return fr
      ? {
          eyebrow: "Deuxième numéro",
          h1: "Un deuxième numéro sur le même cellulaire",
          lead: `Gardez votre numéro perso pour vous et donnez un deuxième numéro pour le travail, la revente en ligne ou les rencontres. Dès ${lock} par mois.`,
          sections: [
            { h2: "Deux numéros, un téléphone", p: "Votre cellulaire garde son numéro. Le deuxième vit dans l'app MIMT : appels, textos et messagerie vocale séparés." },
            { h2: "Vos règles", p: "Ne pas déranger la nuit, blocage d'appels, renvoi d'appels avec Premium : le deuxième numéro sonne seulement quand vous le voulez." },
            { h2: "Prix clairs", p: `Essentiel ${lock}/mois ou Premium ${premium}/mois, limites affichées d'avance, taxes en sus.` },
            { h2: "Protéger votre numéro personnel", p: "Votre numéro de cellulaire sert à récupérer vos comptes et à recevoir des codes de vérification. Donnez plutôt le deuxième numéro aux inconnus, aux annonces et aux commerces : s'il reçoit trop d'appels importuns, vous le filtrez ou le changez sans toucher au numéro que vos proches connaissent." },
            { h2: "Pour qui", p: "Travailleurs autonomes qui ne veulent pas donner leur numéro personnel aux clients, personnes qui vendent en ligne, propriétaires qui louent un logement, bénévoles d'un organisme, ou quiconque veut une ligne séparée pour un projet sans acheter un deuxième téléphone." },
          ],
          faq: [
            { id: id("privacy"), topic: "mobile", q: "Mon numéro personnel reste-t-il privé?", a: "Oui. Les appels et textos du deuxième numéro affichent ce numéro, jamais celui de votre cellulaire." },
            { id: id("both"), topic: "mobile", q: "Puis-je l'utiliser sur l'ordinateur aussi?", a: "Oui, dans votre navigateur à app.mimt.ca, avec le même compte." },
            { id: id("stop"), topic: "mobile", q: "Puis-je arrêter quand je veux?", a: "Oui, l'abonnement est mensuel et se résilie dans votre compte." },
          ],
          related: ["plans", "help"],
        }
      : {
          eyebrow: "Second number",
          h1: "A second number on the same phone",
          lead: `Keep your personal number to yourself and give out a second one for work, online selling or dating. From ${lock} a month.`,
          sections: [
            { h2: "Two numbers, one phone", p: "Your mobile keeps its number. The second one lives in the MIMT app: separate calls, texts and voicemail." },
            { h2: "Your rules", p: "Do not disturb at night, call blocking, call forwarding with Premium: the second number rings only when you want it to." },
            { h2: "Clear prices", p: `Essential ${lock}/month or Premium ${premium}/month, limits shown up front, taxes extra.` },
            { h2: "Protect your personal number", p: "Your mobile number is used to recover your accounts and receive verification codes. Give the second number to strangers, listings and shops instead: if it gets too many unwanted calls, you filter it or change it without touching the number your family knows." },
            { h2: "Who it is for", p: "Self-employed people who don't want to give clients their personal number, people who sell online, landlords renting out a unit, volunteers for an organization, or anyone who wants a separate line for a project without buying a second phone." },
          ],
          faq: [
            { id: id("privacy"), topic: "mobile", q: "Does my personal number stay private?", a: "Yes. Calls and texts from the second number show that number, never your mobile's." },
            { id: id("both"), topic: "mobile", q: "Can I use it on my computer too?", a: "Yes, in your browser at app.mimt.ca, with the same account." },
            { id: id("stop"), topic: "mobile", q: "Can I stop any time?", a: "Yes, the subscription is monthly and cancels in your account." },
          ],
          related: ["plans", "help"],
        };
  }
  return fr
    ? {
        eyebrow: "Téléphonie IP d'affaires",
        h1: "Téléphonie IP (VoIP) pour les entreprises du Québec",
        lead: `Un système téléphonique complet, sans appareil à acheter : postes, accueil bilingue, groupes de sonnerie et heures d'ouverture. À partir de ${biz} par ligne par mois.`,
        sections: [
          { h2: "Tout ce qu'un standard fait", p: "Postes et numéros directs, accueil « pour le service en français, faites le 1 », groupes de sonnerie, messagerie par poste, renvoi vers le cellulaire." },
          { h2: "Pensé pour le Québec", p: "Heures d'ouverture avec les jours fériés du Québec, français d'abord, enregistrement des appels toujours annoncé à l'autre personne (Affaires Pro)." },
          { h2: "Votre numéro d'entreprise", p: "Réservez un numéro local avec le sélecteur, ou transférez votre numéro actuel sans frais MIMT." },
          { h2: "Ce qu'il vous faut", p: "Une connexion Internet stable au bureau, et l'app MIMT sur les cellulaires ou les ordinateurs de l'équipe. Un appel demande peu de débit; ce qui compte, c'est une connexion sans coupures. Le standard est hébergé chez notre fournisseur : une panne d'Internet au bureau ne coupe pas votre numéro, les employés peuvent répondre dans l'app sur leur cellulaire, par données mobiles, et les appels manqués vont à la messagerie vocale." },
          { h2: "Le 9-1-1 en entreprise", p: "Chaque ligne a une adresse pour le 9-1-1, à tenir à jour quand un employé travaille d'ailleurs. Informez votre équipe des limites du 9-1-1 par Internet et gardez un téléphone fixe ou un cellulaire accessible là où des gens travaillent seuls." },
        ],
        faq: [
          { id: id("hardware"), topic: "business", q: "Faut-il acheter des téléphones?", a: "Non. Vos employés utilisent l'app sur leur cellulaire et leur ordinateur." },
          { id: id("lines"), topic: "business", q: "Comment le prix est-il calculé?", a: `Par ligne (employé) et par mois : ${biz} pour Affaires, ${formatCad(PLANS.business_pro.monthlyPriceCents, "fr")} pour Affaires Pro, taxes en sus.` },
          { id: id("ai"), topic: "business", q: "Qu'est-ce que le réceptionniste IA?", a: "Il répond, renseigne sur vos heures et transfère au bon poste ou prend un message. Les règles de confidentialité s'appliquent." },
        ],
        related: ["business", "contact"],
      }
    : {
        eyebrow: "Business VoIP",
        h1: "VoIP phone system for Québec businesses",
        lead: `A full phone system with no hardware to buy: extensions, bilingual greeting, ring groups and business hours. From ${biz} per line per month.`,
        sections: [
          { h2: "Everything a PBX does", p: "Extensions and direct numbers, a « press 1 for French » greeting, ring groups, voicemail per extension, forwarding to a mobile." },
          { h2: "Built for Québec", p: "Business hours with Québec statutory holidays, French first, call recording always announced to the other party (Business Pro)." },
          { h2: "Your business number", p: "Reserve a local number with the picker, or transfer your current number with no MIMT fee." },
          { h2: "What you need", p: "A stable internet connection at the office, and the MIMT app on your team's mobiles or computers. A call needs little bandwidth; what matters is a connection without dropouts. The phone system is hosted at our provider: an internet outage at the office doesn't cut off your number, staff can answer in the app on their mobiles over mobile data, and missed calls go to voicemail." },
          { h2: "9-1-1 at work", p: "Each line has a 9-1-1 address, to be kept up to date when an employee works from elsewhere. Tell your team about the limits of 9-1-1 over the internet, and keep a landline or a mobile within reach where people work alone." },
        ],
        faq: [
          { id: id("hardware"), topic: "business", q: "Do we need to buy phones?", a: "No. Your staff use the app on their mobiles and computers." },
          { id: id("lines"), topic: "business", q: "How is it priced?", a: `Per line (employee) per month: ${biz} for Business, ${formatCad(PLANS.business_pro.monthlyPriceCents, "en")} for Business Pro, taxes extra.` },
          { id: id("ai"), topic: "business", q: "What is the AI receptionist?", a: "It answers, gives your hours and transfers to the right extension or takes a message. Privacy rules apply." },
        ],
        related: ["business", "contact"],
      };
}

export function landingCopy(key: LandingKey, lang: Lang): LandingCopy {
  return (CITY_PAGES as readonly string[]).includes(key) ? cityCopy(key as CityKey, lang) : useCopy(key as UseKey, lang);
}

export function isCity(key: LandingKey): key is CityKey {
  return (CITY_PAGES as readonly string[]).includes(key);
}
