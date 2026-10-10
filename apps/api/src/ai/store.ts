import { randomUUID } from "node:crypto";
import type { AiFeature, AiTransferTarget, Locale, SpamVerdict, VoicemailInsight } from "@mimt/shared";
import type postgres from "postgres";

// AI data lives in its own store (tables from supabase/migrations/0004_ai.sql) so the core Repository
// stays untouched. MemoryAiStore backs tests and local runs without a database.

export type SpamTarget = "call" | "message";
export type SpamSource = "heuristic" | "ai";

export interface SpamScore {
  telecomAccountId: string;
  targetType: SpamTarget;
  /** Call SID for calls, message id for messages. */
  targetRef: string;
  verdict: SpamVerdict;
  /** 0 to 1. */
  score: number;
  reason: string;
  source: SpamSource;
}

export interface AiUsageRow {
  telecomAccountId: string;
  /** "YYYY-MM" (UTC). */
  period: string;
  feature: AiFeature;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Estimated cost in millionths of a CAD dollar. */
  costMicroCad: number;
}

export interface ReceptionistConfig {
  businessId: string;
  telecomAccountId: string;
  enabled: boolean;
  businessName: string;
  greeting: string | null;
  faqMarkdown: string;
  hoursText: string;
  address: string | null;
  languages: string[];
  transferTargets: AiTransferTarget[];
  acceptedAt: Date | null;
  acceptedByUserId: string | null;
  acceptedVersion: string | null;
  updatedAt: Date;
}

export interface ReceptionistMessage {
  id: string;
  businessId: string;
  telecomAccountId: string;
  callSid: string | null;
  callerNumber: string | null;
  name: string;
  callbackNumber: string;
  reason: string;
  createdAt: Date;
}

export interface AiStore {
  setVoicemailInsight(voicemailId: string, insight: VoicemailInsight, model: string): Promise<void>;
  getVoicemailInsights(voicemailIds: string[]): Promise<Map<string, VoicemailInsight>>;

  /** Upsert on (targetType, targetRef): an AI verdict replaces the heuristic one. */
  setSpamScore(s: SpamScore): Promise<void>;
  getSpamScores(targetType: SpamTarget, refs: string[]): Promise<Map<string, SpamScore>>;

  addUsage(row: AiUsageRow): Promise<void>;
  getMonthlyCostMicroCad(accountId: string, period: string): Promise<number>;

  getReceptionistConfig(businessId: string): Promise<ReceptionistConfig | null>;
  upsertReceptionistConfig(c: Omit<ReceptionistConfig, "updatedAt">): Promise<ReceptionistConfig>;
  createReceptionistMessage(m: Omit<ReceptionistMessage, "id" | "createdAt">): Promise<ReceptionistMessage>;
  listReceptionistMessages(businessId: string, limit: number): Promise<ReceptionistMessage[]>;
}

export class MemoryAiStore implements AiStore {
  insights = new Map<string, VoicemailInsight & { model: string }>();
  spam = new Map<string, SpamScore>();
  usage: AiUsageRow[] = [];
  configs = new Map<string, ReceptionistConfig>();
  messages: ReceptionistMessage[] = [];

