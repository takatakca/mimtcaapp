import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.js";
import { validateTwilioSignature } from "../gateways/twilio.js";
import { twilioAiWebhooks } from "./twilioAi.js";
import { twilioPbxWebhooks } from "./twilioPbx.js";
import { twilioSmsWebhooks } from "./twilioSms.js";
import { twilioParams } from "./twiml.js";
import { twilioVoiceWebhooks } from "./twilioVoice.js";

/** All Twilio webhooks: X-Twilio-Signature is checked against PUBLIC_BASE_URL + path before any handler runs. */
export async function twilioWebhooks(app: FastifyInstance, deps: AppDeps) {
  const base = deps.config.PUBLIC_BASE_URL.replace(/\/$/, "");

  app.addHook("preHandler", async (req, reply) => {
    const token = deps.config.TWILIO_AUTH_TOKEN;
    if (!token) return reply.code(503).send({ error: "not_configured", message: "Twilio webhooks are not configured" });
    const signature = req.headers["x-twilio-signature"];
    const ok = validateTwilioSignature(token, typeof signature === "string" ? signature : undefined, base + req.url, twilioParams(req));
    if (!ok) {
      req.log.warn({ path: req.url.split("?")[0] }, "rejected Twilio webhook with bad signature");
      return reply.code(403).send({ error: "invalid_signature", message: "Invalid Twilio signature" });
    }
  });

  await twilioVoiceWebhooks(app, deps);
  await twilioSmsWebhooks(app, deps);
  await twilioPbxWebhooks(app, deps);
  await twilioAiWebhooks(app, deps);

  app.post("/webhooks/twilio/usage", async (req, reply) => {
    const p = twilioParams(req);
    req.log.error(
      { currentValue: p.CurrentValue, triggerValue: p.TriggerValue, category: p.UsageCategory },
      "Twilio usage trigger fired",
    );
    return reply.code(204).send();
  });
}
