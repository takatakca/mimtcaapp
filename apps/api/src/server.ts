import { buildApp } from "./app.js";
import { createDeps, createLogger } from "./bootstrap.js";
import { loadConfig } from "./config.js";
import { runDailyCostReport } from "./jobs/dailyCost.js";
import { pingHeartbeat } from "./monitoring/report.js";
import { deliverOutbox } from "./services/outbox.js";

const config = loadConfig();
const log = createLogger(config);
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

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  clearInterval(outboxTimer);
  clearInterval(heartbeatTimer);
  clearInterval(costTimer);
  await app.close();
  await deps.repo.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: config.PORT, host: config.HOST });
