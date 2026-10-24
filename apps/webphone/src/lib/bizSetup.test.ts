import { describe, expect, it } from "vitest";
import {
  faqFor,
  formatTime,
  greetingFor,
  hoursText,
  mainMenuRequest,
  needsBusinessSetup,
  runSetup,
  weeklyFor,
  type SetupApi,
  type SetupInput,
  type SetupProgress,
} from "./bizSetup";

describe("hour presets", () => {
  it("builds the four presets", () => {
    expect(weeklyFor("weekdays").mon).toEqual([{ open: "09:00", close: "17:00" }]);
    expect(weeklyFor("weekdays").sat).toEqual([]);
    expect(weeklyFor("monSat").sat).toEqual([{ open: "09:00", close: "18:00" }]);
    expect(weeklyFor("monSat").sun).toEqual([]);
    expect(weeklyFor("daily").sun).toEqual([{ open: "11:00", close: "23:00" }]);
    const custom = weeklyFor("custom", { days: ["tue", "sat"], open: "08:30", close: "12:00" });
    expect(custom.tue).toEqual([{ open: "08:30", close: "12:00" }]);
    expect(custom.mon).toEqual([]);
  });

  it("says the hours in French and in English, days grouped", () => {
    expect(formatTime("09:00", "fr")).toBe("9 h");
    expect(formatTime("08:30", "fr")).toBe("8 h 30");
    expect(hoursText(weeklyFor("weekdays"), "fr")).toBe("Lundi au vendredi : 9 h à 17 h. Samedi et dimanche : fermé.");
    expect(hoursText(weeklyFor("daily"), "en")).toBe("Monday to Sunday: 11:00 to 23:00.");
    expect(hoursText(weeklyFor("monSat"), "fr")).toBe("Lundi au samedi : 9 h à 18 h. Dimanche : fermé.");
  });
});

describe("generated greeting", () => {
  it("is bilingual, French first, with the business name and the keys", () => {
    const g = greetingFor("Casse-croûte Comète", "restaurant", true);
    expect(g.fr).toMatch(/^Bonjour et bienvenue chez Casse-croûte Comète\./);
    expect(g.fr).toMatch(/commande ou une réservation, faites le 1/);
    expect(g.fr).toMatch(/réceptionniste virtuelle.*notre menu.*faites le 2/);
    expect(g.fr).toMatch(/message, faites le 0\.$/);
    expect(g.en).toMatch(/^Hello and welcome to Casse-croûte Comète\./);
    expect(g.en).toMatch(/press 2/);
  });

  it("leaves out key 2 without the AI receptionist", () => {
    const g = greetingFor("Clinique Aurore", "health", false);
    expect(g.fr).not.toMatch(/faites le 2/);
    expect(g.en).not.toMatch(/press 2/);
    expect(g.fr).toMatch(/rendez-vous/);
  });

  it("main menu: 1 → owner, 2 → AI when on, 0 and no key → voicemail; never an outside number", () => {
    const m = mainMenuRequest({ greeting: { fr: " Bonjour ", en: " Hello " } }, "ext-1", true);
    expect(m.greeting).toEqual({ fr: "Bonjour", en: "Hello" });
    expect(m.options).toEqual([
      { digit: "1", target: { type: "extension", extensionId: "ext-1" } },
      { digit: "2", target: { type: "ai_receptionist" } },
      { digit: "0", target: { type: "voicemail" } },
    ]);
    expect(m.timeoutTarget).toEqual({ type: "voicemail" });
    expect(mainMenuRequest({ greeting: { fr: "a", en: "b" } }, "ext-1", false).options.map((o) => o.digit)).toEqual(["1", "0"]);
  });

  it("FAQ for the AI receptionist keeps only what was typed", () => {
    expect(faqFor({ offer: "Poutines", prices: "" })).toBe("## Ce que nous offrons\nPoutines");
    expect(faqFor({ offer: "", prices: "" })).toBe("");
  });
});

describe("needsBusinessSetup", () => {
  const me = (plan: string) => ({ account: { plan } }) as never;
  it("only for a business plan with no business", () => {
    expect(needsBusinessSetup(me("business"), [])).toBe(true);
    expect(needsBusinessSetup(me("business_pro"), [])).toBe(true);
    expect(needsBusinessSetup(me("premium"), [])).toBe(false);
    expect(needsBusinessSetup(me("business"), [{} as never])).toBe(false);
    expect(needsBusinessSetup(null, [])).toBe(false);
  });
});

