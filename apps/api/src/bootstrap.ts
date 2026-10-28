import { pino, type Logger } from "pino";
import { aiConfigured, stripeConfigured, twilioRestConfigured, type Config } from "./config.js";
import type { AppDeps } from "./deps.js";
import { loadSigningKey, SessionService } from "./auth/sessions.js";
import { TakatakOidc } from "./auth/takatak.js";
import { InMemoryRateLimiter } from "./fraud/rateLimiter.js";
import { admobKeyLoader } from "./ads/ssv.js";
import { createAiServices } from "./ai/service.js";
import { createDeviceVerifier } from "./devices/verify.js";
import { StripeGateway } from "./gateways/billing.js";
import { createProvisioningProvider } from "./catalog/providers/index.js";
import { SupabaseMediaStore } from "./gateways/media.js";
import { TwilioRestGateway } from "./gateways/twilio.js";
import { TwilioRestPortingGateway } from "./gateways/twilioPorting.js";
import { MessageCipher } from "./lib/crypto.js";
import { REDACT_PATHS } from "./logger.js";
import { MemoryRepository } from "./repo/memory.js";
import { PostgresRepository } from "./repo/postgres.js";
import { WebPushNotifier } from "./services/webPush.js";
import { createEmailSender } from "./services/email.js";
import { createVideoGateway } from "./video/gateway.js";
import { createContractGateway } from "./gateways/docusign.js";

export const createLogger = (config: Config): Logger =>
  pino({ level: config.LOG_LEVEL, redact: { paths: REDACT_PATHS, censor: "[redacted]" } });

/** Builds real dependencies from config. Missing optional services degrade to 503s instead of crashing. */
export function createDeps(config: Config, log: Logger): AppDeps {
  let repo;
  if (config.DATABASE_URL) {
    repo = new PostgresRepository(
      config.DATABASE_URL,
      config.DATABASE_SSL_CA_PEM ? { sslCaPem: config.DATABASE_SSL_CA_PEM } : {},
    );
    if (repo.suppliedCaInvalid) {
      log.error(
        { category: "database_ca_invalid", fallbackCaFileUsed: repo.tlsCaSource === "file" },
        "DATABASE_SSL_CA_PEM does not contain a valid X.509 PEM certificate. Fix the Coolify secret; TLS verification was not disabled.",
      );
    }
    if (repo.tlsCaSource === "file") {
      log.info("PostgreSQL is using a validated, mounted CA certificate; hostname verification remains enabled.");
    }
  } else {
    log.warn("DATABASE_URL not set: using the in-memory repository (data is lost on restart)");
    repo = new MemoryRepository();
  }

  const signing = loadSigningKey(config.MIMT_SESSION_SIGNING_KEY);
  if (signing.ephemeral) log.warn("MIMT_SESSION_SIGNING_KEY not set: using an ephemeral key (sessions end on restart)");

  let cipherKey = config.MESSAGE_ENCRYPTION_KEY;
  if (!cipherKey) {
    log.warn("MESSAGE_ENCRYPTION_KEY not set: using an ephemeral key (stored messages become unreadable on restart)");
    cipherKey = MessageCipher.generateKey();
  }

  const twilio = twilioRestConfigured(config) ? new TwilioRestGateway(config) : null;
  if (!twilio) log.warn("Twilio not configured: voice, numbers and messaging answer 503");
  const billing = stripeConfigured(config) ? new StripeGateway(config.STRIPE_SECRET_KEY!, config.STRIPE_WEBHOOK_SECRET!) : null;
  if (!billing) log.warn("Stripe not configured: billing answers 503");
  const provisioning = createProvisioningProvider(config);
  if (!provisioning) log.warn("PROVISIONING_PROVIDER not set: internet/mobile ordering answers 503");
  else if (provisioning.code === "sandbox") log.warn("Provisioning uses the SANDBOX provider: orders create fake services");
  const media =
    config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY ? new SupabaseMediaStore(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY) : null;
  if (!aiConfigured(config)) log.warn("ANTHROPIC_API_KEY not set: AI features answer 503 (spam labels still use local rules)");
  if (!media) log.warn("Supabase Storage not configured: voicemail audio stays at Twilio until it is copied");
  const mediaFiles =
    config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY
      ? new SupabaseMediaStore(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, config.SUPABASE_MEDIA_BUCKET)
      : null;
  if (!mediaFiles) log.warn("Supabase Storage not configured: MMS uploads and custom greetings answer 503");
  if (config.EMAIL_PROVIDER === "log") log.warn("EMAIL_PROVIDER=log: voicemail emails are logged, not sent");
  const porting = twilio && config.TWILIO_PORTING_ENABLED ? new TwilioRestPortingGateway(config) : null;
  if (!porting) log.warn("TWILIO_PORTING_ENABLED not set: port-in requests are signed and recorded, then wait for manual submission");

  const video = createVideoGateway(config);
  if (!video) log.warn("LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET not set: video meetings answer 503");

  const contracts = createContractGateway(config);
  if (!contracts) log.warn("DOCUSIGN_* not set: affiliate contracts are sent in manual mode");

  const cipher = new MessageCipher(cipherKey);
  return {
    config,
    repo,
    sessions: new SessionService(repo, signing.key, config.PUBLIC_BASE_URL),
    takatak: new TakatakOidc(config, repo),
    twilio,
    billing,
    media,
    mediaFiles,
    email: createEmailSender(config, log),
    deviceVerifier: createDeviceVerifier(config),
    admobKeys: admobKeyLoader(config.ADMOB_SSV_KEYS_URL),
    cipher,
    rateLimiter: new InMemoryRateLimiter(),
    notifier: new WebPushNotifier({ repo, cipher, log }),
    now: () => new Date(),
    provisioning,
    porting,
    video,
    contracts,
    ai: createAiServices({ config, ...(repo instanceof PostgresRepository ? { sql: repo.sql } : {}), log }),
  };
}
