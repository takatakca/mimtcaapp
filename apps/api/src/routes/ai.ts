// AI (Claude) REST routes. Contract: packages/shared/src/ai.ts; spec: docs/MIMT-AI.md.
// Order of checks on every route that sends data to the AI provider:
//   503 not_configured (no ANTHROPIC_API_KEY) → 403 ai_consent_required (Law 25) → 429 ai_budget_exhausted.
// Nothing reaches the provider unless all three pass.

import type { FastifyInstance } from "fastify";
import {
  type HelpChatRequest,
  type HelpChatResponse,
  AI_CONSENT_KIND,
  AI_LIMITS,
  AI_RECEPTIONIST_TERMS_VERSION,
  type AiReceptionistConfigDto,
  type AiStatusResponse,
  type ReplySuggestionsResponse,
} from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser } from "../auth/guard.js";
import { aiBudget, hasAiConsent, recordAiUsage, requireAi, type AiServices } from "../ai/service.js";
import { helpKnowledge } from "../ai/helpKnowledge.js";

/** In-app help assistant fair use, per account (every plan). */
const HELP_QUESTIONS_PER_MONTH = 30;
import type { ReceptionistConfig } from "../ai/store.js";
import { badRequest, conflict, forbidden, HttpError, notConfigured } from "../lib/errors.js";
import { E164 } from "../lib/phone.js";
import { parse } from "../lib/validate.js";
import { businessAccess } from "../pbx/access.js";
import { externalAllowed } from "../pbx/router.js";
import type { BusinessRow } from "../repo/pbxTypes.js";
import { getFeatures } from "../services/accounts.js";

export const consentRequired = () => new HttpError(403, "ai_consent_required", `Le consentement « ${AI_CONSENT_KIND} » est requis.`);
export const budgetExhausted = () => new HttpError(429, "ai_budget_exhausted", "Le budget IA de ce mois est épuisé.");

const LANGS = ["fr-CA", "en-CA", "en-US"] as const;
const TransferTarget = z.object({
  key: z.string().trim().regex(/^[a-z0-9_-]{1,32}$/, "lowercase key"),
  label: z.string().trim().min(1).max(80),
  number: z.string().regex(E164).optional(),
  extension: z.uuid().optional(),
});
const ReceptionistBody = z.object({
  enabled: z.boolean().optional(),
  businessName: z.string().trim().min(1).max(120).optional(),
  greeting: z.string().trim().max(300).nullable().optional(),
  faqMarkdown: z.string().max(8000).optional(),
  hoursText: z.string().max(1000).optional(),
  address: z.string().trim().max(300).nullable().optional(),
  // French first: fr-CA is always offered (Charter of the French language).
  languages: z.array(z.enum(LANGS)).min(1).max(3).refine((l) => l.includes("fr-CA"), "fr-CA is required").optional(),
  transferTargets: z
    .array(TransferTarget)
    .max(10)
    .refine((t) => new Set(t.map((x) => x.key)).size === t.length, "each key once")
    .optional(),
  accept: z.boolean().optional(),
});

export function receptionistDto(business: BusinessRow, c: ReceptionistConfig | null): AiReceptionistConfigDto {
  return {
    businessId: business.id,
    enabled: c?.enabled ?? false,
    businessName: c?.businessName ?? business.name,
    greeting: c?.greeting ?? null,
    faqMarkdown: c?.faqMarkdown ?? "",
    hoursText: c?.hoursText ?? "",
    address: c?.address ?? null,
    languages: c?.languages ?? ["fr-CA"],
    transferTargets: c?.transferTargets ?? [],
    acceptedAt: c?.acceptedAt?.toISOString() ?? null,
    acceptedVersion: c?.acceptedVersion ?? null,
    updatedAt: c?.updatedAt.toISOString() ?? null,
  };
}

/** The receptionist may answer: enabled, current terms accepted. */
export const receptionistReady = (c: ReceptionistConfig | null): c is ReceptionistConfig =>
  Boolean(c?.enabled && c.acceptedAt && c.acceptedVersion === AI_RECEPTIONIST_TERMS_VERSION);

