import { randomUUID } from "node:crypto";

/** Today's spend is an anomaly when it is more than three times the trailing average. */
export function isSpendAnomaly(todayUsd: number, trailingAverageUsd: number): boolean {
  return trailingAverageUsd > 0 && todayUsd > trailingAverageUsd * 3;
}

export function parseSentryDsn(dsn: string): { storeUrl: string; publicKey: string } | null {
  try {
    const url = new URL(dsn);
    if (url.protocol !== "https:") return null;
    const publicKey = decodeURIComponent(url.username);
    const projectId = url.pathname.replace(/^\//, "");
    if (!publicKey || !/^\d+$/.test(projectId)) return null;
    return { storeUrl: `${url.origin}/api/${projectId}/envelope/`, publicKey };
  } catch {
    return null;
  }
}

/** Sends an exception name and message to Sentry. Never includes headers, tokens or request bodies. */
export async function captureException(
  dsn: string,
  error: { name?: string; message?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const parsed = parseSentryDsn(dsn);
  if (!parsed) return;
  const eventId = randomUUID().replace(/-/g, "");
  const envelope = [
    JSON.stringify({ event_id: eventId, dsn }),
    JSON.stringify({ type: "event" }),
    JSON.stringify({
      event_id: eventId,
      platform: "node",
      level: "error",
      message: { formatted: `${error.name ?? "Error"}: ${error.message ?? "unknown"}`.slice(0, 500) },
    }),
  ].join("\n");
  await fetchImpl(parsed.storeUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-sentry-envelope",
      "x-sentry-auth": `Sentry sentry_version=7, sentry_client=mimt-api/0.1, sentry_key=${parsed.publicKey}`,
    },
    body: envelope,
    signal: AbortSignal.timeout(5_000),
  });
}

/** Pings a Better Stack heartbeat. The URL is a secret and is never logged. */
export async function pingHeartbeat(url: string | undefined, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!url || !url.startsWith("https://")) return;
  await fetchImpl(url, { method: "GET", signal: AbortSignal.timeout(5_000) });
}
