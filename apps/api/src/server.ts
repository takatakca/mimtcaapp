import { buildApp } from "./app.js";
import { migrateStandaloneDatabase } from "./jobs/migrateStandalone.js";
import { createDeps, createLogger } from "./bootstrap.js";
import { loadConfig } from "./config.js";
import { runDailyCostReport } from "./jobs/dailyCost.js";
import { runAccountDeletion } from "./jobs/accountDeletion.js";
import { runPointsExpiry } from "./jobs/pointsExpiry.js";
import { runSessionRetention } from "./jobs/sessionRetention.js";
import { runPartnerAccessLogRetention } from "./services/partnerConsent.js";
import { runAffiliateMaintenance } from "./services/affiliates.js";
import { runNumberLifecycle } from "./jobs/numberLifecycle.js";
import { runFallbackBackfill } from "./jobs/numberFallback.js";
import { pingHeartbeat } from "./monitoring/report.js";
import { deliverOutbox } from "./services/outbox.js";
import { deliverPartnerWebhooks } from "./services/partners.js";
import { runCalendarSync } from "./services/calendar.js";
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

// « MIMT Connect » partner webhooks (services/partners.ts): same poller model; does nothing while PARTNERS=off.
const partnerWebhookTimer = setInterval(() => {
  deliverPartnerWebhooks(deps, app.log).catch((err) => app.log.error({ err }, "partner webhook delivery failed"));
}, 15_000);
partnerWebhookTimer.unref();

// « Google Agenda » (services/calendar.ts): calendar_sync_jobs → Google Calendar events.insert, every minute; does
// nothing while CALENDAR=off or without GOOGLE_OAUTH_* credentials.
const calendarTimer = setInterval(() => {
  runCalendarSync(deps, app.log).catch((err) => app.log.error({ err: { message: (err as Error).message } }, "calendar sync failed"));
}, 60_000);
calendarTimer.unref();

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

// Free-number recycling (30 idle days, reminders on days 20 and 27, 7-day grace, 90-day quarantine).
// Only numbers bought from NUMBER_LIFECYCLE_FROM on; older numbers are never touched.
// First run 10 minutes after start, then daily; NUMBER_LIFECYCLE=off pauses it.
const lifecycle = () => {
  if (process.env.NUMBER_LIFECYCLE === "off") return;
  runNumberLifecycle({ repo: deps.repo, twilio: deps.twilio, notifier: deps.notifier, since: config.NUMBER_LIFECYCLE_FROM, log: app.log })
    .then((res) => app.log.info({ warned: res.warned, transitions: res.transitions.length, errors: res.errors }, "number lifecycle done"))
    .catch((err) => app.log.error({ err }, "number lifecycle failed"));
};
const lifecycleFirst = setTimeout(lifecycle, 10 * 60 * 1000);
lifecycleFirst.unref();
const lifecycleTimer = setInterval(lifecycle, 24 * 60 * 60 * 1000);
lifecycleTimer.unref();

// Twilio fallback URLs (docs/MIMT-CALL-RELIABILITY.md): once, 2 minutes after start, and only when one is set.
// Only MIMT numbers created from 2026-10-23 (our table and Twilio's own date); older numbers are never touched.
const fallbackFirst =
  config.TWILIO_VOICE_FALLBACK_URL || config.TWILIO_SMS_FALLBACK_URL
    ? setTimeout(() => {
        runFallbackBackfill({ repo: deps.repo, twilio: deps.twilio, config, log: app.log }).catch((err) =>
          app.log.error({ err }, "number fallback backfill failed"),
        );
      }, 2 * 60 * 1000)
    : null;
fallbackFirst?.unref();