  async setVoicemailInsight(voicemailId: string, insight: VoicemailInsight, model: string) {
    this.insights.set(voicemailId, { ...insight, model });
  }
  async getVoicemailInsights(ids: string[]) {
    const out = new Map<string, VoicemailInsight>();
    for (const id of ids) {
      const v = this.insights.get(id);
      if (v) {
        const { model: _model, ...insight } = v;
        out.set(id, insight);
      }
    }
    return out;
  }
  async setSpamScore(s: SpamScore) {
    this.spam.set(`${s.targetType}:${s.targetRef}`, { ...s });
  }
  async getSpamScores(targetType: SpamTarget, refs: string[]) {
    const out = new Map<string, SpamScore>();
    for (const r of refs) {
      const s = this.spam.get(`${targetType}:${r}`);
      if (s) out.set(r, { ...s });
    }
    return out;
  }
  async addUsage(row: AiUsageRow) {
    this.usage.push({ ...row });
  }
  async getMonthlyCostMicroCad(accountId: string, period: string) {
    return this.usage.filter((u) => u.telecomAccountId === accountId && u.period === period).reduce((n, u) => n + u.costMicroCad, 0);
  }
  async getReceptionistConfig(businessId: string) {
    const c = this.configs.get(businessId);
    return c ? structuredClone(c) : null;
  }
  async upsertReceptionistConfig(c: Omit<ReceptionistConfig, "updatedAt">) {
    const row: ReceptionistConfig = { ...structuredClone(c), updatedAt: new Date() };
    this.configs.set(c.businessId, row);
    return structuredClone(row);
  }
  async createReceptionistMessage(m: Omit<ReceptionistMessage, "id" | "createdAt">) {
    const row: ReceptionistMessage = { ...m, id: randomUUID(), createdAt: new Date() };
    this.messages.push(row);
    return { ...row };
  }
  async listReceptionistMessages(businessId: string, limit: number) {
    return this.messages
      .filter((m) => m.businessId === businessId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((m) => ({ ...m }));
  }
}

type Sql = postgres.Sql<{}>;
type Row = Record<string, any>;

/** Postgres implementation. Expects the camelCase transform used by PostgresRepository (shares its pool). */
export class PostgresAiStore implements AiStore {
  constructor(private readonly sql: Sql) {}

