import { z } from "zod";

const optional = z.string().min(1).optional();
const csv = (fallback: string[]) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : fallback));

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    PORT: z.coerce.number().int().positive().default(8080),
    HOST: z.string().default("0.0.0.0"),
    PUBLIC_BASE_URL: z.url().default("http://localhost:8080"),
    APP_BASE_URL: z.url().default("https://app.mimt.ca"),
    CORS_ORIGINS: csv(["https://mimt.ca", "https://app.mimt.ca", "https://takatak.ca"]),
    DATABASE_URL: optional,

    TWILIO_ACCOUNT_SID: optional,
    TWILIO_API_KEY_SID: optional,
    TWILIO_API_KEY_SECRET: optional,
    TWILIO_AUTH_TOKEN: optional,
    TWILIO_TWIML_APP_SID: optional,
    TWILIO_PUSH_CREDENTIAL_SID_IOS: optional,
    TWILIO_PUSH_CREDENTIAL_SID_ANDROID: optional,
    TWILIO_MESSAGING_SERVICE_SID: optional,
    TWILIO_VERIFY_SERVICE_SID: optional,
    /** Emergency-enabled company number used as caller ID for 9-1-1 when the user has no number yet. */
    EMERGENCY_FALLBACK_CALLER_ID: optional,

    TAKATAK_ISSUER: optional,
    TAKATAK_JWKS_URL: optional,
    TAKATAK_CLIENT_ID: optional,
    TAKATAK_CLIENT_SECRET: optional,
    TAKATAK_REDIRECT_URIS: csv([]),
    TAKATAK_WEBHOOK_URL: optional,
    TAKATAK_WEBHOOK_SECRET: optional,
    /** Shared key TAKATAK's server sends on /v1/takatak/*. Either the raw key or its SHA-256 hex. */
    MIMT_API_KEY: optional,
    MIMT_API_KEY_SHA256: z.string().regex(/^[0-9a-f]{64}$/i).optional(),

    /** Ed25519 private key as a JWK (JSON) or PKCS#8 PEM. */
    MIMT_SESSION_SIGNING_KEY: optional,
    /** base64 of 32 random bytes. */
    MESSAGE_ENCRYPTION_KEY: optional,

    STRIPE_SECRET_KEY: optional,
    STRIPE_WEBHOOK_SECRET: optional,

    E911_NOTICE_VERSION: z.string().default("2026-10-fr-draft-1"),
    DAILY_SPEND_ALERT_CAD: z.coerce.number().positive().default(25),
    USD_TO_CAD: z.coerce.number().positive().default(1.4),
    /** Conservative per-minute estimate used to size <Dial timeLimit> for prepaid international calls. */
    INTL_ASSUMED_RATE_CENTS_PER_MIN: z.coerce.number().int().positive().default(50),

    /** Claude (AI features). Optional: when unset every AI feature answers 503 not_configured. */
    ANTHROPIC_API_KEY: optional,
    ANTHROPIC_MODEL: z.string().min(1).default("claude-opus-5-5"),
    /** Public wss:// URL of the AI receptionist WebSocket. Default: PUBLIC_BASE_URL with wss + /ws/ai/receptionist. */
    AI_RECEPTIONIST_WS_URL: z.url().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") return;
    const required = [
      "DATABASE_URL",
      "TWILIO_ACCOUNT_SID",
      "TWILIO_API_KEY_SID",
      "TWILIO_API_KEY_SECRET",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_TWIML_APP_SID",
      "TAKATAK_ISSUER",
      "TAKATAK_CLIENT_ID",
      "TAKATAK_WEBHOOK_URL",
      "TAKATAK_WEBHOOK_SECRET",
      "MIMT_SESSION_SIGNING_KEY",
      "MESSAGE_ENCRYPTION_KEY",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ] as const;
    for (const key of required) {
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required in production` });
    }
    if (!env.MIMT_API_KEY && !env.MIMT_API_KEY_SHA256) {
      ctx.addIssue({ code: "custom", path: ["MIMT_API_KEY"], message: "MIMT_API_KEY or MIMT_API_KEY_SHA256 is required in production" });
    }
    if (!env.PUBLIC_BASE_URL.startsWith("https://")) {
      ctx.addIssue({ code: "custom", path: ["PUBLIC_BASE_URL"], message: "PUBLIC_BASE_URL must be https in production" });
    }
  });

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  // .env files often carry empty values: treat them as unset.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}

export const twilioRestConfigured = (c: Config) => Boolean(c.TWILIO_ACCOUNT_SID && c.TWILIO_API_KEY_SID && c.TWILIO_API_KEY_SECRET);
export const stripeConfigured = (c: Config) => Boolean(c.STRIPE_SECRET_KEY && c.STRIPE_WEBHOOK_SECRET);
export const aiConfigured = (c: Config) => Boolean(c.ANTHROPIC_API_KEY);
