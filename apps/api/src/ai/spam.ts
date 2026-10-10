import { isEmergencyNumber, type SpamLabel, type SpamVerdict } from "@mimt/shared";
import type { AppDeps } from "../deps.js";
import { looksLikeOtp } from "../fraud/policy.js";
import type { RateRule } from "../fraud/rateLimiter.js";
import { aiBudget, hasAiConsent, recordAiUsage } from "./service.js";
import type { SpamScore } from "./store.js";

// Spam/fraud scoring of inbound calls and SMS. Labels only: nothing is ever blocked here, so 9-1-1 and
// callbacks from emergency services always ring through. Cheap local heuristics run for everyone;
// Claude is called only for ambiguous SMS text, and only with the user's "ai_processing" consent.

export interface Verdict {
  verdict: SpamVerdict;
  score: number;
  reason: string;
}

/** Score at or above which a call/SMS is labelled. */
export const LABEL_THRESHOLD = 0.7;
/** SMS heuristic scores in [AMBIGUOUS_MIN, LABEL_THRESHOLD) go to Claude when allowed. */
export const AMBIGUOUS_MIN = 0.25;
/** After a 9-1-1 call, inbound calls are never labelled for this long (PSAP callbacks often fail STIR/SHAKEN). */
export const EMERGENCY_CALLBACK_WINDOW_MS = 60 * 60 * 1000;

export const CALLER_VELOCITY_RULE: RateRule = { capacity: 15, windowSeconds: 3600 };
export const SMS_SENDER_VELOCITY_RULE: RateRule = { capacity: 20, windowSeconds: 3600 };

/**
 * NANP area codes outside Canada/US often used in "one-ring" and callback scams (international rates
 * behind a +1 number), plus premium-rate 900/976.
 */
export const HIGH_RISK_PREFIXES = [
  "+1268", "+1284", "+1473", "+1649", "+1664", "+1758", "+1767", "+1784", "+1809", "+1829", "+1849", "+1868", "+1869", "+1876",
  "+1900", "+1976",
];

const E164_RE = /^\+[1-9]\d{6,14}$/;
/** Twilio's placeholder numbers for withheld caller ID. */
const HIDDEN_CALLER = /anonymous|restricted|unknown|unavailable|private|^\+?266696687$|^\+?7378742833$|^\+?2562533$|^\+?8656696$/i;

const clamp = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;

function decide(score: number, reasons: string[], scamSignal: boolean): Verdict {
  const s = clamp(score);
  const verdict: SpamVerdict = s >= LABEL_THRESHOLD ? (scamSignal ? "scam" : "spam") : "ok";
  return { verdict, score: s, reason: reasons.join(",") || "none" };
}

export interface CallSignals {
  from: string | undefined;
  /** Twilio StirVerstat: TN-Validation-Passed-A/B/C, TN-Validation-Failed(-A/B/C), No-TN-Validation. */
  stirVerstat?: string | undefined;
  /** The caller exceeded CALLER_VELOCITY_RULE across MIMT. */
  velocityExceeded: boolean;
  /** The user called 9-1-1 recently. */
  emergencyWindow: boolean;
}

export function scoreCall(s: CallSignals): Verdict {
  const from = (s.from ?? "").trim();
  if (isEmergencyNumber(from)) return { verdict: "ok", score: 0, reason: "emergency_services" };
  if (s.emergencyWindow) return { verdict: "ok", score: 0, reason: "emergency_callback_window" };

  let score = 0;
  const reasons: string[] = [];
  let scam = false;
  if (!from || HIDDEN_CALLER.test(from) || !E164_RE.test(from)) {
    score += 0.35;
    reasons.push("caller_id_hidden_or_invalid");
  }
  const stir = s.stirVerstat ?? "";
  if (/^TN-Validation-Passed-A$/i.test(stir)) {
    score -= 0.2;
    reasons.push("stir_a");
  } else if (/^TN-Validation-Passed-C$/i.test(stir)) {
    score += 0.1;
    reasons.push("stir_c");
  } else if (/^TN-Validation-Failed/i.test(stir)) {
    score += 0.4;
    reasons.push("stir_failed");
  } else if (/^No-TN-Validation$/i.test(stir)) {
    score += 0.15;
    reasons.push("stir_none");
  }
  if (HIGH_RISK_PREFIXES.some((p) => from.startsWith(p))) {
    score += 0.45;
    reasons.push("high_risk_prefix");
    scam = true;
  }
  if (s.velocityExceeded) {
    score += 0.4;
    reasons.push("caller_velocity");
  }
  return decide(score, reasons, scam);
}