// Account deletion: personal data of accounts deleted 30 days ago is purged (jobs/accountDeletion.ts).
// First run 15 minutes after start, then daily. ACCOUNT_DELETION=off pauses it (requests still close accounts at once).
const accountDeletion = () => {
  if (process.env.ACCOUNT_DELETION === "off") return;
  runAccountDeletion(deps, { log: app.log })
    .then((res) => app.log.info({ deleted: res.deleted, errors: res.errors }, "account deletion done"))
    .catch((err) => app.log.error({ err }, "account deletion failed"));
};
const deletionFirst = setTimeout(accountDeletion, 15 * 60 * 1000);
deletionFirst.unref();
const deletionTimer = setInterval(accountDeletion, 24 * 60 * 60 * 1000);
deletionTimer.unref();

// MIMT Points inactivity expiry (jobs/pointsExpiry.ts): off unless POINTS_EXPIRY=on; first run 20 minutes after start.
const pointsExpiry = () => {
  runPointsExpiry(deps, { log: app.log })
    .then((res) => app.log.info(res, "points expiry done"))
    .catch((err) => app.log.error({ err }, "points expiry failed"));
};
const pointsExpiryFirst = setTimeout(pointsExpiry, 20 * 60 * 1000);
pointsExpiryFirst.unref();
const pointsExpiryTimer = setInterval(pointsExpiry, 24 * 60 * 60 * 1000);
pointsExpiryTimer.unref();
// Affiliate program: commissions past their 30-day hold become payable; rejected applications are deleted after
// 90 days (services/affiliates.ts). First run 20 minutes after start, then daily.
const affiliates = () => {
  runAffiliateMaintenance(deps)
    .then((res) => app.log.info(res, "affiliate maintenance done"))
    .catch((err) => app.log.error({ err }, "affiliate maintenance failed"));
};
const affiliatesFirst = setTimeout(affiliates, 20 * 60 * 1000);
affiliatesFirst.unref();
const affiliatesTimer = setInterval(affiliates, 24 * 60 * 60 * 1000);
affiliatesTimer.unref();

// Session inventory retention (jobs/sessionRetention.ts): revoked or idle sessions deleted after 90 days. Daily.
const sessionRetention = () => {
  runSessionRetention(deps)
    .then((res) => app.log.info(res, "session retention done"))
    .catch((err) => app.log.error({ err }, "session retention failed"));
};
const sessionRetentionFirst = setTimeout(sessionRetention, 25 * 60 * 1000);
sessionRetentionFirst.unref();
const sessionRetentionTimer = setInterval(sessionRetention, 24 * 60 * 60 * 1000);
sessionRetentionTimer.unref();

// « MIMT Connect » access log (services/partnerConsent.ts): entries older than 90 days are deleted. Daily. Runs even with
// PARTNERS=off so nothing outlives its retention while the platform is paused.
const partnerAccessRetention = () => {
  runPartnerAccessLogRetention(deps)
    .then((res) => app.log.info(res, "partner access log retention done"))
    .catch((err) => app.log.error({ err }, "partner access log retention failed"));
};
const partnerAccessRetentionFirst = setTimeout(partnerAccessRetention, 27 * 60 * 1000);
partnerAccessRetentionFirst.unref();
const partnerAccessRetentionTimer = setInterval(partnerAccessRetention, 24 * 60 * 60 * 1000);
partnerAccessRetentionTimer.unref();

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  clearInterval(outboxTimer);
  clearInterval(partnerWebhookTimer);
  clearInterval(heartbeatTimer);
  clearInterval(costTimer);
  clearInterval(emailTimer);
  clearInterval(mediaRetentionTimer);
  clearTimeout(lifecycleFirst);
  clearInterval(lifecycleTimer);
  if (fallbackFirst) clearTimeout(fallbackFirst);
  clearTimeout(deletionFirst);
  clearInterval(deletionTimer);
  clearTimeout(pointsExpiryFirst);
  clearInterval(pointsExpiryTimer);
  clearTimeout(affiliatesFirst);
  clearInterval(affiliatesTimer);
  clearTimeout(sessionRetentionFirst);
  clearInterval(sessionRetentionTimer);
  clearTimeout(partnerAccessRetentionFirst);
  clearInterval(partnerAccessRetentionTimer);
  await app.close();
  await deps.repo.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: config.PORT, host: config.HOST });
