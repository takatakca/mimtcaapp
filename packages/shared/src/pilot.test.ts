import { describe, expect, it } from "vitest";
import { findNanpNumber, parsePilotCommand, pilotDialAllowed, PILOT_MUTATING, PILOT_TOOLS } from "./pilot.js";

const first = (text: string) => parsePilotCommand(text).calls[0];

describe("findNanpNumber", () => {
  it("reads the usual ways of writing a Canada/US number", () => {
    for (const s of ["514 555-0123", "(514) 555 0123", "+1 514 555 0123", "1-514-555-0123", "5145550123", "514.555.0123"]) {
      expect(findNanpNumber(`appelle le ${s} stp`), s).toBe("+15145550123");
    }
    expect(findNanpNumber("vers 514…")).toBeNull();
  });
});

describe("parsePilotCommand (French)", () => {
  it("forwarding: always, on no answer, off", () => {
    expect(first("Renvoie mes appels vers le 514 555-0123")).toEqual({ tool: "set_forwarding", args: { mode: "always", target: "+15145550123" } });
    expect(first("transfère mes appels au 438 555 0199 si je ne réponds pas")).toEqual({ tool: "set_forwarding", args: { mode: "no_answer", target: "+14385550199" } });
    expect(first("désactive le renvoi d'appels")).toEqual({ tool: "set_forwarding", args: { mode: "off" } });
    expect(first("renvoyer les appels vers 514…")).toEqual({ tool: "set_forwarding", args: { mode: "always" } });
  });

  it("read-only questions", () => {
    expect(first("Montre-moi mes appels manqués")).toEqual({ tool: "search_calls", args: { filter: "missed" } });
    expect(first("Combien de minutes il me reste?")).toEqual({ tool: "usage_summary", args: {} });
    expect(first("Ouvre le message vocal de Julie")).toEqual({ tool: "open_voicemail", args: { from: "Julie" } });
    expect(first("où en sont mes missions")).toEqual({ tool: "missions_status", args: {} });
    expect(first("ouvre la conversation avec @julie.t")).toEqual({ tool: "open_conversation", args: { peer: "@julie.t" } });
  });

  it("texts, calls, blocks, handle, meeting, greeting, do not disturb", () => {
    expect(first("Écris au 514 555 0123 : j'arrive dans 10 minutes")).toEqual({ tool: "send_text", args: { to: "+15145550123", body: "j'arrive dans 10 minutes" } });
    expect(first("envoie un texto au 514-555-0123 pour lui dire que je suis en retard")).toEqual({ tool: "send_text", args: { to: "+15145550123", body: "je suis en retard" } });
    expect(first("Appelle le 418 555 0100")).toEqual({ tool: "call_number", args: { number: "+14185550100" } });
    expect(first("bloque le 514 555 0177")).toEqual({ tool: "block_number", args: { number: "+15145550177" } });
    expect(first("débloque le 514 555 0177")).toEqual({ tool: "unblock_number", args: { number: "+15145550177" } });
    expect(first("choisis l'identifiant @marie.lune")).toEqual({ tool: "set_handle", args: { handle: "marie.lune" } });
    expect(first("démarre une réunion sur le budget")).toEqual({ tool: "start_meeting", args: { title: "le budget" } });
    expect(first("remets mon message d'accueil par défaut")).toEqual({ tool: "set_voicemail_greeting", args: { mode: "default" } });
    expect(first("je veux enregistrer un nouveau message d'accueil")).toEqual({ tool: "set_voicemail_greeting", args: { mode: "record_by_phone" } });
    expect(first("active ne pas déranger")).toEqual({ tool: "set_dnd", args: { enabled: true } });
    expect(first("désactive le mode ne pas déranger")).toEqual({ tool: "set_dnd", args: { enabled: false } });
  });

  it("business hours and greeting", () => {
    expect(first("heures d'ouverture de 9 h à 17 h du lundi au vendredi")).toEqual({ tool: "set_business_hours", args: { days: ["mon", "tue", "wed", "thu", "fri"], open: "09:00", close: "17:00" } });
    expect(first("heures d'ouverture de 8h30 à 16 h du mardi au samedi")).toEqual({ tool: "set_business_hours", args: { days: ["tue", "wed", "thu", "fri", "sat"], open: "08:30", close: "16:00" } });
    expect(first("change l'accueil de l'entreprise : Bienvenue chez Comète")).toEqual({ tool: "set_business_greeting", args: { text: "Bienvenue chez Comète" } });
  });

  it("navigation", () => {
    expect(first("va dans mes paramètres d'appel")).toEqual({ tool: "navigate", args: { page: "call_settings" } });
    expect(first("ouvre la messagerie")).toEqual({ tool: "open_voicemail", args: {} });
    expect(first("réunions")).toEqual({ tool: "navigate", args: { page: "meetings" } });
  });

  it("refuses what the Pilote never does", () => {
    expect(parsePilotCommand("supprime mon compte").refusal).toBe("account_deletion");
    expect(parsePilotCommand("change mon adresse 9-1-1").refusal).toBe("e911");
    expect(parsePilotCommand("passe au forfait Affaires").refusal).toBe("plan_change");
    expect(parsePilotCommand("paie ma facture").refusal).toBe("payments");
    expect(parsePilotCommand("appelle le 911").refusal).toBe("emergency_call");
    expect(parsePilotCommand("supprime mon compte").calls).toEqual([]);
  });

  it("recognises nothing in noise", () => {
    expect(parsePilotCommand("bonjour la météo est belle aujourd'hui")).toEqual({ calls: [], refusal: null });
    expect(parsePilotCommand("   ")).toEqual({ calls: [], refusal: null });
  });
});

describe("parsePilotCommand (English)", () => {
  it("common commands", () => {
    expect(first("forward my calls to 514-555-0123 when I don't answer")).toEqual({ tool: "set_forwarding", args: { mode: "no_answer", target: "+15145550123" } });
    expect(first("show my missed calls")).toEqual({ tool: "search_calls", args: { filter: "missed" } });
    expect(first("how many minutes do I have left")).toEqual({ tool: "usage_summary", args: {} });
    expect(first("text 514 555 0123 saying I'm running late")).toEqual({ tool: "send_text", args: { to: "+15145550123", body: "I'm running late" } });
    expect(first("block 514 555 0177")).toEqual({ tool: "block_number", args: { number: "+15145550177" } });
    expect(first("start a meeting")).toEqual({ tool: "start_meeting", args: {} });
    expect(first("business hours 9am to 5pm weekdays")).toEqual({ tool: "set_business_hours", args: { days: ["mon", "tue", "wed", "thu", "fri"], open: "09:00", close: "17:00" } });
    expect(parsePilotCommand("delete my account").refusal).toBe("account_deletion");
  });
});

describe("tool list", () => {
  it("every mutating tool is a known tool and read-only tools stay read-only", () => {
    for (const t of PILOT_MUTATING) expect(PILOT_TOOLS).toContain(t);
    for (const t of ["navigate", "search_calls", "usage_summary", "missions_status", "open_voicemail", "open_conversation"] as const) expect(PILOT_MUTATING.has(t)).toBe(false);
    expect(pilotDialAllowed("911")).toBe(false);
    expect(pilotDialAllowed("+15145550123")).toBe(true);
  });
});
