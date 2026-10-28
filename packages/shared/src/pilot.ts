// « Pilote MIMT »: the AI command bar of the web app (docs/MIMT-PILOTE.md).
// The user says what they want; the server turns it into a PLAN of whitelisted tool calls, shows the steps,
// runs read-only steps at once and waits for an explicit confirmation before anything that changes the account.
// This file is the contract (types, tool list, pages) and the deterministic French/English intent parser used
// when Claude is not available (no key, no consent, no budget, AI_COMMANDS=rules) and by the demo mode.

import type { Locale } from "./api.js";
import { isEmergencyNumber } from "./numbers.js";

/** Every tool the Pilote may propose. Anything else is dropped by the server. */
export const PILOT_TOOLS = [
  "navigate",
  "search_calls",
  "open_conversation",
  "open_voicemail",
  "usage_summary",
  "missions_status",
  "send_text",
  "call_number",
  "set_forwarding",
  "set_dnd",
  "set_voicemail_greeting",
  "block_number",
  "unblock_number",
  "set_handle",
  "start_meeting",
  "set_business_hours",
  "set_business_greeting",
] as const;
export type PilotTool = (typeof PILOT_TOOLS)[number];

/** Tools that change the account (or place a call): they always need a confirmation within PILOT_PLAN_TTL_S. */
export const PILOT_MUTATING: ReadonlySet<PilotTool> = new Set<PilotTool>([
  "send_text",
  "call_number",
  "set_forwarding",
  "set_dnd",
  "set_voicemail_greeting",
  "block_number",
  "unblock_number",
  "set_handle",
  "start_meeting",
  "set_business_hours",
  "set_business_greeting",
]);

/** Business tools: owner role only, even when the underlying route accepts admins. */
export const PILOT_OWNER_ONLY: ReadonlySet<PilotTool> = new Set<PilotTool>(["set_business_hours", "set_business_greeting"]);

/** A confirmation must arrive within this many seconds; then the plan is gone and must be asked again. */
export const PILOT_PLAN_TTL_S = 120;
/** Longest command accepted (characters). */
export const PILOT_MAX_COMMAND_CHARS = 500;
/** At most this many tool calls in one plan. */
export const PILOT_MAX_ACTIONS = 4;

/** Pages the Pilote can open. The web app maps them to its French URLs. */
export const PILOT_PAGES = [
  "messages",
  "calls",
  "voicemail",
  "account",
  "call_settings",
  "help",
  "missions",
  "meetings",
  "offers",
  "orders",
  "port_in",
  "business",
  "business_hours",
  "business_receptionist",
] as const;
export type PilotPage = (typeof PILOT_PAGES)[number];

export interface PilotToolCall {
  tool: PilotTool;
  args: Record<string, unknown>;
}

export type PilotStepKind = "understand" | "check" | "action" | "result" | "refuse" | "info";

/** One line of the live console (« ◢ Vérification : forfait Premium ✓ »). Text is in the user's language. */
export interface PilotStep {
  kind: PilotStepKind;
  text: string;
  /** true = passed, false = failed; absent = neutral. */
  ok?: boolean;
}

/** Where the app goes after a step, and what it highlights there (data-pilot attribute value). */
export interface PilotNavigate {
  page: PilotPage;
  /** Extra path segment (conversation peer, business id). */
  param?: string;
  /** Query string values (filtre=manques…). */
  query?: Record<string, string>;
  highlight?: string;
}

/** Something only the browser can do, after confirmation (the server never places a call by itself). */
export interface PilotClientAction {
  type: "dial";
  number: string;
}

export interface PilotActionView {
  tool: PilotTool;
  /** Plain-language description of what will happen. */
  summary: string;
  mutating: boolean;
}

/** POST /v1/ai/command */
export interface PilotCommandRequest {
  text: string;
  /** Page the user is on (helps the model; never trusted for permissions). */
  page?: string;
}

export interface PilotCommandResponse {
  /** Set when confirmable actions wait for POST /v1/ai/command/confirm. */
  planId: string | null;
  expiresAt: string | null;
  /** "ai" = Claude proposed the plan; "rules" = the local parser did. */
  source: "ai" | "rules";
  understood: boolean;
  steps: PilotStep[];
  /** Actions waiting for confirmation (empty when nothing changes the account). */
  pending: PilotActionView[];
  navigate: PilotNavigate | null;
}

