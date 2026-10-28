// « Pilote MIMT » (AI command bar): POST /v1/ai/command, /v1/ai/command/confirm, /v1/ai/command/cancel.
// Spec: docs/MIMT-PILOTE.md. Contract: packages/shared/src/pilot.ts.
//
// Safety model, in order:
//   1. The never-list (payments, plan changes, account deletion, 9-1-1 address, emergency calls) is refused by the
//      local parser BEFORE any model call.
//   2. Claude is used only when AI_COMMANDS=on, ANTHROPIC_API_KEY is set, the user gave the ai_processing consent and
//      the monthly AI budget allows it. Otherwise the local French/English parser plans the command (no AI cost).
//      Only the command text and non-personal context (plan, page) go to the model; no message or voicemail content.
//   3. Every proposal (model or parser) is validated: tool whitelist, strict argument schemas, plan features, owner role.
//   4. Read-only tools run at once. Mutating tools wait for POST /confirm with the plan id (single use, bound to the
//      user, PILOT_PLAN_TTL_S), are re-validated, then run through the existing routes with the user's own token.
//   5. Each command and each executed action is audited (tool names and outcome only, never text or numbers).
import type { FastifyInstance } from "fastify";
import { parsePilotCommand, PILOT_MAX_COMMAND_CHARS, type PilotCommandResponse, type PilotConfirmResponse, type PilotNavigate, type PilotStep } from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser } from "../auth/guard.js";
import { aiBudget, hasAiConsent, recordAiUsage } from "../ai/service.js";
import { injector, runConfirmed, runReadOnly, type CallResult } from "../ai/pilot/execute.js";
import { actionView, loadPilotContext, PilotPlanStore, refusalSteps, validateCall, validateCalls, type PilotContext } from "../ai/pilot/plan.js";
import { HttpError, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { planOf } from "../plansConfig.js";

/** Per-user command quota (on top of the per-IP route limit). */
export const PILOT_RULE = { capacity: 40, windowSeconds: 600 };

const CommandBody = z.object({ text: z.string().trim().min(1).max(PILOT_MAX_COMMAND_CHARS), page: z.string().max(120).optional() }).strict();
const PlanBody = z.object({ planId: z.uuid() }).strict();

const tr = (ctx: Pick<PilotContext, "fr">, fr: string, en: string) => (ctx.fr ? fr : en);

type Engine = { use: "ai" } | { use: "rules"; why: PilotStep };

async function pickEngine(deps: AppDeps, ctx: PilotContext): Promise<Engine> {
  const info = (fr: string, en: string): Engine => ({ use: "rules", why: { kind: "info", text: tr(ctx, `Mode local : ${fr}`, `Local mode: ${en}`) } });
  if (deps.config.AI_COMMANDS === "rules") return info("analyse sans IA", "parsing without AI");
  const ai = deps.ai;
  if (!ai?.gateway?.planCommand) return info("IA non configurée", "AI not configured");
  if (!(await hasAiConsent(deps.repo, ctx.user.id))) return info("consentement IA non donné", "no AI consent");
  if (!(await aiBudget(deps, ai, ctx.account.id)).available) return info("budget IA du mois atteint", "monthly AI budget reached");
  return { use: "ai" };
}

export async function aiPilotRoutes(app: FastifyInstance, deps: AppDeps) {
  const auth = { preHandler: requireUser(deps) };
  const plans = new PilotPlanStore();

  app.post("/v1/ai/command", { ...auth, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req): Promise<PilotCommandResponse> => {
    const body = parse(CommandBody, req.body);
    if (deps.config.AI_COMMANDS === "off") throw new HttpError(503, "pilot_disabled", "Le Pilote MIMT est désactivé.");
    const { user, account } = await loadContext(deps, req);
    if (!(await deps.rateLimiter.take(`ai:pilot:${user.id}`, PILOT_RULE))) throw new HttpError(429, "rate_limited", "Trop de commandes. Réessayez dans quelques minutes.");
    const ctx = await loadPilotContext(deps, user, account);
    const local = parsePilotCommand(body.text);
    const audit = (meta: Record<string, unknown>) =>
      deps.repo.audit({ actorUserId: user.id, action: "ai.pilot_command", targetType: "telecom_account", targetId: account.id, ip: req.ip, meta });

    // 1. Never-list: refused before any model call.
    if (local.refusal) {
      await audit({ source: "rules", refusal: local.refusal, tools: [] });
      return { planId: null, expiresAt: null, source: "rules", understood: true, steps: refusalSteps(ctx, local.refusal), pending: [], navigate: null };
    }

    // 2. Engine.
    const steps: PilotStep[] = [];
    let source: "ai" | "rules" = "rules";
    let proposals: Array<{ name: string; input: unknown }> = local.calls.map((c) => ({ name: c.tool, input: c.args }));
    const engine = await pickEngine(deps, ctx);
    if (engine.use === "ai") {
      const ai = deps.ai!;
      const out = await ai.gateway!.planCommand!({
        locale: user.locale,
        text: body.text,
        context: [
          `Plan: ${planOf(ctx.plan).name.en}`,
          `Has a MIMT phone number: ${ctx.numbers.length > 0 ? "yes" : "no"}`,
          `Owns a MIMT Business: ${ctx.businesses.some((b) => b.role === "owner") ? "yes" : "no"}`,
          `Current page: ${body.page ? body.page.replace(/[^\w/-]/g, "").slice(0, 60) : "unknown"}`,
        ].join("\n"),
      });
      await recordAiUsage(deps, ai, account.id, "pilot_command", out.usage);
      if (out.ok && out.value.calls.length > 0) {
        source = "ai";
        proposals = out.value.calls;
        steps.push({ kind: "info", text: tr(ctx, "Moteur : Claude (IA)", "Engine: Claude (AI)") });
      } else {
        steps.push({ kind: "info", text: tr(ctx, "Mode local : l'IA n'a rien proposé", "Local mode: the AI proposed nothing") });
      }
    } else {
      steps.push(engine.why);
    }

    if (proposals.length === 0) {
      await audit({ source, tools: [], understood: false });
      return {
        planId: null,
        expiresAt: null,
        source,
        understood: false,
        steps: [
          ...steps,
          {
            kind: "info",
            text: tr(
              ctx,
              "Je n'ai pas compris. Essayez : « appels manqués », « minutes restantes », « renvoie mes appels vers 514 555-0123 », « bloque le … ».",
              "I didn't get that. Try: “missed calls”, “minutes left”, “forward my calls to 514 555-0123”, “block …”.",
            ),
          },
        ],
        pending: [],
        navigate: null,
      };
    }

    // 3. Validation.
    const draft = await validateCalls(ctx, proposals);
    steps.push(...draft.steps);

    // 4. Read-only now; mutating later.
    const inject = injector(app, req);
    let navigate: PilotNavigate | null = null;
    for (const call of draft.calls.filter((c) => !c.mutating)) {
      const r = await runReadOnly(ctx, call, inject);
      steps.push(...r.steps);
      if (r.navigate) navigate = r.navigate;
    }
    const mutating = draft.calls.filter((c) => c.mutating);
    let planId: string | null = null;
    let expiresAt: string | null = null;
    if (mutating.length > 0) {
      const plan = plans.put(user.id, mutating.map((c) => ({ tool: c.tool, args: c.args })), source, deps.now());
      planId = plan.id;
      expiresAt = plan.expiresAt.toISOString();
      steps.push({ kind: "info", text: tr(ctx, "En attente de votre confirmation", "Waiting for your confirmation") });
    }
    await audit({ source, tools: draft.calls.map((c) => c.tool), pending: mutating.length, rejected: proposals.length - draft.calls.length });
    return { planId, expiresAt, source, understood: true, steps, pending: mutating.map(actionView), navigate };
  });

  app.post("/v1/ai/command/confirm", { ...auth, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req): Promise<PilotConfirmResponse> => {
    const { planId } = parse(PlanBody, req.body);
    if (deps.config.AI_COMMANDS === "off") throw new HttpError(503, "pilot_disabled", "Le Pilote MIMT est désactivé.");
    const { user, account } = await loadContext(deps, req);
    const plan = plans.take(planId, user.id, deps.now());
    if (!plan) throw notFound("plan_not_found", "Commande inconnue ou déjà utilisée.");
    if (plan === "expired") throw new HttpError(410, "plan_expired", "Commande expirée : redemandez-la.");

    // Re-validate with fresh context (plan, role, handle may have changed since the command).
    const ctx = await loadPilotContext(deps, user, account);
    const inject = injector(app, req);
    const steps: PilotStep[] = [];
    const results: PilotConfirmResponse["results"] = [];
    let navigate: PilotNavigate | null = null;
    let clientAction: PilotConfirmResponse["clientAction"] = null;
    for (const stored of plan.calls) {
      const v = await validateCall(ctx, stored.tool, stored.args);
      let r: CallResult;
      if (!v.call || !v.call.mutating) {
        r = { tool: stored.tool, ok: false, code: "revalidation_failed", steps: v.steps.filter((s) => s.ok === false), navigate: null };
      } else {
        steps.push({ kind: "action", text: tr(ctx, `Exécution : ${v.call.summary}`, `Running: ${v.call.summary}`) });
        r = await runConfirmed(ctx, v.call, inject);
      }
      steps.push(...r.steps);
      results.push({ tool: r.tool, ok: r.ok, ...(r.code ? { code: r.code } : {}) });
      await deps.repo.audit({
        actorUserId: user.id,
        action: "ai.pilot_executed",
        targetType: "telecom_account",
        targetId: account.id,
        ip: req.ip,
        meta: { planId: plan.id, source: plan.source, tool: r.tool, ok: r.ok, ...(r.code ? { code: r.code } : {}) },
      });
      if (r.navigate) navigate = r.navigate;
      if (r.clientAction) clientAction = r.clientAction;
      // Stop at the first failure: later steps may depend on it.
      if (!r.ok) break;
    }
    return { steps, results, navigate, clientAction };
  });

  app.post("/v1/ai/command/cancel", auth, async (req, reply) => {
    const { planId } = parse(PlanBody, req.body);
    const { user } = await loadContext(deps, req);
    plans.take(planId, user.id, deps.now());
    return reply.code(204).send();
  });
}
