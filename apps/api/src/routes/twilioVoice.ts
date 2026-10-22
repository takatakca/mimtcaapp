import type { FastifyInstance } from "fastify";
import { isEmergencyNumber, normalizeHandle } from "@mimt/shared";
import type { AppDeps } from "../deps.js";
import { checkInboundCaps, checkOnNetCaps, checkVoiceCaps, effectiveCaps, exceedsDailySpend } from "../fraud/caps.js";
import { checkVoiceDestination } from "../fraud/destinations.js";
import { intlTimeLimitS, retailCentsPerMinute } from "../billing/rates.js";
import { CALL_ATTEMPT_RULES } from "../fraud/policy.js";
import { cubaSipUri } from "../lib/cuba.js";
import { classifyDestination, isDomesticZone, normalizeDialed } from "../lib/phone.js";
import { dayPeriod, monthPeriod } from "../lib/time.js";
import type { Call, PhoneNumber, TelecomAccount } from "../repo/types.js";
import { recordingAccountSid } from "../gateways/twilio.js";
import { scoreInboundCall } from "../ai/spam.js";
import { processVoicemailTranscript } from "../ai/voicemail.js";
import { transcribeVoicemail, transcriptLanguage, usesIntelligence } from "../services/voicemailTranscription.js";
import { pbxInbound, pbxOutbound } from "../pbx/engine.js";
import { getFeatures, HELD_STATES, outboundBlocked, setAccountStatus, usagePeriods } from "../services/accounts.js";
import { planOf } from "../plansConfig.js";
import { afterDialControls, inboundCallControls } from "../services/callControls.js";
import { queueVoicemailEmail } from "../services/email.js";
import { greetingPlayUrl } from "../services/greeting.js";
import { FREE_OUTBOUND_PAUSED_TWIML, freeOutboundBlock } from "../services/freeTier.js";
import { e911Ready } from "./e911.js";
import { NOT_IN_SERVICE, sayBilingual, sendTwiml, twilioParams, VoiceResponse } from "./twiml.js";

const RING_TIMEOUT_S = 25;
const VOICEMAIL_MAX_S = 120;
const MAX_CALL_S = 4 * 3600;
const ACTIVE_CALL_WINDOW_MS = MAX_CALL_S * 1000;
/** Rough domestic cost when Twilio has not reported a price yet (CAD per minute). */
const DOMESTIC_EST_CAD_PER_MIN = 0.02;

const REFUSALS = {
  unknown_user: ["Appel impossible. Veuillez vous reconnecter à l'application MIMT.", "This call cannot be placed. Please sign in to the MIMT app again."],
  invalid_number: ["Le numéro composé n'est pas valide.", "The number you dialed is not valid."],
  account_restricted: [
    "Les appels sortants sont suspendus sur ce compte. Communiquez avec le soutien MIMT.",
    "Outgoing calls are suspended on this account. Please contact MIMT support.",
  ],
  no_number: ["Choisissez d'abord un numéro MIMT pour faire des appels.", "Please choose a MIMT number before making calls."],
  e911_required: [
    "Avant d'appeler, enregistrez votre adresse 9-1-1 et acceptez l'avis 9-1-1 dans l'application.",
    "Before calling, register your 9-1-1 address and accept the 9-1-1 notice in the app.",
  ],
  minutes_exhausted: ["Vous avez utilisé toutes vos minutes ce mois-ci.", "You have used all your minutes this month."],
  on_net_minutes_exhausted: [
    "Vous avez utilisé vos minutes d'appels entre applications MIMT ce mois-ci. Passez à Essentiel pour continuer.",
    "You have used your MIMT app-to-app calling minutes this month. Upgrade to Essential to keep calling.",
  ],
  too_many_calls: ["Vous avez déjà un appel en cours.", "You already have a call in progress."],
  handle_unavailable: ["Cet utilisateur MIMT ne peut pas recevoir d'appel pour le moment.", "This MIMT user cannot take calls right now."],
  handle_required: ["Choisissez d'abord votre identifiant MIMT dans l'application.", "Please choose your MIMT handle in the app first."],
  destination_blocked: ["Cette destination n'est pas permise avec votre forfait.", "This destination is not allowed on your plan."],
  intl_no_credit: ["Votre crédit international est insuffisant.", "Your international credit is too low."],
  cuba_unavailable: [
    "Les appels vers Cuba passent par un second fournisseur qui n'est pas encore branché.",
    "Calls to Cuba use a second carrier that is not connected yet.",
  ],
  rate_limited: ["Trop d'appels en peu de temps. Réessayez plus tard.", "Too many calls in a short time. Please try again later."],
  free_outbound_paused: [FREE_OUTBOUND_PAUSED_TWIML.fr, FREE_OUTBOUND_PAUSED_TWIML.en],
} as const;
type Refusal = keyof typeof REFUSALS;

