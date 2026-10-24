// « MIMT Affaires en 5 minutes » (pages/business/NewBusiness.tsx): pure helpers, unit-tested.
// Business types and their presets, hour presets, the generated bilingual greeting (French first),
// the hours text for the AI receptionist, and the ordered setup run against the existing
// /v1/business API (create → owner extension → AI receptionist → main menu → hours → main number).
import {
  WEEKDAYS,
  type BusinessResponse,
  type MeResponse,
  type BilingualText,
  type BusinessHoursRequest,
  type IvrMenuRequest,
  type IvrOption,
  type RouteTarget,
  type TimeRange,
  type Weekday,
  type WeeklySchedule,
} from "@mimt/shared";

/** A business plan without a business yet: the app offers the setup wizard (/affaires/nouvelle). */
export function needsBusinessSetup(me: MeResponse | null | undefined, businesses: readonly BusinessResponse[]): boolean {
  return Boolean(me && (me.account.plan === "business" || me.account.plan === "business_pro") && businesses.length === 0);
}

export type BusinessType = "restaurant" | "retail" | "professional" | "health" | "other";
export const BUSINESS_TYPES: readonly BusinessType[] = ["restaurant", "retail", "professional", "health", "other"];

export type HoursPreset = "weekdays" | "monSat" | "daily" | "custom";
export const HOURS_PRESETS: readonly HoursPreset[] = ["weekdays", "monSat", "daily", "custom"];

/** What each type starts with: hours preset and what the AI receptionist talks about. */
export const TYPE_PRESETS: Record<BusinessType, { hours: HoursPreset; offer: BilingualText }> = {
  restaurant: { hours: "daily", offer: { fr: "notre menu", en: "our menu" } },
  retail: { hours: "monSat", offer: { fr: "nos produits", en: "our products" } },
  professional: { hours: "weekdays", offer: { fr: "nos services", en: "our services" } },
  health: { hours: "weekdays", offer: { fr: "nos soins et les rendez-vous", en: "our care and appointments" } },
  other: { hours: "weekdays", offer: { fr: "nos services", en: "our services" } },
};

const range = (open: string, close: string): TimeRange[] => [{ open, close }];

/** Weekly schedule for a preset; `custom` uses the days and times the owner picked. */
export function weeklyFor(preset: HoursPreset, custom?: { days: Weekday[]; open: string; close: string }): WeeklySchedule {
  const make = (days: readonly Weekday[], open: string, close: string) =>
    Object.fromEntries(WEEKDAYS.map((d) => [d, days.includes(d) ? range(open, close) : []])) as WeeklySchedule;
  switch (preset) {
    case "weekdays":
      return make(["mon", "tue", "wed", "thu", "fri"], "09:00", "17:00");
    case "monSat":
      return make(["mon", "tue", "wed", "thu", "fri", "sat"], "09:00", "18:00");
    case "daily":
      return make(WEEKDAYS, "11:00", "23:00");
    case "custom":
      return make(custom?.days ?? [], custom?.open ?? "09:00", custom?.close ?? "17:00");
  }
}