export async function aiRoutes(app: FastifyInstance, deps: AppDeps) {
  const { repo } = deps;
  const auth = { preHandler: requireUser(deps) };

  /** The store works without a key (config, labels); deps.ai is absent only in bare test setups. */
  const store = (): AiServices => {
    if (!deps.ai) throw notConfigured("AI");
    return deps.ai;
  };

  app.get("/v1/ai/status", auth, async (req): Promise<AiStatusResponse> => {
    const { user, account } = await loadContext(deps, req);
    const consent = await hasAiConsent(repo, user.id);
    const ai = deps.ai;
    if (!ai) {
      const { plan } = await getFeatures(repo, account.id);
      return { configured: false, consent, plan, monthlyBudgetCadCents: 0, usedCadCents: 0, period: deps.now().toISOString().slice(0, 7) };
    }
    const b = await aiBudget(deps, ai, account.id);
    return { configured: Boolean(ai.gateway), consent, plan: b.plan, monthlyBudgetCadCents: b.budgetCadCents, usedCadCents: b.usedCadCents, period: b.period };
  });

  // In-app help assistant: MIMT facts only (ai/helpKnowledge.ts), no account data is sent, same consent and budget
  // as every AI feature. Rate limited per user.
  app.post("/v1/ai/help", { ...auth, config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req): Promise<HelpChatResponse> => {
    const body = parse(
      z.object({
        messages: z
          .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(1500) }))
          .min(1)
          .max(12)
          .refine((m) => m[m.length - 1]!.role === "user", "The last turn must be the user's question"),
      }),
      req.body,
    ) satisfies HelpChatRequest;
    const { user, account } = await loadContext(deps, req);
    const { ai, gateway } = requireAi(deps);
    if (!(await hasAiConsent(repo, user.id))) throw consentRequired();
    // Customer help is for every plan (Gratuit included), so it has its own fair-use quota instead of the plan's
    // AI budget: HELP_QUESTIONS_PER_MONTH per account over a rolling 30 days.
    if (!(await deps.rateLimiter.take(`ai:help:${account.id}`, { capacity: HELP_QUESTIONS_PER_MONTH, windowSeconds: 30 * 86_400 }))) {
      throw new HttpError(429, "help_quota_reached", user.locale === "fr-CA" ? "Vous avez posé beaucoup de questions ce mois-ci. Écrivez-nous à info@mimt.ca." : "You asked many questions this month. Please write to info@mimt.ca.");
    }
    const out = await gateway.helpAnswer({ locale: user.locale, knowledge: helpKnowledge(deps.config.plans, user.locale), messages: body.messages });
    await recordAiUsage(deps, ai, account.id, "help_assistant", out.usage);
    const fr = user.locale === "fr-CA";
    if (!out.ok) {
      return { answer: fr ? "Je ne peux pas répondre à cette question. Écrivez-nous à info@mimt.ca." : "I can't answer that. Please write to info@mimt.ca.", needsHuman: true };
    }
    return { answer: out.value.answer.slice(0, 1200), needsHuman: out.value.needsHuman };
  });

  // Smart replies: never sent automatically; the user picks and edits.
  app.get("/v1/conversations/:peer/suggestions", auth, async (req): Promise<ReplySuggestionsResponse> => {
    const { peer } = parse(z.object({ peer: z.string().regex(E164) }), req.params);
    const { user, account } = await loadContext(deps, req);
    const { ai, gateway } = requireAi(deps);
    if (!(await hasAiConsent(repo, user.id))) throw consentRequired();
    if (!(await aiBudget(deps, ai, account.id)).available) throw budgetExhausted();

    const rows = await repo.listMessages(account.id, peer, { limit: AI_LIMITS.suggestionsContextMessages });
    if (rows.length === 0) return { suggestions: [], language: user.locale };
    const messages = rows.reverse().map((m) => ({ direction: m.direction, text: deps.cipher.decrypt(m.bodyEncrypted) }));
    const out = await gateway.suggestReplies({ locale: user.locale, messages });
    await recordAiUsage(deps, ai, account.id, "sms_suggestions", out.usage);
    if (!out.ok) return { suggestions: [], language: user.locale, reason: out.reason === "refusal" ? "refused" : "unavailable" };
    return { suggestions: out.value.suggestions.map((s) => s.slice(0, 320)).slice(0, 3), language: out.value.language || user.locale };
  });

  // ------------------------------------------------------------------------ AI receptionist config

  app.get("/v1/business/:id/ai-receptionist", auth, async (req): Promise<AiReceptionistConfigDto> => {
    const ctx = await businessAccess(deps, req, "admin");
    return receptionistDto(ctx.business, await store().store.getReceptionistConfig(ctx.business.id));
  });

  app.put("/v1/business/:id/ai-receptionist", auth, async (req): Promise<AiReceptionistConfigDto> => {
    const ctx = await businessAccess(deps, req, "admin");
    const body = parse(ReceptionistBody, req.body);
    const ai = store();
    const { features } = await getFeatures(repo, ctx.business.telecomAccountId);
    if (!features.has("ai_assist") || !features.has("auto_attendant")) throw forbidden("plan_required", "A business plan is required");
    // Only the owner accepts the terms (AI disclosure, transcripts sent to the AI provider).
    if (body.accept && ctx.member.role !== "owner") throw forbidden("business_role_required", "Requires the owner role");

    for (const t of body.transferTargets ?? []) {
      if (!t.number && !t.extension) throw badRequest("invalid_target", `Transfer target ${t.key} needs a number or an extension`);
      if (t.number && !externalAllowed(t.number)) throw badRequest("external_number_not_allowed", "Only Canada/US non-premium numbers can be transferred to");
      if (t.extension) {
        const [ext, group] = await Promise.all([repo.pbx.getExtension(t.extension), repo.pbx.getRingGroup(t.extension)]);
        if (ext?.businessId !== ctx.business.id && group?.businessId !== ctx.business.id) throw badRequest("invalid_target", `Unknown extension for ${t.key}`);
      }
    }

    const prev = await ai.store.getReceptionistConfig(ctx.business.id);
    const cur = receptionistDto(ctx.business, prev);
    const accepted = body.accept
      ? { acceptedAt: deps.now(), acceptedByUserId: ctx.user.id, acceptedVersion: AI_RECEPTIONIST_TERMS_VERSION }
      : { acceptedAt: prev?.acceptedAt ?? null, acceptedByUserId: prev?.acceptedByUserId ?? null, acceptedVersion: prev?.acceptedVersion ?? null };
    const enabled = body.enabled ?? cur.enabled;
    if (enabled && accepted.acceptedVersion !== AI_RECEPTIONIST_TERMS_VERSION) {
      throw conflict("terms_not_accepted", "Le propriétaire doit accepter les conditions de la réceptionniste IA.");
    }
    const saved = await ai.store.upsertReceptionistConfig({
      businessId: ctx.business.id,
      telecomAccountId: ctx.business.telecomAccountId,
      enabled,
      businessName: body.businessName ?? cur.businessName,
      greeting: body.greeting !== undefined ? body.greeting || null : cur.greeting,
      faqMarkdown: body.faqMarkdown ?? cur.faqMarkdown,
      hoursText: body.hoursText ?? cur.hoursText,
      address: body.address !== undefined ? body.address || null : cur.address,
      languages: body.languages ?? cur.languages,
      transferTargets: body.transferTargets ?? cur.transferTargets,
      ...accepted,
    });
    await repo.audit({
      actorUserId: ctx.user.id,
      action: body.accept ? "ai.receptionist_terms_accepted" : "ai.receptionist_updated",
      targetType: "business",
      targetId: ctx.business.id,
      ip: req.ip,
      meta: { enabled, version: accepted.acceptedVersion },
    });
    return receptionistDto(ctx.business, saved);
  });
}
