import { z } from "zod";
import { isSipHost } from "./lib/cuba.js";
import { plansFromEnv, type PlanTable } from "./plansConfig.js";
import { pointsFromEnv, type PointsConfig } from "./pointsConfig.js";

const optional = z.string().min(1).optional();

/**
 * Twilio Verify service « MIMT » (SMS sign-in codes), created by the owner on 2026-10-22. A service SID is an
 * identifier, not a secret. TWILIO_VERIFY_SERVICE_SID overrides it; "off" turns SMS sign-in off.
 */
export const DEFAULT_VERIFY_SERVICE_SID = "VAc17f03b98d76d6f0183445ab09458afc";
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
    /** Explicit Supabase project identity required in production to prevent cross-product database writes. */
    MIMT_DATABASE_PROJECT_REF: z.string().regex(/^[a-z0-9]{20}$/).optional(),
    /** PEM root CA used to verify PostgreSQL's TLS certificate chain. Never disable certificate verification. */
    DATABASE_SSL_CA_PEM: optional,

    TWILIO_ACCOUNT_SID: optional,
    TWILIO_API_KEY_SID: optional,
    TWILIO_API_KEY_SECRET: optional,
    TWILIO_AUTH_TOKEN: optional,
    TWILIO_TWIML_APP_SID: optional,
    TWILIO_PUSH_CREDENTIAL_SID_IOS: optional,
    TWILIO_PUSH_CREDENTIAL_SID_ANDROID: optional,
    TWILIO_MESSAGING_SERVICE_SID: optional,
    TWILIO_VERIFY_SERVICE_SID: z
      .string()
      .min(1)
      .optional()
      .transform((v) => (v === "off" ? undefined : (v ?? DEFAULT_VERIFY_SERVICE_SID))),
    /** Emergency-enabled company number used as caller ID for 9-1-1 when the user has no number yet. */
    EMERGENCY_FALLBACK_CALLER_ID: optional,
    /** Number port-in through the Twilio Porting API. Off until porting is enabled on the Twilio account. */
    TWILIO_PORTING_ENABLED: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
    /** Port-in fee in cents. 0 (free) until the owner approves a fee (docs/MIMT-PARITY.md, P0 item 7). */
    PORT_IN_FEE_CENTS: z.coerce.number().int().min(0).max(100_000).default(0),
    /** Ops address copied on Twilio porting notifications. */
    PORT_IN_NOTIFICATION_EMAIL: z.email().optional(),

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

    /** Catalog / resale (docs/MIMT-RESALE.md). Unset: sandbox outside production, disabled in production. */
    PROVISIONING_PROVIDER: z.enum(["sandbox", "videotron"]).optional(),
    VIDEOTRON_API_BASE_URL: z.url().optional(),
    VIDEOTRON_CLIENT_ID: optional,
    VIDEOTRON_CLIENT_SECRET: optional,
    VIDEOTRON_RESELLER_ID: optional,
    VIDEOTRON_TOKEN_URL: z.url().optional(),
    VIDEOTRON_WEBHOOK_SECRET: optional,
    /** MIMT user ids allowed on /v1/admin/* catalog routes (comma separated). */
    CATALOG_ADMIN_USER_IDS: csv([]),

    /** Claude (AI features). Optional: when unset every AI feature answers 503 not_configured. */
    ANTHROPIC_API_KEY: optional,
    ANTHROPIC_MODEL: z.string().min(1).default("claude-opus-5-5"),
    /** Public AI phone demo on mimt.ca (routes/aiDemo.ts): "off" switches it off. */
    AI_DEMO: z.enum(["on", "off"]).default("on"),
    /** Global cap on demo AI turns per rolling day (cost guard). */
    AI_DEMO_DAILY_TURNS: z.coerce.number().int().min(0).max(100_000).default(1500),
    /** Public wss:// URL of the AI receptionist WebSocket. Default: PUBLIC_BASE_URL with wss + /ws/ai/receptionist. */
    AI_RECEPTIONIST_WS_URL: z.url().optional(),
    SENTRY_DSN: optional,
    /** Secret URL. Never log it. */
    BETTER_STACK_HEARTBEAT_URL: optional,
    /** Second carrier for Cuba (+53), which Twilio does not offer. Telnyx or VoIP.ms, via a SIP trunk. */
    CUBA_CARRIER: z.enum(["telnyx", "voipms"]).optional(),
    CUBA_SIP_HOST: optional,
    SUPABASE_URL: optional,
    SUPABASE_SERVICE_ROLE_KEY: optional,
    /** Private bucket for MMS media and voicemail greetings (created by migration 0007). */
    SUPABASE_MEDIA_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,62}$/).default("media"),
    /** Voicemail-to-email sender. "log" (default) only logs; "resend" sends through Resend's HTTP API with EMAIL_API_KEY. */
    EMAIL_PROVIDER: z.enum(["log", "resend"]).default("log"),
    EMAIL_API_KEY: optional,
    EMAIL_FROM: z.string().min(3).default("MIMT <messagerie@mimt.ca>"),
    ADMOB_SSV_KEYS_URL: z.url().default("https://www.gstatic.com/admob/reward/verifier-keys.json"),
    APPLE_BUNDLE_ID: optional,
    APPLE_TEAM_ID: optional,
    /** Apple root CA PEM. Public certificate, still kept in the environment so it can be rotated. */
    APPLE_ROOT_CA_PEM: optional,
    GOOGLE_PLAY_PACKAGE_NAME: optional,
    GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: optional,
    /** Shared secret in the Pub/Sub push URL of Google Play RTDN (/webhooks/google-play?token=…). The API re-reads
     * every notified purchase from Google, so the token only keeps strangers from triggering those reads. */
    GOOGLE_PLAY_RTDN_TOKEN: z.string().min(24).optional(),
    /** Réunions MIMT (LiveKit, docs/MIMT-VIDEO.md). All three or the meeting routes answer 503 not_configured. */
    LIVEKIT_URL: z
      .string()
      .regex(/^wss?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/, "LIVEKIT_URL must be a ws(s):// URL")
      .optional(),
    LIVEKIT_API_KEY: optional,
    /** Signs meeting tokens and verifies LiveKit webhooks. Never returned nor logged. */
    LIVEKIT_API_SECRET: optional,
    /** Free-tier cost guard (services/freeTier.ts). New free numbers per UTC day; 0 = no new free numbers. */
    /** Voicemail transcription: "intelligence" = Conversation Intelligence in French or English (by user language); "builtin" = Twilio's English-only <Record transcribe>; "off". */
    VOICEMAIL_TRANSCRIPTION: z.enum(["intelligence", "builtin", "off"]).default("intelligence"),
    /** Number recycling applies only to numbers created on or after this date; older numbers are never touched. */
    NUMBER_LIFECYCLE_FROM: z.coerce.date().default(new Date("2026-10-23T00:00:00Z")),
    FREE_NEW_NUMBERS_PER_DAY: z.coerce.number().int().min(0).max(100_000).default(5),
    /** Free-tier cost guard: numbers held (active/locked/grace) by accounts without a live paid plan; 0 = no new free numbers. */
    FREE_ACTIVE_NUMBERS_MAX: z.coerce.number().int().min(0).max(1_000_000).default(50),
    /** "false" refuses free-plan outbound PSTN calls and SMS (app-to-app and 9-1-1 stay allowed). */
    FREE_OUTBOUND_PSTN_ENABLED: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v !== "false"),
    /** Estimated Twilio spend of all free-plan accounts in the current UTC month; reached = free outbound PSTN/SMS paused. */
    FREE_TIER_MONTHLY_BUDGET_CAD: z.coerce.number().min(0).default(150),
    /** "false" refuses free-plan number claims (paid plans unaffected). */
    FREE_SIGNUPS_ENABLED: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v !== "false"),
    /** Optional 7-day trial of Essentiel: card on file (Stripe Checkout), tiny quota (TRIAL_CAPS). Off by default. */
    TRIAL_ENABLED: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
    /**
     * « Missions MIMT » kill switch (services/missions.ts): "off" grants no new mission reward (events are not
     * recorded while off); GET /v1/missions still answers with enabled: false. Default "on".
     */
    MISSIONS: z.enum(["on", "off"]).default("on"),
    /**
     * « Programme d'agents affiliés » e-signature (docs/MIMT-AFFILIATES.md). All six (account, integration key, user,
     * RSA private key for JWT grant, REST base URL, template) or « send contract » answers in manual mode with the
     * filled contract text. DOCUSIGN_BASE_URL is the account's REST base, e.g. https://demo.docusign.net/restapi
     * (sandbox) or https://ca.docusign.net/restapi; the OAuth host follows it (account-d for demo).
     */
    DOCUSIGN_ACCOUNT_ID: optional,
    DOCUSIGN_INTEGRATION_KEY: optional,
    DOCUSIGN_USER_ID: optional,
    /** RSA private key (PEM, PKCS#1 or PKCS#8) of the integration key. Never logged. */
    DOCUSIGN_PRIVATE_KEY: optional,
    DOCUSIGN_BASE_URL: z.url().optional(),
    DOCUSIGN_TEMPLATE_ID: optional,
    /** Role name of the signer in the DocuSign template. */
    DOCUSIGN_TEMPLATE_ROLE: z.string().min(1).max(100).default("Affilie"),
    /** HMAC key of the DocuSign Connect configuration (X-DocuSign-Signature-1). Unset: /webhooks/docusign answers 503. */
    DOCUSIGN_CONNECT_HMAC_KEY: optional,
    /**
     * « Pilote MIMT » command bar (docs/MIMT-PILOTE.md): "on" = Claude plans commands when AI is configured and the
     * user consented (local French/English parser otherwise); "rules" = local parser only (no AI cost); "off" =
     * POST /v1/ai/command answers 503 pilot_disabled. Default "on".
     */
    AI_COMMANDS: z.enum(["on", "rules", "off"]).default("on"),
    DEVICE_ATTESTATION_REQUIRED: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
  })
  .superRefine((env, ctx) => {
    if (env.SENTRY_DSN && !env.SENTRY_DSN.startsWith("https://")) {
      ctx.addIssue({ code: "custom", path: ["SENTRY_DSN"], message: "SENTRY_DSN must be https" });
    }
    if (env.BETTER_STACK_HEARTBEAT_URL && !env.BETTER_STACK_HEARTBEAT_URL.startsWith("https://")) {
      ctx.addIssue({ code: "custom", path: ["BETTER_STACK_HEARTBEAT_URL"], message: "BETTER_STACK_HEARTBEAT_URL must be https" });
    }
    if (env.CUBA_SIP_HOST && !isSipHost(env.CUBA_SIP_HOST)) {
      ctx.addIssue({ code: "custom", path: ["CUBA_SIP_HOST"], message: "CUBA_SIP_HOST must be a hostname, with no user or password" });
    }
    if (env.DOCUSIGN_BASE_URL && !env.DOCUSIGN_BASE_URL.startsWith("https://")) {
      ctx.addIssue({ code: "custom", path: ["DOCUSIGN_BASE_URL"], message: "DOCUSIGN_BASE_URL must be https" });
    }
    if (env.EMAIL_PROVIDER === "resend" && !env.EMAIL_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["EMAIL_API_KEY"], message: "EMAIL_API_KEY is required when EMAIL_PROVIDER=resend" });
    }
    if (env.NODE_ENV !== "production") return;
    if (env.DATABASE_URL) {
      try {
        const database = new URL(env.DATABASE_URL);
        const hostname = database.hostname.toLowerCase();
        const isPooler = hostname.endsWith(".pooler.supabase.com");
        const directMatch = hostname.match(/^db\.([a-z0-9]{20})\.supabase\.co$/);
        if (isPooler || directMatch) {
          const username = decodeURIComponent(database.username);
          const actualRef = isPooler ? username.match(/\.([a-z0-9]{20})$/)?.[1] : directMatch?.[1];
          if (!env.MIMT_DATABASE_PROJECT_REF) {
            ctx.addIssue({
              code: "custom",
              path: ["MIMT_DATABASE_PROJECT_REF"],
              message: "Dedicated MIMT Supabase project reference must be explicitly configured in production",
            });
          } else if (actualRef !== env.MIMT_DATABASE_PROJECT_REF) {
            ctx.addIssue({
              code: "custom",
              path: ["DATABASE_URL"],
              message: "Database project does not match the configured dedicated MIMT Supabase project",
            });
          }
        }
      } catch {
        ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "Database connection URL is malformed" });
      }
    }
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
    if (env.LIVEKIT_URL && !env.LIVEKIT_URL.startsWith("wss://")) {
      ctx.addIssue({ code: "custom", path: ["LIVEKIT_URL"], message: "LIVEKIT_URL must be wss:// in production" });
    }
    if (!env.PUBLIC_BASE_URL.startsWith("https://")) {
      ctx.addIssue({ code: "custom", path: ["PUBLIC_BASE_URL"], message: "PUBLIC_BASE_URL must be https in production" });
    }
  });