const DAY_NAMES: Record<"fr" | "en", Record<Weekday, string>> = {
  fr: { mon: "lundi", tue: "mardi", wed: "mercredi", thu: "jeudi", fri: "vendredi", sat: "samedi", sun: "dimanche" },
  en: { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" },
};

/** "09:00" → "9 h" / "9 h 30" (fr), "9:00" (en). */
export function formatTime(hhmm: string, lang: "fr" | "en"): string {
  const [h = "0", m = "00"] = hhmm.split(":");
  const hour = String(Number(h));
  if (lang === "fr") return m === "00" ? `${hour} h` : `${hour} h ${m}`;
  return `${hour}:${m}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Human text of a weekly schedule: « Lundi au vendredi : 9 h à 17 h. Samedi et dimanche : fermé. » */
export function hoursText(weekly: WeeklySchedule, lang: "fr" | "en"): string {
  const key = (d: Weekday) => weekly[d].map((r) => `${r.open}-${r.close}`).join(",");
  const groups: Array<{ days: Weekday[]; ranges: TimeRange[] }> = [];
  for (const d of WEEKDAYS) {
    const last = groups[groups.length - 1];
    if (last && key(last.days[0]!) === key(d)) last.days.push(d);
    else groups.push({ days: [d], ranges: weekly[d] });
  }
  const names = DAY_NAMES[lang];
  const span = (days: Weekday[]) => {
    const first = names[days[0]!];
    const last = names[days[days.length - 1]!];
    if (days.length === 1) return first;
    if (days.length === 2) return lang === "fr" ? `${first} et ${last}` : `${first} and ${last}`;
    return lang === "fr" ? `${first} au ${last}` : `${first} to ${last}`;
  };
  return groups
    .map((g) => {
      const when = g.ranges.length
        ? g.ranges.map((r) => (lang === "fr" ? `${formatTime(r.open, "fr")} à ${formatTime(r.close, "fr")}` : `${formatTime(r.open, "en")} to ${formatTime(r.close, "en")}`)).join(", ")
        : lang === "fr"
          ? "fermé"
          : "closed";
      return `${cap(span(g.days))}${lang === "fr" ? " : " : ": "}${when}.`;
    })
    .join(" ");
}

/** The generated greeting of the main menu, French first. 1 = the team, 2 = AI receptionist, 0 = message. */
export function greetingFor(name: string, type: BusinessType, ai: boolean): BilingualText {
  const n = name.trim() || "notre entreprise";
  const ne = name.trim() || "our business";
  const offer = TYPE_PRESETS[type].offer;
  const reach =
    type === "restaurant"
      ? { fr: "Pour une commande ou une réservation, faites le 1.", en: "To order or book a table, press 1." }
      : type === "health"
        ? { fr: "Pour prendre rendez-vous ou joindre l'équipe, faites le 1.", en: "To book an appointment or reach the team, press 1." }
        : { fr: "Pour joindre notre équipe, faites le 1.", en: "To reach our team, press 1." };
  const aiLine = ai
    ? {
        fr: ` Pour notre réceptionniste virtuelle, qui répond sur nos heures, ${offer.fr} et nos prix, faites le 2.`,
        en: ` For our virtual receptionist, who answers about our hours, ${offer.en} and prices, press 2.`,
      }
    : { fr: "", en: "" };
  return {
    fr: `Bonjour et bienvenue chez ${n}. ${reach.fr}${aiLine.fr} Pour laisser un message, faites le 0.`,
    en: `Hello and welcome to ${ne}. ${reach.en}${aiLine.en} To leave a message, press 0.`,
  };
}

/** FAQ given to the AI receptionist (markdown), from the short facts typed in the wizard. */
export function faqFor(facts: { offer: string; prices: string }, lang: "fr" | "en" = "fr"): string {
  const parts: string[] = [];
  if (facts.offer.trim()) parts.push(`## ${lang === "fr" ? "Ce que nous offrons" : "What we offer"}\n${facts.offer.trim()}`);
  if (facts.prices.trim()) parts.push(`## ${lang === "fr" ? "Prix" : "Prices"}\n${facts.prices.trim()}`);
  return parts.join("\n\n");
}

export interface SetupInput {
  name: string;
  type: BusinessType;
  locale: "fr-CA" | "en-CA";
  ownerUserId: string;
  ownerName: string;
  weekly: WeeklySchedule;
  quebecHolidays: boolean;
  greeting: BilingualText;
  ai: null | { address: string; offer: string; prices: string; english: boolean };
  /** E.164 the account already holds, or null (added later from Numéros). */
  mainNumber: string | null;
}

export type SetupStep = "business" | "extension" | "ai" | "menu" | "hours" | "number";
export const SETUP_STEPS: readonly SetupStep[] = ["business", "extension", "ai", "menu", "hours", "number"];

/** What the run produced so far: a retry resumes after the last finished step. */
export interface SetupProgress {
  businessId?: string;
  extensionId?: string;
  /** true when the AI receptionist is on (terms accepted); false when skipped or not available. */
  aiOn?: boolean;
  menuId?: string;
  hoursDone?: boolean;
  numberDone?: boolean;
  /** Set when the AI step failed but the rest went on (the AI page can finish it). */
  aiFailed?: boolean;
}

/** The subset of the API client the setup uses (real client or a test double). */
export interface SetupApi {
  createBusiness(body: { name: string; locale?: "fr-CA" | "en-CA" }): Promise<{ business: { id: string } }>;
  createExtension(id: string, body: { number: string; displayName: string; userId?: string | null; voicemail?: { enabled: boolean; greeting: BilingualText | null } }): Promise<{ id: string }>;
  putAiReceptionist(id: string, body: Record<string, unknown>): Promise<{ enabled: boolean }>;
  createIvrMenu(id: string, body: IvrMenuRequest): Promise<{ id: string }>;
  putHours(id: string, body: BusinessHoursRequest): Promise<unknown>;
  updateBusiness(id: string, body: { mainNumber?: string | null }): Promise<unknown>;
  putDid(id: string, body: { e164: string; target: RouteTarget }): Promise<unknown>;
}

/** Main menu request: 1 → owner's extension, 2 → AI receptionist (when on), 0 and no key → voicemail. */
export function mainMenuRequest(input: Pick<SetupInput, "greeting">, extensionId: string, aiOn: boolean): IvrMenuRequest {
  const options: IvrOption[] = [{ digit: "1", target: { type: "extension", extensionId } }];
  if (aiOn) options.push({ digit: "2", target: { type: "ai_receptionist" } });
  options.push({ digit: "0", target: { type: "voicemail" } });
  return {
    name: "Accueil principal",
    greeting: { fr: input.greeting.fr.trim(), en: input.greeting.en.trim() },
    options,
    timeoutS: 6,
    maxRetries: 1,
    timeoutTarget: { type: "voicemail" },
    invalidTarget: null,
  };
}

/**
 * Runs the setup in order. `progress` is updated in place after each step so a retry after an error
 * goes on from there (no second business, no duplicate extension). The AI step never blocks the
 * rest: if it fails, the menu and hours are built without it and `aiFailed` is set.
 */
export async function runSetup(api: SetupApi, input: SetupInput, progress: SetupProgress, onStep: (s: SetupStep) => void = () => {}): Promise<SetupProgress> {
  onStep("business");
  if (!progress.businessId) progress.businessId = (await api.createBusiness({ name: input.name.trim(), locale: input.locale })).business.id;
  const id = progress.businessId;

  onStep("extension");
  if (!progress.extensionId) {
    const ext = await api.createExtension(id, {
      number: "101",
      displayName: (input.ownerName.trim() || input.name.trim()).slice(0, 80),
      userId: input.ownerUserId,
      voicemail: { enabled: true, greeting: null },
    });
    progress.extensionId = ext.id;
  }

  onStep("ai");
  if (progress.aiOn === undefined) {
    if (!input.ai) progress.aiOn = false;
    else {
      try {
        const saved = await api.putAiReceptionist(id, {
          accept: true,
          enabled: true,
          businessName: input.name.trim(),
          hoursText: `${hoursText(input.weekly, "fr")}${input.quebecHolidays ? " Fermé les jours fériés du Québec." : ""}`,
          address: input.ai.address.trim() || null,
          faqMarkdown: faqFor(input.ai),
          languages: input.ai.english ? ["fr-CA", "en-CA"] : ["fr-CA"],
          transferTargets: [{ key: "equipe", label: "Équipe", extension: progress.extensionId }],
        });
        progress.aiOn = saved.enabled;
      } catch {
        progress.aiOn = false;
        progress.aiFailed = true;
      }
    }
  }

  onStep("menu");
  if (!progress.menuId) progress.menuId = (await api.createIvrMenu(id, mainMenuRequest(input, progress.extensionId, progress.aiOn))).id;

  onStep("hours");
  if (!progress.hoursDone) {
    await api.putHours(id, {
      weekly: input.weekly,
      holidays: [],
      quebecHolidays: input.quebecHolidays,
      openTarget: { type: "ivr", ivrMenuId: progress.menuId },
      // After hours: the AI receptionist answers when on, else the general voicemail box.
      closedTarget: progress.aiOn ? { type: "ai_receptionist" } : { type: "voicemail" },
    });
    progress.hoursDone = true;
  }

  onStep("number");
  if (!progress.numberDone && input.mainNumber) {
    await api.updateBusiness(id, { mainNumber: input.mainNumber });
    await api.putDid(id, { e164: input.mainNumber, target: { type: "schedule" } });
  }
  progress.numberDone = true;
  return progress;
}
