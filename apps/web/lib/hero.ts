import type { Lang } from "./site";

/**
 * Homepage hero: without a phone number, texts to other MIMT users are free (@nom) and app-to-app calls
 * use the Free plan's minute cap. Calls are not unlimited. `minutes` comes from PLANS.free.caps.onNetMinutes.
 */
export function heroWithoutNumber(lang: Lang, minutes: number): string {
  const shown = new Intl.NumberFormat(lang === "fr" ? "fr-CA" : "en-CA").format(minutes);
  return lang === "fr"
    ? `Sans numéro, textez gratuitement les autres utilisateurs MIMT avec @nom, et appelez-les entre applications : ${shown} minutes par mois sur le forfait Gratuit.`
    : `Without a number, text other MIMT users for free with @nom, and call them between apps: ${shown} minutes a month on the Free plan.`;
}