/** POST /v1/ai/command/confirm (cancel: POST /v1/ai/command/cancel with the same body). */
export interface PilotConfirmRequest {
  planId: string;
}

export interface PilotConfirmResponse {
  steps: PilotStep[];
  results: Array<{ tool: PilotTool; ok: boolean; code?: string }>;
  navigate: PilotNavigate | null;
  clientAction: PilotClientAction | null;
}

// ------------------------------------------------------------------------------------- parser

/** What the local parser recognised. `refusal` = a request the Pilote never handles (payments, deletion, 9-1-1). */
export interface PilotParse {
  calls: PilotToolCall[];
  refusal: PilotRefusal | null;
}

export type PilotRefusal = "payments" | "plan_change" | "account_deletion" | "e911" | "emergency_call" | "other_users";

const strip = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** Canada/US number in a sentence → E.164, or null. "514 555-0123", "(514) 555 0123", "+1 514…", "1-514-…". */
export function findNanpNumber(text: string): string | null {
  const m = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?!\d)/.exec(text);
  return m ? `+1${m[1]}${m[2]}${m[3]}` : null;
}

const findHandle = (text: string): string | null => /@([a-z0-9._]{3,20})\b/i.exec(text)?.[1]?.toLowerCase() ?? null;

const DAY_WORDS: Array<[RegExp, string]> = [
  [/\blun(di)?\b|\bmon(day)?\b/, "mon"],
  [/\bmar(di)?\b|\btue(s(day)?)?\b/, "tue"],
  [/\bmer(credi)?\b|\bwed(nesday)?\b/, "wed"],
  [/\bjeu(di)?\b|\bthu(rs(day)?)?\b/, "thu"],
  [/\bven(dredi)?\b|\bfri(day)?\b/, "fri"],
  [/\bsam(edi)?\b|\bsat(urday)?\b/, "sat"],
  [/\bdim(anche)?\b|\bsun(day)?\b/, "sun"],
];
const WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function parseDays(t: string): string[] {
  if (/en semaine|weekdays?|lundi au vendredi|monday (to|through|-) friday|mon ?- ?fri/.test(t)) return WEEK.slice(0, 5);
  if (/tous les jours|7 jours|every ?day|7 days|daily/.test(t)) return WEEK;
  if (/fin de semaine|week-?end/.test(t)) return ["sat", "sun"];
  for (const range of t.matchAll(/\b(\w+) (?:au|a|to|through|-) (\w+)\b/g)) {
    const a = DAY_WORDS.findIndex(([re]) => re.test(range[1]!));
    const b = DAY_WORDS.findIndex(([re]) => re.test(range[2]!));
    if (a >= 0 && b >= a) return WEEK.slice(a, b + 1);
  }
  return DAY_WORDS.filter(([re]) => re.test(t)).map(([, d]) => d);
}

/** "9 h", "9h30", "17:00", "5 pm", "9am" → "HH:MM". */
function parseTimes(t: string): [string, string] | null {
  const re = /\b(\d{1,2})(?:\s?(?:h|:)\s?(\d{2})?|\s?(am|pm))(?:\s?(am|pm))?/g;
  const out: string[] = [];
  for (const m of t.matchAll(re)) {
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const ampm = m[3] ?? m[4];
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    if (h > 23 || min > 59) continue;
    out.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }
  if (out.length < 2) {
    // "9 to 5" / "de 9 a 17"
    const bare = /\b(?:de |from )?(\d{1,2}) (?:a|to|-) (\d{1,2})\b/.exec(t);
    if (!bare) return null;
    let a = Number(bare[1]);
    let b = Number(bare[2]);
    if (b <= a && b < 12) b += 12;
    if (a > 23 || b > 23) return null;
    return [`${String(a).padStart(2, "0")}:00`, `${String(b).padStart(2, "0")}:00`];
  }
  return [out[0]!, out[1]!];
}

