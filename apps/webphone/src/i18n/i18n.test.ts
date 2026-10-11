import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "./en";
import { fr } from "./fr";
import { pickLanguage, translate } from "./core";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/i18n[\\/](fr|en)(\.extra)?\.ts$/.test(p) ? [p] : [];
  });
}

describe("i18n dictionaries", () => {
  it("fr and en have exactly the same keys", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
  });

  it("no empty strings", () => {
    for (const [k, v] of [...Object.entries(fr), ...Object.entries(en)]) expect(v.trim(), k).not.toBe("");
  });

  it("same {placeholders} in both languages", () => {
    for (const key of Object.keys(fr) as (keyof typeof fr)[]) {
      expect(placeholders(en[key]), key).toEqual(placeholders(fr[key]));
    }
  });

  it("every dynamic key built in the code exists (phone.tab.*, phone.error.*)", () => {
    for (const tab of ["keypad", "contacts", "audio"]) expect(fr).toHaveProperty([`phone.tab.${tab}`]);
    for (const code of ["mic_denied", "token", "unavailable", "connection", "failed", "invalid_number"]) {
      expect(fr).toHaveProperty([`phone.error.${code}`]);
    }
  });

  it("every literal key used in src/ exists in fr", () => {
    const keyLike = /["'`]((?:account|address|ai|app|biz|call|calls|common|contacts|day|error|line|messages|nav|notFound|offer|offers|order|orders|otp|phone|port|privacy|rec|settings|signin|spam|tabs|target|validation|voicemail)\.[A-Za-z0-9_.]+)["'`]/g;
    const missing = new Set<string>();
    for (const file of sourceFiles(join(__dirname, ".."))) {
      for (const m of readFileSync(file, "utf8").matchAll(keyLike)) if (!(m[1]! in fr)) missing.add(`${m[1]} (${file})`);
    }
    expect([...missing]).toEqual([]);
  });

  it("uses Quebec French vocabulary and keeps the 9-1-1 texts", () => {
    const all = Object.values(fr).join(" ").toLowerCase();
    expect(all).not.toMatch(/\be-?mail\b|\bvoicemail\b/);
    expect(fr["tabs.voicemail"]).toBe("Messagerie vocale");
    expect(fr["call.emergencyBanner"]).toBe("Appel d'urgence — donnez votre adresse à la téléphoniste");
    expect(fr["call.emergencyHint"]).toMatch(/9-1-1 est toujours permis/);
  });
});

describe("translate and pickLanguage", () => {
  it("fills placeholders and leaves unknown ones", () => {
    expect(translate("fr", "calls.callNumber", { number: "514 555-0123" })).toBe("Appeler le 514 555-0123");
    expect(translate("en", "calls.callNumber", { number: "514 555-0123" })).toBe("Call 514 555-0123");
    expect(translate("fr", "calls.callNumber")).toBe("Appeler le {number}");
  });

  it("defaults to French; English only when the browser asks for it first", () => {
    expect(pickLanguage([])).toBe("fr");
    expect(pickLanguage(["es-MX", "en"])).toBe("fr");
    expect(pickLanguage(["en-CA", "fr"])).toBe("en");
    expect(pickLanguage(["en"], "fr")).toBe("fr");
  });
});
