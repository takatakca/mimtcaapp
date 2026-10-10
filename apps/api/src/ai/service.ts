import { AI_CONSENT_KIND, AI_MONTHLY_BUDGET_CAD_CENTS, AI_PRICING_USD_PER_MTOK, type AiFeature, type PlanCode } from "@mimt/shared";
import type { Config } from "../config.js";
import type { AppDeps } from "../deps.js";
import { notConfigured } from "../lib/errors.js";
import { monthPeriod } from "../lib/time.js";
import type { Repository } from "../repo/types.js";
import { getPlan } from "../services/accounts.js";
import { ClaudeGateway } from "./claude.js";
import type { AiGateway, TokenUsage } from "./gateway.js";
import { MemoryAiStore, PostgresAiStore, type AiStore } from "./store.js";

/** Everything AI. `gateway` is null when ANTHROPIC_API_KEY is unset: AI features answer 503, the rest works. */
export interface AiServices {
  gateway: AiGateway | null;
  store: AiStore;
  model: string;
  /** Runs AI work off the webhook's request path; failures are logged, never thrown. */
  background(label: string, work: () => Promise<unknown>): void;
  /** Resolves once all background work has settled (tests, graceful shutdown). */
  idle(): Promise<void>;
}

export function createAiServices(opts: {
  config: Config;
  gateway?: AiGateway | null;
  store?: AiStore;
  /** Postgres pool to share (PostgresRepository.sql). */
  sql?: ConstructorParameters<typeof PostgresAiStore>[0];
  log?: { error: (obj: object, msg: string) => void };
}): AiServices {
  const { config } = opts;
  const gateway =
    opts.gateway !== undefined ? opts.gateway : config.ANTHROPIC_API_KEY ? new ClaudeGateway(config.ANTHROPIC_API_KEY, config.ANTHROPIC_MODEL) : null;
  const store = opts.store ?? (opts.sql ? new PostgresAiStore(opts.sql) : new MemoryAiStore());
  const pending = new Set<Promise<unknown>>();
  return {
    gateway,
    store,
    model: config.ANTHROPIC_MODEL,
    background(label, work) {
      const p = work()
        .catch((err: unknown) => opts.log?.error({ err, label }, "AI background task failed"))
        .finally(() => pending.delete(p));
      pending.add(p);
    },
    async idle() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
  };
}

export function requireAi(deps: AppDeps): { ai: AiServices; gateway: AiGateway } {
  const ai = deps.ai;
  if (!ai?.gateway) throw notConfigured("AI");
  return { ai, gateway: ai.gateway };
}

/** Latest "ai_processing" consent of the user is a grant (Law 25: specific, separate consent). */
export async function hasAiConsent(repo: Repository, userId: string): Promise<boolean> {
  const consents = await repo.listConsents(userId);
  let latest: { granted: boolean; at: Date } | null = null;
  for (const c of consents) {
    if ((c.kind as string) !== AI_CONSENT_KIND) continue;
    if (!latest || c.at.getTime() >= latest.at.getTime()) latest = c;
  }
  return latest?.granted ?? false;
}

/** Estimated cost of one call in millionths of a CAD dollar (list prices of the default model). */
export function costMicroCad(u: TokenUsage, usdToCad: number): number {
  const p = AI_PRICING_USD_PER_MTOK;
  const microUsd = u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite;
  return microUsd * usdToCad;
}

export interface AiBudget {
  plan: PlanCode;
  period: string;
  budgetCadCents: number;
  usedCadCents: number;
  /** false when the monthly AI budget is used up (or the plan has none). */
  available: boolean;
}

export async function aiBudget(deps: AppDeps, ai: AiServices, accountId: string): Promise<AiBudget> {
  const period = monthPeriod(deps.now());
  const [plan, usedMicro] = await Promise.all([getPlan(deps.repo, accountId), ai.store.getMonthlyCostMicroCad(accountId, period)]);
  const budgetCadCents = AI_MONTHLY_BUDGET_CAD_CENTS[plan];
  const usedCadCents = usedMicro / 10_000;
  return { plan, period, budgetCadCents, usedCadCents: Math.round(usedCadCents * 100) / 100, available: usedCadCents < budgetCadCents };
}

export async function recordAiUsage(deps: AppDeps, ai: AiServices, accountId: string, feature: AiFeature, usage: TokenUsage): Promise<void> {
  await ai.store.addUsage({
    telecomAccountId: accountId,
    period: monthPeriod(deps.now()),
    feature,
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    costMicroCad: costMicroCad(usage, deps.config.USD_TO_CAD),
  });
}