function fakeApi(fail: Partial<Record<keyof SetupApi, number>> = {}) {
  const calls: string[] = [];
  const bodies: Record<string, unknown> = {};
  const left = { ...fail };
  const step =
    <T,>(name: keyof SetupApi, out: T) =>
    async (...args: unknown[]): Promise<T> => {
      calls.push(name);
      bodies[name] = args[args.length - 1];
      if (left[name]) {
        left[name]!--;
        throw new Error(`${name} failed`);
      }
      return out;
    };
  const api: SetupApi = {
    createBusiness: step("createBusiness", { business: { id: "biz-1" } }),
    createExtension: step("createExtension", { id: "ext-1" }),
    putAiReceptionist: step("putAiReceptionist", { enabled: true }),
    createIvrMenu: step("createIvrMenu", { id: "ivr-1" }),
    putHours: step("putHours", {}),
    updateBusiness: step("updateBusiness", {}),
    putDid: step("putDid", {}),
  };
  return { api, calls, bodies };
}

const input = (over: Partial<SetupInput> = {}): SetupInput => ({
  name: "Casse-croûte Comète",
  type: "restaurant",
  locale: "fr-CA",
  ownerUserId: "user-1",
  ownerName: "Camille",
  weekly: weeklyFor("daily"),
  quebecHolidays: true,
  greeting: greetingFor("Casse-croûte Comète", "restaurant", true),
  ai: { address: "12, rue Principale", offer: "Poutines", prices: "", english: true },
  mainNumber: "+15145550100",
  ...over,
});

describe("runSetup", () => {
  it("creates everything in order and routes the main number by schedule", async () => {
    const { api, calls, bodies } = fakeApi();
    const steps: string[] = [];
    const out = await runSetup(api, input(), {}, (s) => steps.push(s));
    expect(calls).toEqual(["createBusiness", "createExtension", "putAiReceptionist", "createIvrMenu", "putHours", "updateBusiness", "putDid"]);
    expect(steps).toEqual(["business", "extension", "ai", "menu", "hours", "number"]);
    expect(out).toMatchObject({ businessId: "biz-1", extensionId: "ext-1", aiOn: true, menuId: "ivr-1", hoursDone: true, numberDone: true });
    expect(bodies.createExtension).toMatchObject({ number: "101", userId: "user-1", voicemail: { enabled: true, greeting: null } });
    expect(bodies.putAiReceptionist).toMatchObject({ accept: true, enabled: true, languages: ["fr-CA", "en-CA"], address: "12, rue Principale" });
    expect((bodies.putAiReceptionist as { hoursText: string }).hoursText).toMatch(/Fermé les jours fériés du Québec/);
    expect(bodies.putHours).toMatchObject({ quebecHolidays: true, openTarget: { type: "ivr", ivrMenuId: "ivr-1" }, closedTarget: { type: "ai_receptionist" } });
    expect(bodies.updateBusiness).toEqual({ mainNumber: "+15145550100" });
    expect(bodies.putDid).toEqual({ e164: "+15145550100", target: { type: "schedule" } });
  });

  it("resumes after a failure without a second business or extension", async () => {
    const { api, calls } = fakeApi({ putHours: 1 });
    const progress: SetupProgress = {};
    await expect(runSetup(api, input(), progress)).rejects.toThrow("putHours failed");
    expect(progress).toMatchObject({ businessId: "biz-1", extensionId: "ext-1", menuId: "ivr-1" });
    calls.length = 0;
    await runSetup(api, input(), progress);
    expect(calls).toEqual(["putHours", "updateBusiness", "putDid"]);
  });

  it("goes on without the AI receptionist when it fails, and closes to voicemail", async () => {
    const { api, bodies } = fakeApi({ putAiReceptionist: 1 });
    const out = await runSetup(api, input(), {});
    expect(out).toMatchObject({ aiOn: false, aiFailed: true });
    expect((bodies.createIvrMenu as { options: Array<{ digit: string }> }).options.map((o) => o.digit)).toEqual(["1", "0"]);
    expect(bodies.putHours).toMatchObject({ closedTarget: { type: "voicemail" } });
  });

  it("skips the AI and the number when there are none", async () => {
    const { api, calls } = fakeApi();
    await runSetup(api, input({ ai: null, mainNumber: null }), {});
    expect(calls).toEqual(["createBusiness", "createExtension", "createIvrMenu", "putHours"]);
  });
});