  async setVoicemailInsight(voicemailId: string, i: VoicemailInsight, model: string) {
    await this.sql`
      update voicemails set
        ai_summary = ${i.summary}, ai_locale = ${i.locale}, ai_caller_intent = ${i.callerIntent}, ai_urgency = ${i.urgency},
        ai_callback_suggested = ${i.callbackSuggested}, ai_spam_likelihood = ${i.spamLikelihood}, ai_model = ${model}, ai_processed_at = now()
      where id = ${voicemailId}`;
  }
  async getVoicemailInsights(ids: string[]) {
    const out = new Map<string, VoicemailInsight>();
    if (ids.length === 0) return out;
    const rows = (await this.sql`
      select id, ai_summary, ai_locale, ai_caller_intent, ai_urgency, ai_callback_suggested, ai_spam_likelihood::float8 as ai_spam_likelihood
      from voicemails where id in ${this.sql(ids)} and ai_summary is not null`) as Row[];
    for (const r of rows) {
      out.set(r.id, {
        summary: r.aiSummary,
        locale: r.aiLocale as Locale,
        callerIntent: r.aiCallerIntent,
        urgency: r.aiUrgency,
        callbackSuggested: r.aiCallbackSuggested,
        spamLikelihood: Number(r.aiSpamLikelihood),
      });
    }
    return out;
  }
  async setSpamScore(s: SpamScore) {
    await this.sql`
      insert into spam_scores (telecom_account_id, target_type, target_ref, verdict, score, reason, source)
      values (${s.telecomAccountId}, ${s.targetType}, ${s.targetRef}, ${s.verdict}, ${s.score}, ${s.reason}, ${s.source})
      on conflict (target_type, target_ref) do update set
        verdict = excluded.verdict, score = excluded.score, reason = excluded.reason, source = excluded.source, updated_at = now()`;
  }
  async getSpamScores(targetType: SpamTarget, refs: string[]) {
    const out = new Map<string, SpamScore>();
    if (refs.length === 0) return out;
    const rows = (await this.sql`
      select telecom_account_id, target_type, target_ref, verdict, score::float8 as score, reason, source
      from spam_scores where target_type = ${targetType} and target_ref in ${this.sql(refs)}`) as Row[];
    for (const r of rows) out.set(r.targetRef, { ...(r as SpamScore), score: Number(r.score) });
    return out;
  }
  async addUsage(u: AiUsageRow) {
    await this.sql`
      insert into ai_usage (telecom_account_id, period, feature, model, requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_cad)
      values (${u.telecomAccountId}, ${u.period}, ${u.feature}, ${u.model}, 1, ${u.inputTokens}, ${u.outputTokens}, ${u.cacheReadTokens}, ${u.cacheWriteTokens}, ${Math.round(u.costMicroCad)})
      on conflict (telecom_account_id, period, feature, model) do update set
        requests = ai_usage.requests + 1,
        input_tokens = ai_usage.input_tokens + excluded.input_tokens,
        output_tokens = ai_usage.output_tokens + excluded.output_tokens,
        cache_read_tokens = ai_usage.cache_read_tokens + excluded.cache_read_tokens,
        cache_write_tokens = ai_usage.cache_write_tokens + excluded.cache_write_tokens,
        cost_micro_cad = ai_usage.cost_micro_cad + excluded.cost_micro_cad,
        updated_at = now()`;
  }
  async getMonthlyCostMicroCad(accountId: string, period: string) {
    const [row] = (await this.sql`
      select coalesce(sum(cost_micro_cad), 0)::float8 as total from ai_usage where telecom_account_id = ${accountId} and period = ${period}`) as Row[];
    return Number(row?.total ?? 0);
  }
  async getReceptionistConfig(businessId: string) {
    const [row] = (await this.sql`select * from ai_receptionist_configs where business_id = ${businessId}`) as Row[];
    return row ? toConfig(row) : null;
  }
  async upsertReceptionistConfig(c: Omit<ReceptionistConfig, "updatedAt">) {
    const [row] = (await this.sql`
      insert into ai_receptionist_configs (
        business_id, telecom_account_id, enabled, business_name, greeting, faq_markdown, hours_text, address, languages,
        transfer_targets, accepted_at, accepted_by_user_id, accepted_version)
      values (
        ${c.businessId}, ${c.telecomAccountId}, ${c.enabled}, ${c.businessName}, ${c.greeting}, ${c.faqMarkdown}, ${c.hoursText}, ${c.address},
        ${this.sql.array(c.languages)}, ${this.sql.json(c.transferTargets as unknown as postgres.JSONValue)}, ${c.acceptedAt}, ${c.acceptedByUserId}, ${c.acceptedVersion})
      on conflict (business_id) do update set
        telecom_account_id = excluded.telecom_account_id, enabled = excluded.enabled, business_name = excluded.business_name,
        greeting = excluded.greeting, faq_markdown = excluded.faq_markdown, hours_text = excluded.hours_text, address = excluded.address,
        languages = excluded.languages, transfer_targets = excluded.transfer_targets, accepted_at = excluded.accepted_at,
        accepted_by_user_id = excluded.accepted_by_user_id, accepted_version = excluded.accepted_version, updated_at = now()
      returning *`) as Row[];
    return toConfig(row!);
  }
  async createReceptionistMessage(m: Omit<ReceptionistMessage, "id" | "createdAt">) {
    const [row] = (await this.sql`
      insert into ai_receptionist_messages (business_id, telecom_account_id, call_sid, caller_number, name, callback_number, reason)
      values (${m.businessId}, ${m.telecomAccountId}, ${m.callSid}, ${m.callerNumber}, ${m.name}, ${m.callbackNumber}, ${m.reason})
      returning *`) as Row[];
    return row as ReceptionistMessage;
  }
  async listReceptionistMessages(businessId: string, limit: number) {
    return (await this.sql`
      select * from ai_receptionist_messages where business_id = ${businessId} order by created_at desc limit ${limit}`) as unknown as ReceptionistMessage[];
  }
}

function toConfig(r: Row): ReceptionistConfig {
  return {
    businessId: r.businessId,
    telecomAccountId: r.telecomAccountId,
    enabled: r.enabled,
    businessName: r.businessName,
    greeting: r.greeting,
    faqMarkdown: r.faqMarkdown,
    hoursText: r.hoursText,
    address: r.address,
    languages: r.languages ?? ["fr-CA"],
    transferTargets: (r.transferTargets ?? []) as AiTransferTarget[],
    acceptedAt: r.acceptedAt,
    acceptedByUserId: r.acceptedByUserId,
    acceptedVersion: r.acceptedVersion,
    updatedAt: r.updatedAt,
  };
}
