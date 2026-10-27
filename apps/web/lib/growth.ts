// Growth surfaces of mimt.ca (offer ticker, promo, AI launcher, missions page), kept pure so node --test can
// check them. Every offer here is real and backed by the API: no invented scarcity, timers or popularity
// (test/site.test.ts bans those words). Missions mirror the server-verified list in the API (GET /v1/missions).

import { PLANS, type PlanCode } from "@mimt/shared";
import type { KeyValueStore, StoreGetter } from "./download-prompt";

export type Lang = "fr" | "en";

/** Plans that can be paid yearly, 12 months for the price of 11 (packages/shared yearlyPriceCents). */
export function yearlyPlans(): PlanCode[] {
  return (Object.keys(PLANS) as PlanCode[]).filter((c) => {
    const p = PLANS[c];
    return p.monthlyPriceCents > 0 && p.yearlyPriceCents !== undefined && p.yearlyPriceCents <= p.monthlyPriceCents * 11;
  });
}

/** True once the yearly offer is live in the shared plans. */
export function yearlyOfferLive(): boolean {
  return yearlyPlans().length > 0;
}

export interface Mission {
  id: string;
  minutes: number | null;
  title: { fr: string; en: string };
  how: { fr: string; en: string };
  /** Where the visitor completes it. */
  path: string;
}

/** Same ids, triggers and rewards as the API. Minutes are one time per account, added to the current month. */
export const MISSIONS: readonly Mission[] = [
  {
    id: "verify_phone",
    minutes: 15,
    title: { fr: "Vérifiez votre cellulaire", en: "Verify your mobile" },
    how: { fr: "Connectez-vous avec le code reçu par texto.", en: "Sign in with the code we text you." },
    path: "/connexion/texto",
  },
  {
    id: "choose_handle",
    minutes: 30,
    title: { fr: "Choisissez votre @nom", en: "Pick your @name" },
    how: { fr: "Votre nom MIMT pour texter et appeler gratuitement entre applications.", en: "Your MIMT name for free app-to-app texts and calls." },
    path: "/compte",
  },
  {
    id: "enable_push",
    minutes: 15,
    title: { fr: "Activez les notifications", en: "Turn on notifications" },
    how: { fr: "Pour ne manquer aucun appel ni texto.", en: "So you never miss a call or a text." },
    path: "/compte",
  },
  {
    id: "install_app",
    minutes: 30,
    title: { fr: "Installez l'app mobile", en: "Install the mobile app" },
    how: { fr: "Connectez-vous une première fois dans l'app iPhone ou Android.", en: "Sign in once in the iPhone or Android app." },
    path: "/missions",
  },
  {
    id: "first_number",
    minutes: 60,
    title: { fr: "Obtenez votre numéro", en: "Get your number" },
    how: { fr: "Votre vrai numéro canadien, actif dès le paiement.", en: "Your real Canadian number, live as soon as you pay." },
    path: "/numero",
  },
  {
    id: "invite_friend",
    minutes: null,
    title: { fr: "Un ami s'abonne", en: "A friend subscribes" },
    how: { fr: "Vous recevez tous les deux 1 mois Premium.", en: "You both get 1 month of Premium." },
    path: "/missions",
  },
];

export function missionMinutesTotal(): number {
  return MISSIONS.reduce((sum, m) => sum + (m.minutes ?? 0), 0);
}

/** Offers that rotate in the top banner. Only real ones; the yearly one appears once it is live. */
export function tickerOffers(lang: Lang): { strong: string; text: string; href: string }[] {
  const fr = lang === "fr";
  const list = [
    { strong: fr ? "Lancement :" : "Launch:", text: fr ? "transfert de votre numéro gratuit, aucuns frais d'activation." : "free number transfer, no activation fee.", href: "#numero" },
    {
      strong: fr ? "Missions :" : "Missions:",
      text: fr ? `gagnez jusqu'à ${missionMinutesTotal()} minutes bonus en configurant votre compte.` : `earn up to ${missionMinutesTotal()} bonus minutes by setting up your account.`,
      href: fr ? "/recompenses/" : "/en/rewards/",
    },
    { strong: fr ? "Parrainage :" : "Referral:", text: fr ? "un ami s'abonne, vous recevez tous les deux 1 mois Premium." : "a friend subscribes, you both get 1 month of Premium.", href: fr ? "/recompenses/" : "/en/rewards/" },
  ];
  if (yearlyOfferLive()) {
    list.splice(1, 0, { strong: fr ? "Annuel :" : "Yearly:", text: fr ? "12 mois pour le prix de 11, soit 1 mois gratuit." : "12 months for the price of 11, one month free.", href: fr ? "/forfaits/" : "/en/plans/" });
  }
  return list;
}

// ---------- Promo pop-up: at most once every 7 days per visitor ----------

export const PROMO_STORAGE_KEY = "mimt.promo.v1";
export const PROMO_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
export const PROMO_DESKTOP_DELAY_MS = 20_000;

/** Any storage problem counts as "seen recently", so a private window is never nagged on every page. */
export function promoDue(getStore: StoreGetter, now: Date = new Date()): boolean {
  try {
    const s: KeyValueStore | null | undefined = getStore();
    if (!s) return false;
    const last = s.getItem(PROMO_STORAGE_KEY);
    if (last === null) return true;
    const t = Date.parse(last);
    return !Number.isFinite(t) || now.getTime() - t >= PROMO_EVERY_MS;
  } catch {
    return false;
  }
}

export function markPromoSeen(getStore: StoreGetter, now: Date = new Date()): void {
  try {
    getStore()?.setItem(PROMO_STORAGE_KEY, now.toISOString());
  } catch {
    /* blocked storage: promoDue() already answers false */
  }
}
