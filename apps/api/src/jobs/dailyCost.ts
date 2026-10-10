import { pathToFileURL } from "node:url";
import type { Config } from "../config.js";
import { isSpendAnomaly } from "../monitoring/report.js";

export interface UsageReader {
  usagePriceUsd(start: Date, end: Date): Promise<number | null>;
}

export function asUsageReader(value: object | null): UsageReader | null {
  if (value && "usagePriceUsd" in value && typeof value.usagePriceUsd === "function") return value as UsageReader;
  return null;
}

/**
 * Logs the last day's Twilio spend. An error-level line is the alert when the day is above the
 * CAD threshold, or more than three times the previous six days.
 */
export async function runDailyCostReport(input: {
  twilio: object | null;
  config: Pick<Config, "DAILY_SPEND_ALERT_CAD" | "USD_TO_CAD">;
  now?: Date;
  log: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
}): Promise<{ skipped: boolean; cad: number | null; alert: boolean }> {
  const reader = asUsageReader(input.twilio);
  if (!reader) {
    input.log.info({}, "Twilio is not configured; daily cost report skipped");
    return { skipped: true, cad: null, alert: false };
  }
  const now = input.now ?? new Date();
  const day = 86_400_000;
  const todayUsd = await reader.usagePriceUsd(new Date(now.getTime() - day), now);
  const weekUsd = await reader.usagePriceUsd(new Date(now.getTime() - 7 * day), new Date(now.getTime() - day));
  if (todayUsd === null) return { skipped: false, cad: null, alert: false };
  const cad = todayUsd * input.config.USD_TO_CAD;
  const trailing = weekUsd === null ? 0 : weekUsd / 6;
  const alert = cad > input.config.DAILY_SPEND_ALERT_CAD || isSpendAnomaly(todayUsd, trailing);
  const line = { cad: Number(cad.toFixed(2)), alertThresholdCad: input.config.DAILY_SPEND_ALERT_CAD, anomaly: isSpendAnomaly(todayUsd, trailing) };
  if (alert) input.log.error(line, "Twilio daily spend is above the alert");
  else input.log.info(line, "Twilio daily cost");
  return { skipped: false, cad, alert };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { loadConfig } = await import("../config.js");
  const { createDeps, createLogger } = await import("../bootstrap.js");
  const config = loadConfig();
  const log = createLogger(config);
  const deps = createDeps(config, log);
  const result = await runDailyCostReport({ twilio: deps.twilio, config, log });
  await deps.repo.close();
  process.exit(result.alert ? 2 : 0);
}
