// « Pilote MIMT » (POST /v1/ai/command + /confirm): local parser, plan validation, TTL and single use, permission
// refusals, audit. The AI path uses a fake gateway: no test calls the real Anthropic API.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PILOT_PLAN_TTL_S, type PilotCommandResponse, type PilotConfirmResponse } from "@mimt/shared";
import type { AiGateway, PilotPlanInput, TokenUsage } from "../src/ai/gateway.js";
import { createAiServices } from "../src/ai/service.js";
import { makeUser, setup, type Ctx } from "./helpers.js";
import { makeBusiness, subscribe } from "./pbxFixtures.js";

let now = new Date("2026-10-28T14:00:00Z");
let ctx: Ctx;

beforeEach(async () => {
  now = new Date("2026-10-28T14:00:00Z");
  ctx = await setup({ now: () => now });
});
afterEach(() => ctx.app.close());

const usage = (): TokenUsage => ({ model: "claude-opus-5-5", inputTokens: 300, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 });

async function command(auth: Record<string, string>, text: string) {
  const res = await ctx.app.inject({ method: "POST", url: "/v1/ai/command", headers: auth, payload: { text } });
  return { status: res.statusCode, body: res.json() as PilotCommandResponse & { error?: string } };
}
async function confirm(auth: Record<string, string>, planId: string) {
  const res = await ctx.app.inject({ method: "POST", url: "/v1/ai/command/confirm", headers: auth, payload: { planId } });
  return { status: res.statusCode, body: res.json() as PilotConfirmResponse & { error?: string } };
}
async function premium() {
  const u = await makeUser(ctx, { number: "+15145550100", e911: true, ack: true });
  await subscribe(ctx, u.account.id, "premium", 1);
  return u;
}
const pilotAudits = () => ctx.repo.auditLog.filter((a) => a.action.startsWith("ai.pilot"));

describe("local parser path (no AI configured)", () => {
  it("forwarding: plan, checks, confirmation, execution through PATCH /v1/me, highlight", async () => {
    const u = await premium();
    const { status, body } = await command(u.auth, "Renvoie mes appels vers le 438 555-0199");
    expect(status).toBe(200);
    expect(body.source).toBe("rules");
    expect(body.planId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.pending).toEqual([expect.objectContaining({ tool: "set_forwarding", mutating: true })]);
    const texts = body.steps.map((s) => s.text);
    expect(texts).toEqual(expect.arrayContaining(["Mode local : IA non configurée", "Vérification : forfait Premium ✓", "En attente de votre confirmation"]));
    expect(texts.some((t) => t.startsWith("Compréhension : renvoyer les appels vers 438"))).toBe(true);
    expect(texts.some((t) => t.startsWith("Action proposée : activer le renvoi"))).toBe(true);
    // Nothing changed before confirmation.
    expect((await ctx.repo.callControls.getCallSettings(u.account.id)).forwarding.mode).toBe("off");

    const done = await confirm(u.auth, body.planId!);
    expect(done.status).toBe(200);
    expect(done.body.results).toEqual([{ tool: "set_forwarding", ok: true }]);
    expect(done.body.navigate).toEqual({ page: "call_settings", highlight: "forwarding" });
    const settings = await ctx.repo.callControls.getCallSettings(u.account.id);
    expect(settings.forwarding).toMatchObject({ mode: "always", target: "+14385550199" });
    // The route audited its own change, and the Pilote audited the action (no numbers or text in meta).
    expect(ctx.repo.auditLog.some((a) => a.action === "call_settings.updated")).toBe(true);
    const exec = pilotAudits().find((a) => a.action === "ai.pilot_executed")!;
    expect(exec.meta).toMatchObject({ tool: "set_forwarding", ok: true, source: "rules" });
    expect(JSON.stringify(pilotAudits())).not.toContain("5550199");
  });

  it("read-only commands run at once and navigate (missed calls, usage)", async () => {
    const u = await premium();
    const missed = await command(u.auth, "montre-moi mes appels manqués");
    expect(missed.body.planId).toBeNull();
    expect(missed.body.pending).toEqual([]);
    expect(missed.body.navigate).toMatchObject({ page: "calls", query: { filtre: "missed" } });
    expect(missed.body.steps.some((s) => s.kind === "result" && s.text === "Résultat : aucun appel trouvé")).toBe(true);

    const left = await command(u.auth, "combien de minutes il me reste?");
    expect(left.body.steps.find((s) => s.kind === "result")!.text).toMatch(/^Résultat : Premium — \d+ min sortantes restantes/);
    expect(left.body.navigate).toEqual({ page: "account", highlight: "usage" });
  });

  it("send_text: confirmed text goes through POST /v1/messages from the user's number", async () => {
    const u = await premium();
    const { body } = await command(u.auth, "écris au 418 555 0123 : j'arrive dans 10 minutes");
    expect(body.pending[0]).toMatchObject({ tool: "send_text", summary: "envoyer à 418 555-0123 : « j'arrive dans 10 minutes »" });
    const done = await confirm(u.auth, body.planId!);
    expect(done.body.results).toEqual([{ tool: "send_text", ok: true }]);
    expect(ctx.twilio!.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ to: "+14185550123", from: "+15145550100", body: "j'arrive dans 10 minutes" }));
    // Message content is never in the audit trail.
    expect(JSON.stringify(ctx.repo.auditLog)).not.toContain("10 minutes");
  });

  it("call_number returns a client dial after confirmation; the server places no call", async () => {
    const u = await premium();
    const { body } = await command(u.auth, "appelle le 514 555 0177");
    const done = await confirm(u.auth, body.planId!);
    expect(done.body.clientAction).toEqual({ type: "dial", number: "+15145550177" });
  });

  it("block then unblock", async () => {
    const u = await premium();
    const b = await command(u.auth, "bloque le 514 555 0177");
    expect((await confirm(u.auth, b.body.planId!)).body.results[0]!.ok).toBe(true);
    expect((await ctx.repo.callControls.listBlocks(u.account.id)).map((x) => x.e164)).toEqual(["+15145550177"]);
    const un = await command(u.auth, "débloque le 514 555 0177");
    expect((await confirm(u.auth, un.body.planId!)).body.results[0]!.ok).toBe(true);
    expect(await ctx.repo.callControls.listBlocks(u.account.id)).toEqual([]);
  });

  it("says when it does not understand", async () => {
    const u = await premium();
    const { body } = await command(u.auth, "quelle belle journée");
    expect(body.understood).toBe(false);
    expect(body.planId).toBeNull();
  });
});

