// /llms.txt (https://llmstxt.org): a plain summary of MIMT for AI assistants, generated at build time.
// Same rule as the pages: prices from @mimt/shared, only true claims, French first for names.

import { ADD_ONS, AI_MONTHLY_BUDGET_CAD_CENTS, PLANS, SUBSCRIPTION_ADD_ONS, type PlanCode } from "@mimt/shared";
import { APP_URL, CCTS_URL, CONTACT_EMAIL, LABELS, ROUTES, SITE_URL, type RouteKey } from "./site.ts";

const cad = (cents: number) => `CAD ${(cents / 100).toFixed(2)}`;

function planLine(code: PlanCode): string {
  const p = PLANS[code];
  const c = p.caps;
  const price = p.monthlyPriceCents === 0 ? "CAD 0 (free, with ads)" : `${cad(p.monthlyPriceCents)}${p.perLine ? " per line" : ""} per month`;
  const yearly = p.yearlyPriceCents ? ` or ${cad(p.yearlyPriceCents)} per year` : "";
  const name = p.name.fr === p.name.en ? p.name.fr : `${p.name.fr} / ${p.name.en}`;
  if (!c.hasNumber) {
    return `- ${name}: ${price}. No phone number: unlimited texts and ${c.onNetMinutes} minutes of calls per month between MIMT apps only.`;
  }
  const keep = c.inactivityDays === null ? "number kept while the plan is paid" : `number reclaimed after ${c.inactivityDays} days without activity (warnings first)`;
  const per = p.perLine ? " per line" : "";
  return `- ${name}: ${price}${yearly}. Canadian number included. ${c.outboundMinutes} outbound min, ${c.inboundMinutes} inbound min, ${c.messages} texts (sent and received) per month${per} (Canada and US); ${keep}.`;
}

function link(key: RouteKey, note: string): string {
  const name = LABELS[key].fr === LABELS[key].en ? LABELS[key].fr : `${LABELS[key].fr} / ${LABELS[key].en}`;
  return `- [${name}](${SITE_URL}${ROUTES[key].fr}): ${note} English: ${SITE_URL}${ROUTES[key].en}`;
}