const PAGE_WORDS: Array<[RegExp, PilotPage]> = [
  [/parametres d'appel|reglages d'appel|call settings|renvoi d'appel|call forwarding/, "call_settings"],
  [/heures d'ouverture|business hours|opening hours/, "business_hours"],
  [/receptionniste|receptionist/, "business_receptionist"],
  [/messagerie|boite vocale|messages? vocaux|message vocal|voicemail/, "voicemail"],
  [/appels|calls|historique|call log|recents/, "calls"],
  [/textos?|messages|conversations|texts?\b|sms/, "messages"],
  [/compte|profil|account|profile/, "account"],
  [/aide|help|support/, "help"],
  [/missions?/, "missions"],
  [/reunions?|meetings?/, "meetings"],
  [/offres|offers|internet|cellulaire/, "offers"],
  [/commandes|orders/, "orders"],
  [/transfert de numero|transferer mon numero|port(ing)?[- ]in|port my number/, "port_in"],
  [/entreprise|affaires|business/, "business"],
];

/**
 * Deterministic French/English intent parser for the common commands. Pure: the server re-validates
 * every call it returns exactly like a model proposal. Returns no calls when nothing is recognised.
 */
export function parsePilotCommand(input: string): PilotParse {
  const raw = input.slice(0, PILOT_MAX_COMMAND_CHARS);
  const t = strip(raw);
  const none: PilotParse = { calls: [], refusal: null };
  const one = (tool: PilotTool, args: Record<string, unknown> = {}): PilotParse => ({ calls: [{ tool, args }], refusal: null });
  const refuse = (r: PilotRefusal): PilotParse => ({ calls: [], refusal: r });
  if (!t) return none;

  // Never: account deletion, payments, plan changes, 9-1-1 address, emergency calls (the user dials 9-1-1 directly).
  if (/(supprime|supprimer|efface|effacer|ferme|fermer|delete|close|cancel) (mon |my )?(compte|account)/.test(t)) return refuse("account_deletion");
  if (/(adresse|address).{0,20}(9-?1-?1|urgence|emergency)|(9-?1-?1|e911).{0,20}(adresse|address)/.test(t)) return refuse("e911");
  if (/(change|changer|passe|passer|upgrade|downgrade|annule|annuler|cancel|switch).{0,25}(forfait|plan|abonnement|subscription)/.test(t)) return refuse("plan_change");
  if (/\b(paie|paye|payer|paiement|pay|payment|carte de credit|credit card|factures?|facturation|billing|rembourse|rembourser|refund|achete|acheter|buy|purchase)\b/.test(t)) return refuse("payments");

  const number = findNanpNumber(raw);
  const handle = findHandle(raw);

  // Calls to 9-1-1 are never placed by the Pilote.
  if (/\b(appelle|appeler|compose|composer|call|dial)\b/.test(t) && /(^|\D)9-?1-?1(\D|$)/.test(t) && !number) return refuse("emergency_call");

  // ---- forwarding
  if (/(renvoi|renvoie|renvoyer|transfere|transferer|redirige|rediriger|forward)/.test(t) && /(appel|call|renvoi|forward)/.test(t) && !/numero (vers|chez) mimt|port/.test(t)) {
    if (/(desactive|desactiver|arrete|arreter|enleve|enlever|annule|annuler|stop|turn off|disable|remove|plus de|no more|off\b)/.test(t)) {
      return one("set_forwarding", { mode: "off" });
    }
    const mode = /(si je (ne )?reponds? pas|pas de reponse|sans reponse|no answer|don't answer|do not answer|unanswered|if i miss)/.test(t) ? "no_answer" : "always";
    return one("set_forwarding", number ? { mode, target: number } : { mode });
  }

  // ---- do not disturb
  if (/ne pas deranger|do not disturb|\bdnd\b|mode silencieux|silent mode/.test(t)) {
    const off = /(desactive|desactiver|arrete|arreter|enleve|stop|turn off|disable|off\b|fin du)/.test(t);
    return one("set_dnd", { enabled: !off });
  }

  // ---- blocking
  if (/\b(debloque|debloquer|unblock)\b/.test(t)) return one("unblock_number", { number: number ?? raw });
  if (/\b(bloque|bloquer|block)\b/.test(t)) return one("block_number", { number: number ?? raw });

  // ---- greeting (personal voicemail)
  if (/(message d'accueil|salutation|greeting|accueil)/.test(t) && !/(entreprise|affaires|business|receptionniste|receptionist)/.test(t)) {
    if (/(defaut|default|reinitialise|remettre|remets|reset|standard)/.test(t)) return one("set_voicemail_greeting", { mode: "default" });
    if (/(enregistre|enregistrer|record|nouveau|nouvelle|change|changer|new)/.test(t)) return one("set_voicemail_greeting", { mode: "record_by_phone" });
  }

  // ---- business greeting / hours (owner)
  if (/(accueil|greeting|salutation)/.test(t) && /(entreprise|affaires|business|receptionniste|receptionist)/.test(t)) {
    const text = /[:«"]\s*(.+?)\s*[»"]?$/.exec(raw)?.[1]?.trim();
    return one("set_business_greeting", { text: text ?? "" });
  }
  if (/(heures d'ouverture|heures d'affaires|horaire|business hours|opening hours|open from|ouvert de|ouverts de|open \d)/.test(t)) {
    const times = parseTimes(t);
    const days = parseDays(t);
    if (times) return one("set_business_hours", { days: days.length ? days : WEEK.slice(0, 5), open: times[0], close: times[1] });
    return one("navigate", { page: "business_hours" });
  }

  // ---- handle
  if (handle && /(identifiant|@nom|pseudo|handle|username|choisis|choisir|reserve|reserver|prends|prendre|claim|set my|mon nom)/.test(t) && !/(texto|texte|ecris|message|text\b|write)/.test(t)) {
    return one("set_handle", { handle });
  }

  // ---- send a text: "écris à 514… : on se voit à 5 h" / "text 514… saying I'm late"
  if (/(^|\s)(texte|texter|ecris|ecrire|envoie|envoyer|text|send|sms)\b/.test(t) && (number || handle) && !/(vocal|vocaux|voicemail)/.test(t)) {
    const body =
      /(?::|,|\bpour (?:lui )?dire(?: que)?|\bdisant(?: que)?|\bque\b|\bsaying\b|\bthat\b|\bto say\b)\s*(.+)$/i.exec(raw.replace(/^.*?(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}|@[a-z0-9._]{3,20})/i, ""))?.[1]?.trim() ??
      "";
    return one("send_text", { to: number ?? `@${handle}`, body: body.replace(/^["«]\s*|\s*["»]$/g, "") });
  }

  // ---- call someone
  if (/\b(appelle|appeler|rappelle|rappeler|compose|composer|telephone a|call|call back|dial|ring)\b/.test(t) && number) return one("call_number", { number });

  // ---- read-only answers
  if (/(manque|missed)/.test(t) && /(appel|call)/.test(t)) return one("search_calls", { filter: "missed" });
  if (/(minutes?|forfait|consommation|reste|usage|left|remaining|quota|textos restants)/.test(t) && !/(mission)/.test(t)) return one("usage_summary");
  if (/missions?|recompense|reward|bonus/.test(t)) return one("missions_status");
  if (/(messagerie|message vocal|messages vocaux|boite vocale|voicemail|vocal)/.test(t)) {
    const from = number ?? /\b(?:de|from|du|d') ?([a-zà-ÿ][\wà-ÿ-]{1,30})\s*$/i.exec(raw.trim())?.[1] ?? null;
    return one("open_voicemail", from ? { from } : {});
  }
  if (/(conversation|fil|thread|chat|discussion)/.test(t) && (number || handle)) return one("open_conversation", { peer: number ?? `@${handle}` });
  if (/(reunion|meeting|visio|video ?call)/.test(t) && /(demarre|demarrer|lance|lancer|cree|creer|commence|nouvelle|start|create|new|begin|open)/.test(t)) {
    const title = /(?:sur|about|titled|intitulee?|nommee?|named|:)\s+(.+)$/i.exec(raw)?.[1]?.trim();
    return one("start_meeting", title ? { title } : {});
  }
  if (/(appel|call|recent|historique|history)/.test(t) && !/(parametres|reglages|settings)/.test(t)) {
    const dir = /(entrant|recu|incoming|received)/.test(t) ? "inbound" : /(sortant|fait|outgoing|made|placed)/.test(t) ? "outbound" : "all";
    return one("search_calls", number ? { filter: dir, peer: number } : { filter: dir });
  }

  // ---- navigation
  if (/(va |aller|allons|ouvre|ouvrir|montre|affiche|afficher|voir|go to|open|show|take me|navigate)/.test(t) || t.split(" ").length <= 3) {
    const page = PAGE_WORDS.find(([re]) => re.test(t))?.[1];
    if (page) return one("navigate", { page });
  }
  return none;
}

/** The Pilote never dials 9-1-1 itself (the user dials it from the keypad, which always works). */
export const pilotDialAllowed = (n: string) => !isEmergencyNumber(n);

/** Default ambient locale for texts the parser builds. */
export const PILOT_DEFAULT_LOCALE: Locale = "fr-CA";
