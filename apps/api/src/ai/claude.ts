import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_LIMITS } from "@mimt/shared";
import { z } from "zod";
import type { AiGateway, AiOutcome, ClassifySmsInput, HelpAnswer, HelpAnswerInput, ReceptionistStepInput, ReceptionistStepResult, ReplySuggestions, SmsClassification, SuggestRepliesInput, TokenUsage, VoicemailSummary, VoicemailSummaryInput } from "./gateway.js";
import { HELP_SYSTEM } from "./helpKnowledge.js";
import { RECEPTIONIST_SYSTEM, RECEPTIONIST_TOOLS, SMS_SPAM_SYSTEM, SUGGESTIONS_SYSTEM, VOICEMAIL_SYSTEM } from "./prompts.js";

type Effort = "low" | "medium";

/**
 * Server-side refusal fallback: on a policy decline the API re-runs the same request on Anthropic's
 * recommended fallback model inside the same call. The "default" form needs this exact header.
 */
const BETAS: Anthropic.Beta.AnthropicBeta[] = ["server-side-fallback-2026-07-01"];

const VoicemailSchema = z.object({
  summary: z.string(),
  callerIntent: z.string(),
  urgency: z.enum(["low", "normal", "high"]),
  callbackSuggested: z.boolean(),
  spamLikelihood: z.number().min(0).max(1),
});

const SuggestionsSchema = z.object({
  language: z.string(),
  suggestions: z.array(z.string()),
});

const HelpSchema = z.object({
  answer: z.string(),
  needsHuman: z.boolean(),
});

const SmsSchema = z.object({
  verdict: z.enum(["spam", "scam", "ok"]),
  reason: z.string(),
});

/** Production AiGateway: the official Anthropic SDK, claude-opus-5-5 by default. */
export class ClaudeGateway implements AiGateway {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic({ apiKey, maxRetries: 2, timeout: 30_000 });
  }

  summarizeVoicemail(input: VoicemailSummaryInput): Promise<AiOutcome<VoicemailSummary>> {
    const user =
      `Target language: ${input.locale}\nCaller number: ${input.callerNumber ?? "unknown"}\n` +
      `<transcript>\n${input.transcript.slice(0, AI_LIMITS.voicemailMaxChars)}\n</transcript>`;
    return this.structured(VoicemailSchema, VOICEMAIL_SYSTEM, user, "medium", 4000);
  }

  async suggestReplies(input: SuggestRepliesInput): Promise<AiOutcome<ReplySuggestions>> {
    const lines = input.messages.map((m) => `${m.direction === "inbound" ? "Them" : "Me"}: ${m.text.replace(/\s+/g, " ").slice(0, 500)}`);
    const user = `User locale: ${input.locale}\n<conversation>\n${lines.join("\n")}\n</conversation>`;
    const out = await this.structured(SuggestionsSchema, SUGGESTIONS_SYSTEM, user, "low", 2000);
    if (!out.ok) return out;
    return { ...out, value: { language: out.value.language, suggestions: out.value.suggestions.map((s) => s.trim()).filter(Boolean).slice(0, 3) } };
  }

  helpAnswer(input: HelpAnswerInput): Promise<AiOutcome<HelpAnswer>> {
    const turns = input.messages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text.replace(/\s+/g, " ").slice(0, 1500)}`);
    const user = `User locale: ${input.locale}\n<facts>\n${input.knowledge}\n</facts>\n<conversation>\n${turns.join("\n")}\n</conversation>`;
    return this.structured(HelpSchema, HELP_SYSTEM, user, "low", 1500);
  }

  classifySms(input: ClassifySmsInput): Promise<AiOutcome<SmsClassification>> {
    const user = `Sender known to the user: ${input.knownSender ? "yes" : "no"}\n<sms>\n${input.text.slice(0, 1600)}\n</sms>`;
    return this.structured(SmsSchema, SMS_SPAM_SYSTEM, user, "low", 1500);
  }

  /**
   * One streamed round trip. The caller owns the loop (tools, interruptions, limits); this only
   * streams text deltas and returns the final message content to append verbatim.
   */
  async receptionistStep(input: ReceptionistStepInput, onText: (delta: string) => void): Promise<ReceptionistStepResult> {
    const stream = this.client.beta.messages.stream(
      {
        model: this.model,
        max_tokens: input.maxTokens,
        betas: BETAS,
        fallbacks: "default",
        output_config: { effort: "medium" },
        tools: RECEPTIONIST_TOOLS,
        system: [
          { type: "text", text: RECEPTIONIST_SYSTEM, cache_control: { type: "ephemeral" } },
          { type: "text", text: input.businessContext, cache_control: { type: "ephemeral" } },
        ],
        // Automatic breakpoint on the growing conversation tail.
        cache_control: { type: "ephemeral" },
        messages: input.messages,
      },
      input.signal ? { signal: input.signal } : undefined,
    );
    stream.on("text", (delta) => onText(delta));
    const message = await stream.finalMessage();
    return {
      stopReason: message.stop_reason,
      refusalCategory: message.stop_details?.category ?? null,
      content: message.content,
      usage: usageOf(message),
    };
  }

  private async structured<T>(schema: z.ZodType<T>, system: string, user: string, effort: Effort, maxTokens: number): Promise<AiOutcome<T>> {
    const message = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: maxTokens,
      betas: BETAS,
      fallbacks: "default",
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      output_config: { effort, format: betaZodOutputFormat(schema) },
      messages: [{ role: "user", content: user }],
    });
    const usage = usageOf(message);
    // Refusal first: content may be empty or partial and will not match the schema.
    if (message.stop_reason === "refusal") return { ok: false, reason: "refusal", usage, refusalCategory: message.stop_details?.category ?? null };
    if (message.stop_reason === "max_tokens") return { ok: false, reason: "max_tokens", usage };
    const parsed = message.parsed_output as T | null | undefined;
    if (parsed === null || parsed === undefined) return { ok: false, reason: "invalid_output", usage };
    return { ok: true, value: parsed, usage };
  }
}

/** Token usage across every attempt (usage.iterations covers a server-side fallback; top-level usage only the last one). */
export function usageOf(message: Pick<Anthropic.Beta.Messages.BetaMessage, "model" | "usage">): TokenUsage {
  const u = message.usage;
  const iterations = (u.iterations ?? []) as unknown as Array<Record<string, unknown>>;
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  if (iterations.length > 0) {
    return iterations.reduce<TokenUsage>(
      (acc, it) => ({
        model: acc.model,
        inputTokens: acc.inputTokens + num(it.input_tokens),
        outputTokens: acc.outputTokens + num(it.output_tokens),
        cacheReadTokens: acc.cacheReadTokens + num(it.cache_read_input_tokens),
        cacheWriteTokens: acc.cacheWriteTokens + num(it.cache_creation_input_tokens),
      }),
      { model: message.model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    );
  }
  return {
    model: message.model,
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}
