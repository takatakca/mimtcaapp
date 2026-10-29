// « Tester ma connexion »: turns a Twilio preflight report (Device.runPreflight) into what the audio settings show.
// Pure functions, unit-tested; the SDK itself stays in twilioEngine.ts. Twilio's five call-quality grades (from the
// average MOS) become four labels: excellent/great → excellente, good → bonne, fair → moyenne, degraded → faible.
import type { TKey } from "../i18n/core";

export type ConnectionQuality = "excellent" | "good" | "fair" | "poor";

export interface ConnectionTestResult {
  /** null when Twilio could not grade the call (too few samples). */
  quality: ConnectionQuality | null;
  /** Average jitter, ms. */
  jitterMs: number | null;
  /** Packets lost over the whole test, % of inbound packets. */
  packetLossPct: number | null;
  /** Average round-trip time, ms. */
  rttMs: number | null;
  /** The media had to go through a Twilio TURN relay (strict firewall or NAT). */
  turnRequired: boolean | null;
  /** Twilio edge that answered (ashburn, umatilla…). */
  edge: string | null;
}

/** The parts of PreflightTest.Report we read (kept structural so tests need no SDK). */
export interface PreflightReportLike {
  callQuality?: string;
  isTurnRequired?: boolean;
  edge?: string;
  selectedEdge?: string;
  stats?: { jitter?: { average: number }; rtt?: { average: number }; mos?: { average: number } };
  totals?: { packetsLostFraction?: number };
}

/** Twilio's own thresholds (rtc/warning: jitter > 30 ms, loss > 1 % in a second / 3 % average, rtt > 400 ms). */
const POOR_JITTER_MS = 30;
const POOR_LOSS_PCT = 3;
const POOR_RTT_MS = 400;

const finite = (n: number | undefined): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);

/** MOS grades as in the Voice SDK (preflight._getCallQuality), for reports without callQuality. */
function qualityFromMos(mos: number | null): ConnectionQuality | null {
  if (mos === null || mos <= 0) return null;
  if (mos > 4.0) return "excellent";
  if (mos >= 3.7) return "good";
  if (mos > 3.0) return "fair";
  return "poor";
}

export function qualityFromTwilio(callQuality: string | undefined, mos?: number): ConnectionQuality | null {
  switch (callQuality) {
    case "excellent":
    case "great":
      return "excellent";
    case "good":
      return "good";
    case "fair":
      return "fair";
    case "degraded":
      return "poor";
    default:
      return qualityFromMos(finite(mos));
  }
}

export function summarizePreflight(report: PreflightReportLike): ConnectionTestResult {
  const round = (n: number | null, digits = 0) => (n === null ? null : Number(n.toFixed(digits)));
  return {
    quality: qualityFromTwilio(report.callQuality, report.stats?.mos?.average),
    jitterMs: round(finite(report.stats?.jitter?.average)),
    packetLossPct: round(finite(report.totals?.packetsLostFraction), 1),
    rttMs: round(finite(report.stats?.rtt?.average)),
    turnRequired: typeof report.isTurnRequired === "boolean" ? report.isTurnRequired : null,
    edge: report.selectedEdge ?? report.edge ?? null,
  };
}

/** Show the « rapprochez-vous du routeur » tip: average or weak grade, or any measure past Twilio's thresholds. */
export function needsNetworkTip(r: ConnectionTestResult): boolean {
  return (
    r.quality === "fair" ||
    r.quality === "poor" ||
    (r.jitterMs ?? 0) > POOR_JITTER_MS ||
    (r.packetLossPct ?? 0) > POOR_LOSS_PCT ||
    (r.rttMs ?? 0) > POOR_RTT_MS
  );
}

export const QUALITY_KEY: Record<ConnectionQuality, TKey> = {
  excellent: "phone.test.quality.excellent",
  good: "phone.test.quality.good",
  fair: "phone.test.quality.fair",
  poor: "phone.test.quality.poor",
};

export function qualityLabelKey(q: ConnectionQuality | null): TKey {
  return q ? QUALITY_KEY[q] : "phone.test.quality.unknown";
}