export type Config = z.infer<typeof EnvSchema> & {
  /** Plan prices and quotas (shared defaults + PLAN_* overrides), checked against the unit-economics rule. */
  plans: PlanTable;
  /** « MIMT Points » switches and catalog (pointsConfig.ts: POINTS, POINTS_*), checked against the economics rule. */
  points: PointsConfig;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  // .env files often carry empty values: treat them as unset.
  const cleaned = Object.fromEntries(
    Object.entries(env)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => [k, k.endsWith("_PEM") || k.endsWith("_JSON") || k === "DOCUSIGN_PRIVATE_KEY" ? v!.replace(/\\n/g, "\n") : v]),
  );
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return { ...parsed.data, plans: plansFromEnv(cleaned, parsed.data.USD_TO_CAD), points: pointsFromEnv(cleaned, parsed.data.USD_TO_CAD) };
}

export const twilioRestConfigured = (c: Config) => Boolean(c.TWILIO_ACCOUNT_SID && c.TWILIO_API_KEY_SID && c.TWILIO_API_KEY_SECRET);
export const stripeConfigured = (c: Config) => Boolean(c.STRIPE_SECRET_KEY && c.STRIPE_WEBHOOK_SECRET);
export const aiConfigured = (c: Config) => Boolean(c.ANTHROPIC_API_KEY);
export const docusignConfigured = (c: Config) =>
  Boolean(c.DOCUSIGN_ACCOUNT_ID && c.DOCUSIGN_INTEGRATION_KEY && c.DOCUSIGN_USER_ID && c.DOCUSIGN_PRIVATE_KEY && c.DOCUSIGN_BASE_URL && c.DOCUSIGN_TEMPLATE_ID);
