import { buildApp } from "./app.js";
import { migrateStandaloneDatabase } from "./jobs/migrateStandalone.js";
import { createDeps, createLogger } from "./bootstrap.js";
import { loadConfig } from "./config.js";
import { runDailyCostReport } from "./jobs/dailyCost.js";
import { pingHeartbeat } from "./monitoring/report.js";
import { deliverOutbox } from "./services/outbox.js";
import { deliverEmails } from "./services/email.js";
import { purgeExpiredMedia } from "./services/media.js";

const config = loadConfig();
const log = createLogger(config);
// Emergency one-shot database bootstrap; never enabled by default.
// Explicit MIMT-only safeguards are enforced again by migrateStandaloneDatabase.
// Remove BOTH one-shot Coolify flags after a verified successful migration.
if (process.env.MIMT_STANDALONE_BOOTSTRAP_ONCE === "YES_STARTUP_MIGRATE") {
  if (!config.DATABASE_URL) throw new Error("Dedicated MIMT database URL is missing");
  await migrateStandaloneDatabase(
    config.DATABASE_URL,
    process.env.MIMT_STANDALONE_MIGRATE_CONFIRM,
    config.NODE_ENV,
    config.DATABASE_SSL_CA_PEM,
  );
  log.info("Dedicated MIMT database schema verified; one-time startup bootstrap complete");
} else if (config.NODE_ENV === "production" && config.DATABASE_URL && process.env.MIMT_AUTO_MIGRATE !== "off") {
  // Pending migrations are applied at every start (each in its own transaction, checksum-tracked, applied once).
  // The URL guard in assertPrivateMimtDatabase still refuses anything but the dedicated private MIMT database.
  // Without this, new migrations were never applied in production (0011–0013 were missing for days).
  // A failure is logged and the API starts on the current schema; /readyz then reports schema "outdated".
  try {
    await migrateStandaloneDatabase(config.DATABASE_URL, "YES_MY_PRIVATE_MIMT_DATABASE", config.NODE_ENV, config.DATABASE_SSL_CA_PEM);
    log.info("Database schema up to date (automatic startup migration)");
  } catch (err) {
    log.error({ err: { message: (err as Error).message } }, "Automatic startup migration failed; starting on the current schema");
  }
}
const deps = createDeps(config, log);
const app = await buildApp(deps);

// TAKATAK webhook outbox: small in-process poller (one API instance; move to a worker when scaling out).
const outboxTimer = setInterval(() => {
  deliverOutbox({ repo: deps.repo, config, log: app.log }).catch((err) => app.log.error({ err }, "outbox delivery failed"));
}, 15_000);
outboxTimer.unref();

const heartbeatTimer = setInterval(() => {
  pingHeartbeat(config.BETTER_STACK_HEARTBEAT_URL).catch(() => app.log.warn("heartbeat failed"));
}, 60_000);
heartbeatTimer.unref();

const costTimer = setInterval(() => {
  runDailyCostReport({ twilio: deps.twilio, config, log: app.log }).catch((err) => app.log.error({ err }, "daily cost report failed"));
}, 24 * 60 * 60 * 1000);
costTimer.unref();

// Voicemail-to-email outbox and MMS media retention (same single-instance poller model as the outbox).
const emailTimer = setInterval(() => {
  deliverEmails(deps, app.log).catch((err) => app.log.error({ err }, "email delivery failed"));
}, 30_000);
emailTimer.unref();
const mediaRetentionTimer = setInterval(() => {
  purgeExpiredMedia(deps, app.log).catch((err) => app.log.error({ err }, "media retention failed"));
}, 60 * 60 * 1000);
mediaRetentionTimer.unref();

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  clearInterval(outboxTimer);
  clearInterval(heartbeatTimer);
  clearInterval(costTimer);
  clearInterval(emailTimer);
  clearInterval(mediaRetentionTimer);
  await app.close();
  await deps.repo.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: config.PORT, host: config.HOST });