const SHORTENER = /\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|cutt\.ly|rb\.gy|ow\.ly|shorturl\.at|tiny\.cc)\b/i;
const URL_RE = /\b(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(xyz|top|click|icu|live|shop|info|online|site|vip|cc|link|buzz)\b/i;
const IP_URL = /https?:\/\/\d{1,3}(\.\d{1,3}){3}/i;
const SCAM_WORDS =
  /\b(colis|livraison|postes canada|canada post|purolator|arc|cra|remboursement|refund|interac|virement|e-transfer|compte (?:suspendu|bloqu[ée])|account (?:suspended|locked)|v[ée]rifiez votre compte|verify your account|cliquez|click here|carte[- ]cadeau|gift ?card|bitcoin|crypto|vous avez gagn[ée]|you(?:'ve| have) won|prix|prize|amende|p[ée]age|toll|urgent)\b/i;
const MARKETING_WORDS = /\b(promo|rabais|solde|offre|offer|discount|deal|% off|abonnez|subscribe|r[ée]pondez stop|reply stop)\b/i;

export interface SmsSignals {
  from: string | undefined;
  body: string;
  /** The user has already written to this sender. */
  knownSender: boolean;
  velocityExceeded: boolean;
}

export function scoreSms(s: SmsSignals): Verdict {
  const from = (s.from ?? "").trim();
  if (isEmergencyNumber(from)) return { verdict: "ok", score: 0, reason: "emergency_services" };
  if (s.knownSender) return { verdict: "ok", score: 0, reason: "known_sender" };
  // Legitimate one-time codes are the most common SMS from unknown short codes; never send them to the AI.
  if (looksLikeOtp(s.body) && !URL_RE.test(s.body)) return { verdict: "ok", score: 0.05, reason: "verification_code" };

  let score = 0.05;
  const reasons: string[] = [];
  let scam = false;
  const hasUrl = URL_RE.test(s.body) || SHORTENER.test(s.body);
  const scamWords = SCAM_WORDS.test(s.body);
  if (hasUrl) {
    score += 0.25;
    reasons.push("link");
  }
  if (SHORTENER.test(s.body) || IP_URL.test(s.body)) {
    score += 0.2;
    reasons.push("obfuscated_link");
  }
  if (scamWords) {
    score += 0.3;
    reasons.push("scam_keywords");
    scam = true;
  }
  if (MARKETING_WORDS.test(s.body)) {
    score += 0.2;
    reasons.push("marketing");
  }
  if (s.velocityExceeded) {
    score += 0.3;
    reasons.push("sender_velocity");
  }
  if (from && !E164_RE.test(from) && !/^\d{5,6}$/.test(from)) {
    score += 0.1;
    reasons.push("odd_sender");
  }
  return decide(score, reasons, scam && hasUrl);
}

export const spamLabelOf = (s: Pick<SpamScore, "verdict"> | undefined): SpamLabel | undefined =>
  s && s.verdict !== "ok" ? s.verdict : undefined;

// ------------------------------------------------------------------------------------------ hooks

/** Inbound PSTN call (background). */
export async function scoreInboundCall(
  deps: AppDeps,
  c: { callSid: string; telecomAccountId: string; from: string | undefined; stirVerstat: string | undefined },
): Promise<Verdict | null> {
  const ai = deps.ai;
  if (!ai) return null;
  const now = deps.now();
  const recent = await deps.repo.listCalls(c.telecomAccountId, 20);
  const emergencyWindow = recent.some((x) => x.kind === "emergency" && now.getTime() - x.startedAt.getTime() < EMERGENCY_CALLBACK_WINDOW_MS);
  const velocityExceeded = c.from ? !(await deps.rateLimiter.take(`spam:call:${c.from}`, CALLER_VELOCITY_RULE)) : false;
  const v = scoreCall({ from: c.from, stirVerstat: c.stirVerstat, velocityExceeded, emergencyWindow });
  await ai.store.setSpamScore({ telecomAccountId: c.telecomAccountId, targetType: "call", targetRef: c.callSid, ...v, source: "heuristic" });
  return v;
}

/** Inbound SMS (background): heuristic, then Claude (effort low) for ambiguous text when consented and in budget. */
export async function scoreInboundSms(
  deps: AppDeps,
  m: { messageId: string; telecomAccountId: string; from: string | undefined; body: string },
): Promise<Verdict & { source: "heuristic" | "ai" }> {
  const { repo } = deps;
  const ai = deps.ai;
  const knownSender = m.from ? await repo.hasOutboundTo(m.telecomAccountId, m.from, deps.now()) : false;
  const velocityExceeded = m.from ? !(await deps.rateLimiter.take(`spam:sms:${m.from}`, SMS_SENDER_VELOCITY_RULE)) : false;
  const heuristic = scoreSms({ from: m.from, body: m.body, knownSender, velocityExceeded });
  let result: Verdict & { source: "heuristic" | "ai" } = { ...heuristic, source: "heuristic" };

  if (ai?.gateway && heuristic.score >= AMBIGUOUS_MIN && heuristic.score < LABEL_THRESHOLD) {
    const account = await repo.getAccount(m.telecomAccountId);
    if (account && (await hasAiConsent(repo, account.ownerUserId)) && (await aiBudget(deps, ai, account.id)).available) {
      const out = await ai.gateway.classifySms({ text: m.body, knownSender });
      await recordAiUsage(deps, ai, account.id, "spam_classification", out.usage);
      // A refusal or unusable output keeps the heuristic result.
      if (out.ok) {
        const score = out.value.verdict === "ok" ? Math.min(heuristic.score, 0.3) : Math.max(heuristic.score, 0.85);
        result = { verdict: out.value.verdict, score, reason: `ai:${out.value.reason.slice(0, 200)}`, source: "ai" };
      }
    }
  }
  if (ai) {
    await ai.store.setSpamScore({ telecomAccountId: m.telecomAccountId, targetType: "message", targetRef: m.messageId, ...result });
  }
  return result;
}