describe("refusals", () => {
  it("never-list: payments, plan change, account deletion, 9-1-1 address, emergency call", async () => {
    const u = await premium();
    for (const text of ["supprime mon compte", "paie ma facture", "passe au forfait Affaires", "change mon adresse 9-1-1", "appelle le 911"]) {
      const { body } = await command(u.auth, text);
      expect(body.planId, text).toBeNull();
      expect(body.steps[0]!.kind, text).toBe("refuse");
    }
    expect(pilotAudits().every((a) => a.meta?.refusal)).toBe(true);
  });

  it("plan gating: forwarding is refused on a plan without call_forwarding", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    const { body } = await command(u.auth, "renvoie mes appels vers 438 555 0199");
    expect(body.planId).toBeNull();
    expect(body.steps.some((s) => s.ok === false && s.text.startsWith("Vérification : pas inclus dans le forfait"))).toBe(true);
  });

  it("business hours: owner only; the owner's change goes through PUT /v1/business/:id/hours", async () => {
    const biz = await makeBusiness(ctx);
    const staff = await command(biz.staff.auth, "heures d'ouverture de 8 h à 16 h du lundi au vendredi");
    expect(staff.body.planId).toBeNull();
    expect(staff.body.steps.some((s) => s.ok === false && s.text.includes("réservé au propriétaire"))).toBe(true);

    const owner = await command(biz.owner.auth, "heures d'ouverture de 8 h à 16 h du lundi au vendredi");
    expect(owner.body.pending[0]).toMatchObject({ tool: "set_business_hours" });
    const done = await confirm(biz.owner.auth, owner.body.planId!);
    expect(done.body.results).toEqual([{ tool: "set_business_hours", ok: true }]);
    const hours = await ctx.repo.pbx.getHours(biz.business.id);
    expect(hours!.weekly.mon).toEqual([{ open: "08:00", close: "16:00" }]);
  });

  it("AI_COMMANDS=off disables the bar", async () => {
    await ctx.app.close();
    ctx = await setup({ now: () => now, config: { AI_COMMANDS: "off" } });
    const u = await makeUser(ctx);
    const { status, body } = await command(u.auth, "appels manqués");
    expect(status).toBe(503);
    expect(body.error).toBe("pilot_disabled");
  });
});