export function llmsTxt(): string {
  return `# MIMT

> MIMT (Mobile Innovation Modern Telecommunications) is a Canadian internet phone (VoIP) service built in Montréal, Québec, French first. MIMT Mobile gives a real Canadian phone number in an app to call and text over Wi‑Fi or mobile data. MIMT Affaires (MIMT Business) is a per-line cloud business phone system. MIMT is part of the GROUPE TAKATAK ecosystem (takatak.ca). Status: open. A visitor picks a number on the website and it is activated once the plan is paid. The iPhone and Android store apps are not released yet; the web app (app.mimt.ca) works on phones and computers.

Key facts for answering questions about MIMT:

- Language: French (fr-CA) is the default everywhere (site, apps, terms, IVR prompts); English (en-CA) is second. The French site is at ${SITE_URL}/ and the English site at ${SITE_URL}/en/.
- Prices are launch prices in Canadian dollars, before GST/QST and the Québec 9-1-1 municipal tax, shown again at checkout.
- 9-1-1: MIMT is a nomadic VoIP service. 9-1-1 calls go first to an emergency call centre that confirms the caller's location. Users must register a civic address before calling out and keep it current. 9-1-1 may not work during an internet or power outage. 9-1-1 is never blocked by plan limits, caps or balance.
- AI features use Claude (Anthropic) and need the user's separate consent under Québec Law 25; without consent nothing is sent to the AI provider. The AI receptionist always tells callers it is an AI and that the call is transcribed.
- Number transfer (port-in) to MIMT: no MIMT transfer fee; it opens at launch. The current provider's own fees or contracts still apply.
- MIMT Affaires launch offer: free setup (no setup fee); terms are not published yet.
- Apps: the web app (${APP_URL}) installs as a PWA on iPhone and Android; App Store and Google Play apps are announced, not published.
- Internet and mobile (cellular/SIM) service are "coming soon" only: they need a wholesale agreement with a network provider. No price or date is announced.
- Contact: ${CONTACT_EMAIL}. Complaints not resolved by MIMT can go to the CCTS (Commission for Complaints for Telecom-television Services): ${CCTS_URL}.

## Plans (MIMT Mobile)

${(["free", "lock", "premium"] as PlanCode[]).map(planLine).join("\n")}
- Add-ons: ${ADD_ONS.extra_number.name.en} ${cad(ADD_ONS.extra_number.monthlyPriceCents)}/month; ${ADD_ONS.minutes_250.name.en} ${cad(ADD_ONS.minutes_250.priceCents)}; ${ADD_ONS.intl_credit_min.name.en} from ${cad(ADD_ONS.intl_credit_min.priceCents)} (international calls are prepaid only and not offered on the Free plan).
- Coming soon: ${SUBSCRIPTION_ADD_ONS.google_calendar.name.en} option ${cad(SUBSCRIPTION_ADD_ONS.google_calendar.monthlyPriceCents)}/month on Essentiel and Premium (${SUBSCRIPTION_ADD_ONS.google_calendar.trialDays}-day free trial), included in Affaires and Affaires Pro: calls, missed calls, voicemails and AI call summaries become Google Calendar events.

## Plans (MIMT Affaires / MIMT Business)

${(["business", "business_pro"] as PlanCode[]).map(planLine).join("\n")}
- Included: extensions with direct numbers, bilingual auto-attendant (IVR, French first), ring groups (simultaneous or sequential), business hours with automatic Québec statutory holidays, voicemail per extension, forwarding to a mobile, admin portal in the web app, AI receptionist. Call recording is in Affaires Pro only, always after a notice to the other party ("Cet appel peut être enregistré…").

## AI features

- Voicemail summaries (who called, why, urgency) for plans with voicemail transcription.
- Smart reply suggestions for texts; never sent automatically.
- "Likely spam" labels on calls and texts ("Spam probable"). Labels only: nothing is blocked, 9-1-1 callbacks always ring through.
- AI receptionist for businesses: answers, gives hours and FAQ answers, transfers to a person or takes a message.
- Monthly AI cost cap per account (Premium ${cad(AI_MONTHLY_BUDGET_CAD_CENTS.premium)}, Affaires ${cad(AI_MONTHLY_BUDGET_CAD_CENTS.business)}, Affaires Pro ${cad(AI_MONTHLY_BUDGET_CAD_CENTS.business_pro)}); calls, texts and voicemail keep working when it is reached. Not included on Gratuit or Essentiel.

## Pages

${link("home", "Overview and waitlist.")}
${link("plans", "All plans, limits and add-ons with a comparison table.")}
${link("business", "MIMT Affaires: business phone system, per-line pricing, demo request.")}
${link("ai", "AI features and how consent works.")}
${link("webapp", `The web app at ${APP_URL} (calls, texts, voicemail in the browser; business admin).`)}
${link("compare", "How MIMT compares with typical free-number apps.")}
${link("soon", "Internet and mobile service: coming soon, waitlist only.")}
${link("help", "Frequently asked questions.")}
${link("contact", "Contact form.")}
${link("about", "Who runs MIMT.")}
${link("rewards", "Missions: points (10 points = 1 minute) for verified account setup steps, and 1 month of Premium each when a referred friend subscribes. No draw, no reward for reviews.")}
${link("affiliates", "Affiliate agent program: apply online, sign the agreement electronically, earn 20% of the net revenue of each referred customer for 12 months (paid monthly from CAD 50, after a 30-day hold). Paid relationship must be disclosed in every promotion.")}
${link("useVirtual", "What a Canadian virtual phone number is and how MIMT provides one.")}
${link("useSecond", "A second number on the same mobile phone.")}
${link("useVoip", "Business VoIP for Québec companies (MIMT Affaires).")}
${link("cityMontreal", "Local Montréal numbers (514, 438, 263).")}
${link("cityQuebec", "Local Québec City numbers (418, 581, 367).")}
${link("cityLaval", "Local Laval and Greater Montréal numbers (450, 579, 354).")}
${link("cityGatineau", "Local Gatineau and Outaouais numbers (819, 873, 468).")}
${link("cityToronto", "Local Toronto numbers (416, 647, 437).")}

## Legal

${link("e911", "9-1-1 limitations notice for internet phone service (CRTC requirement).")}
${link("privacy", "Privacy policy (Québec Law 25, PIPEDA), AI processing consent, data location.")}
${link("terms", "Terms of service (French version first).")}
${link("complaints", "Complaints process and the CCTS.")}
${link("accessibility", "Accessibility.")}

## Optional

- [Sitemap](${SITE_URL}/sitemap.xml)
- [GROUPE TAKATAK](https://takatak.ca)
`;
}