function refuse(reason: Refusal) {
  const vr = new VoiceResponse();
  const [fr, en] = REFUSALS[reason];
  sayBilingual(vr, fr, en);
  vr.hangup();
  return vr;
}

export async function twilioVoiceWebhooks(app: FastifyInstance, deps: AppDeps) {
  const { repo, config } = deps;
  const base = config.PUBLIC_BASE_URL.replace(/\/$/, "");

  async function callerNumberFor(accountId: string, requested?: string): Promise<PhoneNumber | null> {
    const numbers = (await repo.listNumbersByAccount(accountId)).filter((n) => HELD_STATES.has(n.state));
    return numbers.find((n) => n.e164 === requested) ?? numbers[0] ?? null;
  }

  async function logFraud(account: TelecomAccount, rule: string, details: Record<string, unknown>, action: "block" | "suspend" = "block") {
    await repo.addFraudEvent({ telecomAccountId: account.id, rule, score: action === "suspend" ? 100 : 50, action, details });
  }

  /**
   * 9-1-1 path. Runs before anything that can refuse a call: no caps, credit, plan, ack or account-status checks.
   * Lookups are best-effort; if they fail we still dial, with the fallback caller ID.
   */
  async function emergency(identity: string | null, callSid: string | undefined, requestedCallerId: string | undefined) {
    let callerId: string | undefined = config.EMERGENCY_FALLBACK_CALLER_ID;
    let account: TelecomAccount | null = null;
    try {
      const user = identity ? await repo.getUser(identity) : null;
      account = user ? await repo.getAccountByOwner(user.id) : null;
      const n = account ? await callerNumberFor(account.id, requestedCallerId) : null;
      if (n) callerId = n.e164;
    } catch (err) {
      app.log.error({ err }, "9-1-1 caller lookup failed; dialing with fallback caller ID");
    }
    const vr = new VoiceResponse();
    vr.dial(callerId ? { callerId } : {}).number("911");

    app.log.warn({ callSid, identity, hasCallerId: Boolean(callerId) }, "9-1-1 call placed");
    try {
      if (callSid) {
        await repo.upsertCall({
          twilioCallSid: callSid,
          telecomAccountId: account?.id ?? null,
          userId: identity && account ? account.ownerUserId : null,
          direction: "outbound",
          kind: "emergency",
          fromNumber: callerId ?? "unknown",
          toNumber: "911",
          status: "initiated",
          startedAt: deps.now(),
        });
      }
      await repo.audit({ actorUserId: account?.ownerUserId ?? null, action: "call.emergency", targetType: "call", targetId: callSid });
    } catch (err) {
      app.log.error({ err, callSid }, "failed to record 9-1-1 call");
    }
    return vr;
  }

  /**
   * App-to-app call by handle. Same fair use as calls to a MIMT number (Twilio bills each app leg): the free
   * plan's on-net pool, paid plans' outbound minutes. The callee's block list applies; the callee's app is told
   * the caller's handle (custom parameter fromHandle), never their user id.
   */
  async function callByHandle(user: { id: string }, account: TelecomAccount, dialed: string, callSid: string | undefined) {
    const now = deps.now();
    if (outboundBlocked(account)) return refuse("account_restricted");
    const mine = await repo.handles.forUser(user.id);
    if (!mine) return refuse("handle_required");
    const handle = normalizeHandle(dialed);
    const target = handle ? await repo.handles.find(handle) : null;
    if (!target || target.handle === mine.handle) return refuse("invalid_number");
    const targetAccount = await repo.getAccount(target.telecomAccountId);
    if (!targetAccount || targetAccount.status === "SUSPENDED" || targetAccount.status === "CLOSED") return refuse("handle_unavailable");
    if (await repo.callControls.isBlocked(target.telecomAccountId, mine.handle)) return refuse("handle_unavailable");
    const okMinute = await deps.rateLimiter.take(`call:m:${account.id}`, CALL_ATTEMPT_RULES.minute);
    if (!okMinute || !(await deps.rateLimiter.take(`call:h:${account.id}`, CALL_ATTEMPT_RULES.hour))) {
      await logFraud(account, "call_attempt_rate", { to: "handle" });
      return refuse("rate_limited");
    }
    const { plan, trialing } = await getFeatures(repo, account.id);
    const onNet = checkOnNetCaps({ caps: effectiveCaps(plan, account.riskTier, account.createdAt, now, trialing), usage: await repo.getUsage(account.id, monthPeriod(now)) });
    if (!onNet.ok) return refuse("on_net_minutes_exhausted");
    if (callSid) {
      await repo.upsertCall({
        twilioCallSid: callSid,
        telecomAccountId: account.id,
        userId: user.id,
        direction: "outbound",
        kind: "app",
        fromNumber: mine.handle,
        toNumber: target.handle,
        status: "initiated",
        startedAt: now,
      });
    }
    const vr = new VoiceResponse();
    const client = vr.dial({ answerOnBridge: true, timeout: RING_TIMEOUT_S, timeLimit: Math.min(onNet.remaining * 60, MAX_CALL_S) }).client();
    client.identity(targetAccount.ownerUserId);
    client.parameter({ name: "fromHandle", value: mine.handle });
    return vr;
  }

  // TwiML App voice URL: calls placed from the MIMT app (From=client:<userId>).
  app.post("/webhooks/twilio/voice/outbound", async (req, reply) => {
    const p = twilioParams(req);
    const dialed = p.To ?? "";
    const identity = p.From?.startsWith("client:") ? p.From.slice("client:".length) : null;

    if (isEmergencyNumber(dialed)) return sendTwiml(reply, await emergency(identity, p.CallSid, p.CallerId));

    const user = identity ? await repo.getUser(identity) : null;
    const account = user && user.status === "active" ? await repo.getAccountByOwner(user.id) : null;
    if (!user || !account) return sendTwiml(reply, refuse("unknown_user"));

    // MIMT Affaires: extensions, business DIDs and calls on behalf of a business. Runs after the 9-1-1 path.
    const business = await pbxOutbound(deps, app.log, { user, consumerAccount: account, dialed, callSid: p.CallSid, callerId: p.CallerId });
    if (business) return sendTwiml(reply, business);

    // "@nom": MIMT-to-MIMT call by handle, app to app, no phone number needed on either side.
    if (dialed.trim().startsWith("@")) return sendTwiml(reply, await callByHandle(user, account, dialed, p.CallSid));

    const to = normalizeDialed(dialed);
    if (!to) return sendTwiml(reply, refuse("invalid_number"));
    if (outboundBlocked(account)) return sendTwiml(reply, refuse("account_restricted"));

    const now = deps.now();
    const caller = await callerNumberFor(account.id, p.CallerId);
    const record = (kind: Call["kind"], fromNumber: string) =>
      p.CallSid
        ? repo.upsertCall({
            twilioCallSid: p.CallSid,
            telecomAccountId: account.id,
            userId: user.id,
            direction: "outbound",
            kind,
            fromNumber,
            toNumber: to,
            status: "initiated",
            startedAt: now,
          })
        : Promise.resolve();

    // App-to-app: rings the other user's app directly, no phone network. Each app leg still costs Twilio, so it is
    // fair use: the free plan's own pool (FREE_ON_NET_MINUTES), paid plans' outbound minutes (fraud/caps.ts).
    const target = await repo.getNumberByE164(to);
    if (target?.telecomAccountId && HELD_STATES.has(target.state)) {
      const targetAccount = await repo.getAccount(target.telecomAccountId);
      if (targetAccount && targetAccount.status !== "SUSPENDED" && targetAccount.status !== "CLOSED") {
        const { plan, trialing } = await getFeatures(repo, account.id);
        const onNet = checkOnNetCaps({ caps: effectiveCaps(plan, account.riskTier, account.createdAt, now, trialing), usage: await repo.getUsage(account.id, monthPeriod(now)) });
        if (!onNet.ok) return sendTwiml(reply, refuse("on_net_minutes_exhausted"));
        await record("app", caller?.e164 ?? `client:${user.id}`);
        const vr = new VoiceResponse();
        vr.dial({
          answerOnBridge: true,
          timeout: RING_TIMEOUT_S,
          timeLimit: Math.min(onNet.remaining * 60, MAX_CALL_S),
          ...(caller ? { callerId: caller.e164 } : {}),
        }).client(targetAccount.ownerUserId);
        return sendTwiml(reply, vr);
      }
    }

    if (!caller) return sendTwiml(reply, refuse("no_number"));
    const e911 = await e911Ready(deps, user.id, account.id);
    if (!e911.address || !e911.ack) return sendTwiml(reply, refuse("e911_required"));

    const okMinute = await deps.rateLimiter.take(`call:m:${account.id}`, CALL_ATTEMPT_RULES.minute);
    const okHour = okMinute && (await deps.rateLimiter.take(`call:h:${account.id}`, CALL_ATTEMPT_RULES.hour));
    if (!okHour) {
      await logFraud(account, "call_attempt_rate", { to });
      return sendTwiml(reply, refuse("rate_limited"));
    }

    const today = await repo.getUsage(account.id, dayPeriod(now));
    if (exceedsDailySpend(today.spendCad, config.DAILY_SPEND_ALERT_CAD)) {
      await suspendForSpend(account, today.spendCad);
      return sendTwiml(reply, refuse("account_restricted"));
    }

    const { plan, features, trialing } = await getFeatures(repo, account.id);
    // Free plan: international only with bought credit, and only to the short free-plan list (fraud/destinations.ts).
    const freePlan = plan === "free";
    // Free-tier cost guard (services/freeTier.ts). 9-1-1 and app-to-app calls were handled above and never get here.
    if (freePlan) {
      const paused = await freeOutboundBlock(deps, now);
      if (paused) {
        await logFraud(account, paused, { to });
        return sendTwiml(reply, refuse("free_outbound_paused"));
      }
    }
    const dest = checkVoiceDestination(to, { entitled: features.has("intl_calling"), creditCents: account.intlCreditCents }, { freePlan });
    if (!dest.ok) {
      if (dest.reason === "invalid_number") return sendTwiml(reply, refuse("invalid_number"));
      await logFraud(account, `destination_${dest.reason}`, { to, zone: dest.zone });
      return sendTwiml(reply, refuse(dest.reason === "intl_no_credit" ? "intl_no_credit" : "destination_blocked"));
    }

    const caps = effectiveCaps(plan, account.riskTier, account.createdAt, now, trialing);
    const activeCalls = await repo.countActiveCalls(account.id, new Date(now.getTime() - ACTIVE_CALL_WINDOW_MS));
    let timeLimit: number;
    if (isDomesticZone(dest.zone)) {
      const check = checkVoiceCaps({ caps, usage: await repo.getUsage(account.id, monthPeriod(now)), activeCalls });
      if (!check.ok) return sendTwiml(reply, refuse(check.reason === "too_many_calls" ? "too_many_calls" : "minutes_exhausted"));
      timeLimit = Math.min(check.remaining * 60, MAX_CALL_S);
    } else {
      if (activeCalls >= caps.concurrentCalls) return sendTwiml(reply, refuse("too_many_calls"));
      const centsPerMinute = retailCentsPerMinute(to, config.INTL_ASSUMED_RATE_CENTS_PER_MIN);
      timeLimit = intlTimeLimitS({ creditCents: account.intlCreditCents, centsPerMinute, freePlan, maxCallS: MAX_CALL_S });
      if (timeLimit < 60) return sendTwiml(reply, refuse("intl_no_credit"));
    }

    if (dest.zone === "cuba" && !cubaSipUri(to, config.CUBA_SIP_HOST)) {
      return sendTwiml(reply, refuse("cuba_unavailable"));
    }

    await record("pstn", caller.e164);
    const vr = new VoiceResponse();
    const dial = vr.dial({ callerId: caller.e164, timeLimit, answerOnBridge: true });
    if (dest.zone === "cuba") dial.sip(cubaSipUri(to, config.CUBA_SIP_HOST)!);
    else dial.number(to);
    return sendTwiml(reply, vr);
  });

  async function suspendForSpend(account: TelecomAccount, spendCad: number) {
    if (account.status === "OUTBOUND_SUSPENDED") return;
    await setAccountStatus(repo, account, "OUTBOUND_SUSPENDED", "daily_spend_guard");
    await logFraud(account, "daily_spend_guard", { spendCad, limitCad: config.DAILY_SPEND_ALERT_CAD }, "suspend");
    await deps.notifier.notify(account.ownerUserId, "spend_guard_triggered", { spendCad });
  }

  // Number voice URL: PSTN calls to a MIMT number ring the owner's apps, then go to voicemail.
  app.post("/webhooks/twilio/voice/inbound", async (req, reply) => {
    const p = twilioParams(req);
    // Business DID: the PBX routes it (hours, IVR, ring groups…). Labels only; nothing here blocks a call.
    const business = await pbxInbound(deps, { to: p.To, from: p.From, callSid: p.CallSid });
    if (business) {
      const call = p.CallSid ? await repo.getCallBySid(p.CallSid) : null;
      if (call?.telecomAccountId && call.direction === "inbound") scheduleSpamScore(call.telecomAccountId, p.CallSid!, p.From, p.StirVerstat);
      return sendTwiml(reply, business);
    }
    const number = p.To ? await repo.getNumberByE164(p.To) : null;
    const account = number?.telecomAccountId && HELD_STATES.has(number.state) ? await repo.getAccount(number.telecomAccountId) : null;
    if (!number || !account || account.status === "SUSPENDED" || account.status === "CLOSED") {
      const vr = new VoiceResponse();
      sayBilingual(vr, NOT_IN_SERVICE.fr, NOT_IN_SERVICE.en);
      vr.hangup();
      return sendTwiml(reply, vr);
    }
    const now = deps.now();
    // Consumer call controls (services/callControls.ts): blocks, do not disturb, forwarding.
    const controls = await inboundCallControls(deps, { account, number, from: p.From, callSid: p.CallSid, now });
    if (controls.reject) return sendTwiml(reply, controls.reject);
    if (p.CallSid) {
      await repo.upsertCall({
        twilioCallSid: p.CallSid,
        telecomAccountId: account.id,
        userId: account.ownerUserId,
        direction: "inbound",
        kind: "pstn",
        fromNumber: p.From ?? "unknown",
        toNumber: number.e164,
        status: "ringing",
        startedAt: now,
      });
      scheduleSpamScore(account.id, p.CallSid, p.From, p.StirVerstat);
    }
    const { plan, trialing } = await getFeatures(repo, account.id);
    const caps = effectiveCaps(plan, account.riskTier, account.createdAt, now, trialing);
    if (!checkInboundCaps({ caps, usage: await repo.getUsage(account.id, monthPeriod(now)) }).ok) {
      return sendTwiml(reply, await voicemail(number, account));
    }
    if (controls.voicemail) return sendTwiml(reply, await voicemail(number, account));
    if (controls.forward) return sendTwiml(reply, controls.forward);
    const vr = new VoiceResponse();
    vr.dial({
      timeout: controls.ringTimeoutS ?? RING_TIMEOUT_S,
      answerOnBridge: true,
      action: `${base}/webhooks/twilio/voice/dial-result?n=${number.id}`,
      method: "POST",
    }).client(account.ownerUserId);
    return sendTwiml(reply, vr);
  });

  /** « Spam probable » label, computed off the request path. */
  function scheduleSpamScore(telecomAccountId: string, callSid: string, from: string | undefined, stirVerstat: string | undefined) {
    deps.ai?.background("spam:call", () => scoreInboundCall(deps, { callSid, telecomAccountId, from, stirVerstat }));
  }

  async function voicemail(number: PhoneNumber, account: TelecomAccount) {
    const { features } = await getFeatures(repo, account.id);
    const vr = new VoiceResponse();
    // Custom greeting (paid plans) or the default French-first greeting; greetingPlayUrl never throws.
    const greeting = await greetingPlayUrl(deps, account.id, features, app.log);
    if (greeting) vr.play(greeting);
    else
      sayBilingual(
        vr,
        "Bonjour, vous avez joint la messagerie vocale. Laissez votre message après le signal.",
        "Hello, you have reached voicemail. Please leave a message after the tone.",
      );
    vr.record({
      maxLength: VOICEMAIL_MAX_S,
      playBeep: true,
      action: `${base}/webhooks/twilio/voice/hangup`,
      method: "POST",
      recordingStatusCallback: `${base}/webhooks/twilio/voice/recording?n=${number.id}`,
      recordingStatusCallbackMethod: "POST",
      recordingStatusCallbackEvent: ["completed"],
      ...(features.has("vm_transcription") && deps.config.VOICEMAIL_TRANSCRIPTION !== "off" && !usesIntelligence(deps)
        ? { transcribe: true, transcribeCallback: `${base}/webhooks/twilio/voice/transcription` }
        : {}),
    });
    return vr;
  }

  // <Dial action>: answered calls end here; unanswered ones go to voicemail.
  app.post("/webhooks/twilio/voice/dial-result", async (req, reply) => {
    const p = twilioParams(req);
    const numberId = (req.query as { n?: string }).n;
    const controlled = await afterDialControls(deps, { numberId, forwarded: (req.query as { fw?: string }).fw === "1", params: p });
    if (controlled) return sendTwiml(reply, controlled);
    if (p.DialCallStatus === "completed") return sendTwiml(reply, hangupResponse());
    const number = numberId ? await repo.getNumber(numberId) : null;
    const account = number?.telecomAccountId ? await repo.getAccount(number.telecomAccountId) : null;
    if (!number || !account) return sendTwiml(reply, hangupResponse());
    return sendTwiml(reply, await voicemail(number, account));
  });

  app.post("/webhooks/twilio/voice/hangup", async (_req, reply) => sendTwiml(reply, hangupResponse()));

  // Call status callback (TwiML App status URL and number status URL).
  app.post("/webhooks/twilio/voice/status", async (req, reply) => {
    const p = twilioParams(req);
    const call = p.CallSid ? await repo.getCallBySid(p.CallSid) : null;
    if (!call) return reply.code(204).send();
    const status = p.CallStatus ?? call.status;
    const terminal = ["completed", "busy", "failed", "no-answer", "canceled"].includes(status);
    const durationS = p.CallDuration ? Number(p.CallDuration) : call.durationS;
    const price = p.Price ? Math.abs(Number(p.Price)) : null;
    const priceUnit = p.PriceUnit ?? null;
    const ratedCad = price === null ? null : price * (priceUnit === "CAD" ? 1 : config.USD_TO_CAD);
    await repo.updateCall(call.id, {
      status,
      ...(terminal ? { endedAt: deps.now() } : {}),
      durationS,
      ...(price !== null ? { price, priceUnit, ratedCad } : {}),
    });
    if (status === "completed" && !call.usageApplied && call.telecomAccountId) {
      await applyCallUsage(call, durationS ?? 0, ratedCad);
    }
    return reply.code(204).send();
  });

  async function applyCallUsage(call: Call, durationS: number, ratedCad: number | null) {
    const account = await repo.getAccount(call.telecomAccountId!);
    if (!account) return;
    await repo.updateCall(call.id, { usageApplied: true });
    const now = deps.now();
    if (call.direction === "outbound" && call.kind !== "emergency") {
      const n = await repo.getNumberByE164(call.fromNumber);
      if (n && n.telecomAccountId === account.id) await repo.updateNumber(n.id, { lastActivityAt: now });
    }
    if (call.kind === "app" && call.direction === "outbound") {
      // App-to-app minutes: the free plan's own pool, or paid plans' outbound minutes (fraud/caps.ts checkOnNetCaps).
      const appMinutes = Math.ceil(durationS / 60);
      if (appMinutes <= 0) return;
      const { plan } = await getFeatures(repo, account.id);
      const ownPool = planOf(plan).caps.onNetMinutes !== null;
      await repo.addUsage(account.id, usagePeriods(now), ownPool ? { minutesOnNet: appMinutes } : { minutesOut: appMinutes });
      return;
    }
    if (call.kind !== "pstn") return;

    const minutes = Math.ceil(durationS / 60);
    if (call.direction === "inbound") {
      await repo.addUsage(account.id, usagePeriods(now), { minutesIn: minutes, spendCad: ratedCad ?? minutes * DOMESTIC_EST_CAD_PER_MIN });
    } else if (isDomesticZone(classifyDestination(call.toNumber))) {
      await repo.addUsage(account.id, usagePeriods(now), { minutesOut: minutes, spendCad: ratedCad ?? minutes * DOMESTIC_EST_CAD_PER_MIN });
    } else {
      const cost = ratedCad ?? (minutes * config.INTL_ASSUMED_RATE_CENTS_PER_MIN) / 100;
      await repo.addUsage(account.id, usagePeriods(now), { spendCad: cost, intlSpendCad: cost });
      // The customer pays the retail rate shown by GET /v1/rates, never less than the carrier cost Twilio reported.
      const retailCents = minutes * retailCentsPerMinute(call.toNumber, config.INTL_ASSUMED_RATE_CENTS_PER_MIN);
      const carrierCents = ratedCad === null ? 0 : Math.ceil(ratedCad * 100);
      const debit = Math.min(Math.max(carrierCents, retailCents), account.intlCreditCents);
      if (debit > 0) await repo.addIntlCredit(account.id, -debit);
    }
    const today = await repo.getUsage(account.id, dayPeriod(now));
    if (exceedsDailySpend(today.spendCad, config.DAILY_SPEND_ALERT_CAD)) await suspendForSpend(account, today.spendCad);
  }

  // Voicemail recording finished.
  app.post("/webhooks/twilio/voice/recording", async (req, reply) => {
    const p = twilioParams(req);
    const numberId = (req.query as { n?: string }).n;
    if (p.RecordingStatus && p.RecordingStatus !== "completed") return reply.code(204).send();
    const number = numberId ? await repo.getNumber(numberId) : null;
    if (!number?.telecomAccountId || !p.RecordingSid || !p.CallSid) return reply.code(204).send();
    const call = await repo.getCallBySid(p.CallSid);
    const vm = await repo.createVoicemail({
      telecomAccountId: number.telecomAccountId,
      phoneNumberId: number.id,
      callSid: p.CallSid,
      recordingSid: p.RecordingSid,
      fromNumber: call?.fromNumber ?? null,
      audioUrl: p.RecordingUrl ?? null,
      durationS: p.RecordingDuration ? Number(p.RecordingDuration) : null,
    });
    if (deps.media && deps.twilio && p.RecordingSid) {
      try {
        const accountSid = recordingAccountSid(p.RecordingUrl);
        const audio = await deps.twilio.fetchRecording({ recordingSid: p.RecordingSid, ...(accountSid ? { accountSid } : {}) });
        const audioPath = `${number.telecomAccountId}/${p.RecordingSid}.mp3`;
        await deps.media.put(audioPath, audio.body, audio.contentType);
        await repo.updateVoicemailByRecordingSid(p.RecordingSid, { audioPath });
        const twilio = deps.twilio;
        const recordingSid = p.RecordingSid;
        const deleteRecording = () => twilio.deleteRecording({ recordingSid, ...(accountSid ? { accountSid } : {}) });
        const account = await repo.getAccount(number.telecomAccountId);
        const owner = account ? await repo.getUser(account.ownerUserId) : null;
        if (usesIntelligence(deps) && (await getFeatures(repo, number.telecomAccountId)).features.has("vm_transcription")) {
          // French or English transcript; the Twilio recording is deleted once it is done (inside).
          void transcribeVoicemail(deps, { recordingSid, language: transcriptLanguage(owner?.locale), deleteRecording }, req.log);
        } else {
          await deleteRecording();
        }
      } catch (err) {
        req.log.error({ err, voicemailId: vm.id }, "voicemail copy to private storage failed");
      }
    }
    await queueVoicemailEmail(deps, number.telecomAccountId, vm.id, req.log);
    return reply.code(204).send();
  });

  // Twilio's built-in transcription (English only), used when VOICEMAIL_TRANSCRIPTION=builtin.
  app.post("/webhooks/twilio/voice/transcription", async (req, reply) => {
    const p = twilioParams(req);
    if (p.RecordingSid && p.TranscriptionStatus === "completed") {
      const vm = await repo.updateVoicemailByRecordingSid(p.RecordingSid, { transcript: p.TranscriptionText ?? null, transcriptLang: "en" });
      // AI summary (needs vm_transcription, the "ai_processing" consent and budget; checked inside).
      if (vm?.transcript && deps.ai?.gateway) deps.ai.background("voicemail:summary", () => processVoicemailTranscript(deps, vm));
    }
    return reply.code(204).send();
  });
}

function hangupResponse() {
  const vr = new VoiceResponse();
  vr.hangup();
  return vr;
}
