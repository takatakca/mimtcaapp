import type { FastifyInstance, FastifyRequest } from "fastify";
import { AI_DEMO_LIMITS, AI_DEMO_SCENARIOS, type AiDemoResponse } from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { DEMO_SYSTEM } from "../ai/demo.js";
import { HttpError, notConfigured } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import type { RateRule } from "../fraud/rateLimiter.js";
import { holdIpHash } from "./numberPicker.js";

/**
 * Public AI phone demo for mimt.ca (no sign-in). The browser does speech-to-text and text-to-speech; this route
 * only runs one AI turn on the transcript it receives. Nothing is stored or logged except token counts.
 *
 * Cost limits: per-IP turns per hour and calls per day, plus a global daily turn cap (AI_DEMO_DAILY_TURNS);
 * AI_DEMO=off switches it off.
 */

const TURNS_PER_IP_HOUR: RateRule = { capacity: 60, windowSeconds: 3600 };
const CALLS_PER_IP_DAY: RateRule = { capacity: 12, windowSeconds: 86_400 };

const Body = z.object({
  scenario: z.enum(AI_DEMO_SCENARIOS as [string, ...string[]]),
  locale: z.enum(["fr-CA", "en-CA"]).default("fr-CA"),
  messages: z
    .array(
      z.object({
        role: z.enum(["caller", "agent"]),
        text: z.string().trim().min(1).max(600),
      }),
    )
    .max(AI_DEMO_LIMITS.turns),
});

const busy = () => new HttpError(429, "demo_busy", "La démo est très demandée. Réessayez dans quelques minutes.");

export async function aiDemoRoutes(app: FastifyInstance, deps: AppDeps) {
  const ipOf = (req: FastifyRequest) => req.ip || "unknown";

  /** Lets mimt.ca show the demo only when it can answer (AI key set, demo on). */
  app.get("/v1/public/ai-demo/status", async () => ({ available: deps.config.AI_DEMO !== "off" && Boolean(deps.ai?.gateway) }));

  app.post("/v1/public/ai-demo", async (req): Promise<AiDemoResponse> => {
    if (deps.config.AI_DEMO === "off") throw notConfigured("AI demo");
    const gateway = deps.ai?.gateway;
    if (!gateway) throw notConfigured("AI demo");
    const body = parse(Body, req.body);
    const last = body.messages[body.messages.length - 1];
    if (last?.role === "caller" && last.text.length > AI_DEMO_LIMITS.messageChars) {
      throw new HttpError(400, "message_too_long", "Message trop long pour la démo.");
    }
    if (body.messages.length >= AI_DEMO_LIMITS.turns) {
      return { reply: body.locale === "fr-CA" ? "Merci d'avoir essayé la démo MIMT. Au revoir!" : "Thanks for trying the MIMT demo. Goodbye!", done: true, ticket: null };
    }

    const ip = holdIpHash(ipOf(req));
    if (body.messages.length === 0 && !(await deps.rateLimiter.take(`ai-demo:calls:${ip}`, CALLS_PER_IP_DAY))) throw busy();
    if (!(await deps.rateLimiter.take(`ai-demo:turns:${ip}`, TURNS_PER_IP_HOUR))) throw busy();
    if (!(await deps.rateLimiter.take("ai-demo:global", { capacity: deps.config.AI_DEMO_DAILY_TURNS, windowSeconds: 86_400 }))) throw busy();

    const out = await gateway.demoTurn({
      system: DEMO_SYSTEM[body.scenario as keyof typeof DEMO_SYSTEM],
      locale: body.locale,
      messages: body.messages as Array<{ role: "caller" | "agent"; text: string }>,
    });
    req.log.info({ scenario: body.scenario, inputTokens: out.usage.inputTokens, outputTokens: out.usage.outputTokens, ok: out.ok }, "ai demo turn");
    if (!out.ok) {
      return {
        reply: body.locale === "fr-CA" ? "Désolé, je n'ai pas bien compris. Pouvez-vous reformuler?" : "Sorry, I didn't catch that. Could you say it another way?",
        done: false,
        ticket: null,
      };
    }
    return out.value;
  });
}
