import { formatCad, type Locale, type PlanCode } from "@mimt/shared";
import type { PlanTable } from "../plansConfig.js";

/**
 * What the in-app help assistant knows, and nothing else. Built from the live plan table so prices and limits are
 * always the real ones. Facts only: when something is not here, the assistant must say so and hand over to a person.
 */
export function helpKnowledge(plans: PlanTable, locale: Locale): string {
  const fr = locale === "fr-CA";
  const lang = fr ? "fr" : "en";
  const line = (code: PlanCode) => {
    const p = plans[code];
    const c = p.caps;
    return `- ${p.name[lang]} (${code}): ${formatCad(p.monthlyPriceCents, lang)}${p.perLine ? " per line" : ""}/month before taxes; outbound ${c.outboundMinutes} min, inbound ${c.inboundMinutes} min, ${c.messages} texts (sent + received)${c.mms ? `, up to ${c.mms} MMS` : ""}${code === "free" ? `, app-to-app calls ${c.onNetMinutes ?? 0} min, no phone-network number, ads` : ""}.`;
  };
  return [
    "# MIMT facts (the only source you may use)",
    "MIMT (Mobile Innovation Modern Telecommunications) is a GROUPE TAKATAK company in Montréal, Québec. Web app: app.mimt.ca. Website: mimt.ca. Contact: info@mimt.ca.",
    "## Plans (prices in CAD, GST/QST and the Québec 9-1-1 municipal tax are extra; no contract, cancel any time)",
    (["free", "lock", "premium", "business", "business_pro"] as const).map(line).join("\n"),
    "## Getting a number",
    "- On mimt.ca or the Affaires page: type an area code or a city, pick a number; it is held 10 minutes; then sign in, enter the 9-1-1 address, choose a plan and pay with Stripe. The number turns on as soon as the payment clears.",
    "- If an area code is sold out at the carrier (514, 263, 418, 416, 647 often are), the picker offers a neighbouring code (for example 438 for Montréal, 581 for Québec).",
    "- Number transfer (porting) is free: in the app, Boutique › Transférer un numéro. It needs the account number and PIN from the current carrier; it takes a few business days.",
    "## Free MIMT-to-MIMT",
    "- Every user picks a handle (@name) once in Compte › Mon identifiant MIMT. Texts to an @handle are free and unlimited on every plan, no phone number needed. App-to-app calls by @handle use the plan's app-to-app minutes.",
    "## 9-1-1",
    "- 9-1-1 is never blocked. Internet phone service has limits: the emergency centre receives the 9-1-1 address registered in the account, so keep it up to date in Compte. Power or internet outages stop the service. Full notice: mimt.ca/9-1-1/.",
    "## Account, billing, privacy",
    "- Sign in with a TAKATAK account or a code by text. Billing and cancellation: Compte › Facturation (Stripe customer portal). Refund questions and complaints: info@mimt.ca; unresolved telecom complaints can go to the CCTS (ccts-cprst.ca).",
    "- Privacy: Québec Law 25. AI features are optional and need separate consent. Messages are encrypted at rest. Notifications never show message text.",
    "- Notifications: Compte › Notifications (browser notifications for new texts and voicemail).",
  ].join("\n");
}

export const HELP_SYSTEM = `You are the MIMT help assistant inside the MIMT web app.
Answer ONLY from the "MIMT facts" provided. If the answer is not there, say you don't know and set needsHuman to true.
Never invent prices, limits, policies, dates or features. Never promise refunds or exceptions.
Reply in the user's language (French by default, Québec French), in 1 to 4 short sentences, friendly and plain. No markdown headings.
Point to the exact place in the app (for example « Compte › Facturation ») when the user must act themselves.
You cannot see or change the user's account. For emergencies, tell them to dial 9-1-1.
Set needsHuman to true for complaints, billing disputes, legal questions, account access problems, or anything you cannot answer from the facts.`;