describe("confirmation: TTL, single use, owner of the plan", () => {
  it("expires after PILOT_PLAN_TTL_S, is single use and bound to the user", async () => {
    const u = await premium();
    const other = await makeUser(ctx);
    const first = await command(u.auth, "active ne pas déranger");
    expect((await confirm(other.auth, first.body.planId!)).status).toBe(404);
    // Another user's attempt does not burn the plan: only its owner can take it.
    expect((await confirm(u.auth, first.body.planId!)).status).toBe(200);
    expect((await confirm(u.auth, first.body.planId!)).status).toBe(404);

    const second = await command(u.auth, "désactive ne pas déranger");
    now = new Date(now.getTime() + (PILOT_PLAN_TTL_S + 1) * 1000);
    const late = await confirm(u.auth, second.body.planId!);
    expect(late.status).toBe(410);
    expect(late.body.error).toBe("plan_expired");
    expect((await ctx.repo.callControls.getCallSettings(u.account.id)).dnd.enabled).toBe(true);
  });

  it("re-validates at confirmation (plan lost in between)", async () => {
    const u = await premium();
    const { body } = await command(u.auth, "renvoie mes appels vers 438 555 0199");
    await ctx.repo.upsertSubscription({ telecomAccountId: u.account.id, kind: "plan", code: "premium", quantity: 1, stripeSubscriptionId: `sub_${u.account.id.slice(0, 8)}`, status: "canceled", source: "stripe", currentPeriodEnd: null });
    const done = await confirm(u.auth, body.planId!);
    expect(done.body.results).toEqual([{ tool: "set_forwarding", ok: false, code: "revalidation_failed" }]);
    expect((await ctx.repo.callControls.getCallSettings(u.account.id)).forwarding.mode).toBe("off");
  });

  it("cancel discards the plan", async () => {
    const u = await premium();
    const { body } = await command(u.auth, "active ne pas déranger");
    const res = await ctx.app.inject({ method: "POST", url: "/v1/ai/command/cancel", headers: u.auth, payload: { planId: body.planId } });
    expect(res.statusCode).toBe(204);
    expect((await confirm(u.auth, body.planId!)).status).toBe(404);
  });
});

describe("AI path (fake gateway)", () => {
  function withGateway(planCommand: NonNullable<AiGateway["planCommand"]>) {
    const gateway = { planCommand: vi.fn(planCommand) } as unknown as AiGateway;
    ctx.deps.ai = createAiServices({ config: ctx.deps.config, gateway });
    return gateway.planCommand as ReturnType<typeof vi.fn>;
  }
  async function consent(auth: Record<string, string>) {
    const res = await ctx.app.inject({ method: "POST", url: "/v1/consents", headers: auth, payload: { kind: "ai_processing", granted: true, version: "2026-10" } });
    expect(res.statusCode).toBe(201);
  }

  it("without consent the model is never called (local parser instead)", async () => {
    const spy = withGateway(async () => ({ ok: true, value: { calls: [] }, usage: usage() }));
    const u = await premium();
    const { body } = await command(u.auth, "appels manqués");
    expect(spy).not.toHaveBeenCalled();
    expect(body.steps[0]!.text).toBe("Mode local : consentement IA non donné");
  });

  it("uses Claude's proposals, drops unknown tools and invalid args, records usage, never sends the never-list", async () => {
    const spy = withGateway(async (_input: PilotPlanInput) => ({
      ok: true,
      value: {
        calls: [
          { name: "delete_account", input: {} },
          { name: "set_dnd", input: { enabled: "yes" } },
          { name: "block_number", input: { number: "911" } },
          { name: "set_dnd", input: { enabled: true } },
        ],
      },
      usage: usage(),
    }));
    const u = await premium();
    await consent(u.auth);
    const { body } = await command(u.auth, "mets-moi en mode tranquille et bloque le 911");
    expect(spy).toHaveBeenCalledOnce();
    const input = spy.mock.calls[0]![0] as PilotPlanInput;
    expect(input.text).toBe("mets-moi en mode tranquille et bloque le 911");
    expect(input.context).not.toContain("+1514");
    expect(body.source).toBe("ai");
    expect(body.pending.map((p) => p.tool)).toEqual(["set_dnd"]);
    expect(body.steps.filter((s) => s.ok === false)).toHaveLength(3);
    const used = await ctx.deps.ai!.store.getMonthlyCostMicroCad(u.account.id, "2026-10");
    expect(used).toBeGreaterThan(0);

    const never = await command(u.auth, "supprime mon compte");
    expect(spy).toHaveBeenCalledOnce();
    expect(never.body.steps[0]!.kind).toBe("refuse");
  });

  it("falls back to the local parser when the model proposes nothing", async () => {
    withGateway(async () => ({ ok: false, reason: "refusal", usage: usage() }));
    const u = await premium();
    await consent(u.auth);
    const { body } = await command(u.auth, "appels manqués");
    expect(body.source).toBe("rules");
    expect(body.navigate).toMatchObject({ page: "calls" });
  });
});
