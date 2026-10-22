import type { FastifyInstance, FastifyRequest } from "fastify";
import { MMS_MAX_ATTACHMENTS, MMS_MAX_TOTAL_BYTES, type ConversationsResponse, type MessageDto, type MessageMediaDto, type MessagesResponse } from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser } from "../auth/guard.js";
import { checkSmsCaps, effectiveCaps, exceedsDailySpend, NEW_ACCOUNT_DAYS } from "../fraud/caps.js";
import { checkSmsDestination } from "../fraud/destinations.js";
import { BULK_IDENTICAL_RECIPIENTS, BULK_IDENTICAL_WINDOW_MS, looksLikeOtp, NEW_RECIPIENTS_PER_HOUR, SMS_RATE_RULES } from "../fraud/policy.js";
import { badRequest, forbidden, HttpError, notConfigured } from "../lib/errors.js";
import { E164, normalizeDialed, smsSegments } from "../lib/phone.js";
import { dayPeriod, daysBetween, monthPeriod } from "../lib/time.js";
import { decodeCursor, encodeCursor } from "../lib/cursor.js";
import { parse } from "../lib/validate.js";
import { spamLabelOf } from "../ai/spam.js";
import type { Message, TelecomAccount } from "../repo/types.js";
import { getFeatures, HELD_STATES, outboundBlocked, setAccountStatus, usagePeriods } from "../services/accounts.js";
import { claimUpload, mediaByMessage, mediaDto, signedMediaUrl } from "../services/media.js";
import { FREE_OUTBOUND_PAUSED_MESSAGE, freeOutboundBlock } from "../services/freeTier.js";
import type { MediaObject } from "../repo/mediaTypes.js";
import { MIMT_HANDLE, normalizeHandle } from "@mimt/shared";

/** Handle-to-handle texts: no carrier, no quota, but the same anti-abuse limits as texts. */
const ONNET_RATE_RULES = SMS_RATE_RULES;

/** Twilio fetches outbound MMS media through GET /v1/media/:id; it may retry for a while. */
const OUTBOUND_MEDIA_URL_TTL_S = 2 * 3600;

const SendBody = z
  .object({
    /** Our number. Omitted for a handle-to-handle text (to = "@nom"): the sender's own handle is used. */
    from: z.string().regex(E164).optional(),
    to: z.string().min(3).max(32),
    body: z.string().max(1600),
    mediaUrls: z.array(z.url().startsWith("https://")).max(5).optional(),
    mediaIds: z.array(z.uuid()).max(MMS_MAX_ATTACHMENTS).optional(),
  })
  .refine((b) => b.body.length > 0 || Boolean(b.mediaIds?.length), { message: "body is required without media", path: ["body"] });

export function messageDto(deps: AppDeps, m: Message, media?: MessageMediaDto[]): MessageDto {
  return {
    ...(media?.length ? { media } : {}),
    id: m.id,
    direction: m.direction,
    ourNumber: m.ourNumber,
    peer: m.peer,
    body: deps.cipher.decrypt(m.bodyEncrypted),
    status: m.status,
    segments: m.segments,
    numMedia: m.numMedia,
    createdAt: m.createdAt.toISOString(),
  };
}

export async function messageRoutes(app: FastifyInstance, deps: AppDeps) {
  const { repo, config } = deps;
  const base = config.PUBLIC_BASE_URL.replace(/\/$/, "");
  const auth = { preHandler: requireUser(deps) };

  async function block(account: TelecomAccount, rule: string, status: number, code: string, action: "block" | "hold" = "block"): Promise<never> {
    await repo.addFraudEvent({ telecomAccountId: account.id, rule, score: action === "block" ? 60 : 30, action, details: {} });
    throw new HttpError(status, code);
  }

  /**
   * MIMT-to-MIMT text by handle: stored for both people, never sent to the carrier, free and unlimited on every
   * plan. Anti-abuse: rate limits, bulk identical bodies, the recipient's block list.
   */
  async function sendOnNet(req: FastifyRequest, body: z.infer<typeof SendBody>) {
    const { user, account } = await loadContext(deps, req);
    const now = deps.now();
    if (outboundBlocked(account)) throw forbidden("account_restricted");
    if (body.mediaIds?.length || body.mediaUrls?.length) throw badRequest("media_not_supported", "Les photos entre identifiants MIMT arrivent bientôt.");
    const mine = await repo.handles.forUser(user.id);
    if (!mine) throw forbidden("handle_required", "Choisissez d'abord votre identifiant MIMT.");
    const toHandle = normalizeHandle(body.to);
    if (!toHandle) throw badRequest("invalid_handle");
    const target = await repo.handles.find(toHandle);
    if (!target) throw new HttpError(404, "handle_not_found", "Aucun utilisateur MIMT avec cet identifiant.");
    if (target.handle === mine.handle) throw badRequest("cannot_text_yourself");

    for (const [window, rule] of Object.entries(ONNET_RATE_RULES)) {
      if (!(await deps.rateLimiter.take(`onnet:${window}:${account.id}`, rule))) await block(account, `onnet_rate_${window}`, 429, "rate_limited", "hold");
    }
    const fingerprint = deps.cipher.fingerprint(body.body);
    const sameBody = await repo.countFingerprintRecipientsSince(account.id, fingerprint, new Date(now.getTime() - BULK_IDENTICAL_WINDOW_MS));
    if (sameBody >= BULK_IDENTICAL_RECIPIENTS) await block(account, "onnet_bulk_identical", 429, "bulk_identical_blocked");

    const encrypted = deps.cipher.encrypt(body.body);
    const message = await repo.createMessage({
      twilioSid: null,
      telecomAccountId: account.id,
      direction: "outbound",
      ourNumber: mine.handle,
      peer: target.handle,
      bodyEncrypted: encrypted,
      bodyFingerprint: fingerprint,
      status: "delivered",
      segments: 1,
      numMedia: 0,
    });
    // The recipient's block list applies (they never see it; the sender is not told).
    if (!(await repo.callControls.isBlocked(target.telecomAccountId, mine.handle))) {
      await repo.createMessage({
        twilioSid: null,
        telecomAccountId: target.telecomAccountId,
        direction: "inbound",
        ourNumber: target.handle,
        peer: mine.handle,
        bodyEncrypted: encrypted,
        bodyFingerprint: fingerprint,
        status: "received",
        segments: 1,
        numMedia: 0,
      });
      void deps.notifier.notify(target.userId, "message_received", { from: mine.handle }).catch(() => undefined);
    }
    return message;
  }

  /**
   * Number-to-number text where the recipient's number is held by MIMT: stored for both people, never sent to the
   * carrier, no message quota. Same anti-abuse limits as on-net handle texts; the recipient's block list applies.
   */
  async function deliverOnNetNumber(account: TelecomAccount, from: { id: string; e164: string }, toAccountId: string, to: string, text: string) {
    const now = deps.now();
    for (const [window, rule] of Object.entries(ONNET_RATE_RULES)) {
      if (!(await deps.rateLimiter.take(`onnet:${window}:${account.id}`, rule))) await block(account, `onnet_rate_${window}`, 429, "rate_limited", "hold");
    }
    const fingerprint = deps.cipher.fingerprint(text);
    const sameBody = await repo.countFingerprintRecipientsSince(account.id, fingerprint, new Date(now.getTime() - BULK_IDENTICAL_WINDOW_MS));
    if (sameBody >= BULK_IDENTICAL_RECIPIENTS) await block(account, "onnet_bulk_identical", 429, "bulk_identical_blocked");

    const encrypted = deps.cipher.encrypt(text);
    const segments = smsSegments(text);
    const message = await repo.createMessage({
      twilioSid: null,
      telecomAccountId: account.id,
      direction: "outbound",
      ourNumber: from.e164,
      peer: to,
      bodyEncrypted: encrypted,
      bodyFingerprint: fingerprint,
      status: "delivered",
      segments,
      numMedia: 0,
    });
    await repo.updateNumber(from.id, { lastActivityAt: now });
    if (!(await repo.callControls.isBlocked(toAccountId, from.e164))) {
      await repo.createMessage({
        twilioSid: null,
        telecomAccountId: toAccountId,
        direction: "inbound",
        ourNumber: to,
        peer: from.e164,
        bodyEncrypted: encrypted,
        bodyFingerprint: fingerprint,
        status: "received",
        segments,
        numMedia: 0,
      });
      const owner = await repo.getAccount(toAccountId);
      if (owner) void deps.notifier.notify(owner.ownerUserId, "message_received", { from: from.e164 }).catch(() => undefined);
    }
    return message;
  }

  app.post("/v1/messages", auth, async (req, reply) => {
    const body = parse(SendBody, req.body);
    if (body.to.trim().startsWith("@")) return reply.code(201).send(messageDto(deps, await sendOnNet(req, body)));
    if (!body.from) throw badRequest("from_required", "Choose the number to send from");
    const { account } = await loadContext(deps, req);
    const now = deps.now();

    if (outboundBlocked(account)) throw forbidden("account_restricted");
    const from = await repo.getNumberByE164(body.from);
    if (!from || from.telecomAccountId !== account.id || !HELD_STATES.has(from.state)) throw forbidden("not_your_number");
    const to = normalizeDialed(body.to);
    if (!to) throw badRequest("invalid_number");
    const dest = checkSmsDestination(to);
    if (!dest.ok) throw forbidden(dest.reason, "SMS is limited to Canada and the US");
    if (await repo.isOptedOut(from.e164, to)) throw forbidden("recipient_opted_out");

    const { plan, features, trialing } = await getFeatures(repo, account.id);
    if ((body.mediaUrls?.length || body.mediaIds?.length) && !features.has("mms")) throw forbidden("mms_not_in_plan");
    const target = await repo.getNumberByE164(to);
    const appToApp = Boolean(target?.telecomAccountId && HELD_STATES.has(target.state) && target.id !== from.id);
    // Text to another MIMT number: delivered through the database, never through the carrier (free, no quota).
    if (appToApp && target?.telecomAccountId && !body.mediaUrls?.length && !body.mediaIds?.length) {
      return reply.code(201).send(messageDto(deps, await deliverOnNetNumber(account, from, target.telecomAccountId, to, body.body)));
    }
    // Free-tier cost guard (services/freeTier.ts): texts to other MIMT numbers (app-to-app) stay allowed.
    if (plan === "free") {
      const paused = appToApp ? null : await freeOutboundBlock(deps, now);
      if (paused) throw forbidden(paused, FREE_OUTBOUND_PAUSED_MESSAGE);
    }
    if (!deps.twilio) throw notConfigured("Messaging");
    if (body.mediaIds?.length && !deps.mediaFiles) throw notConfigured("Media storage");

    const isNewAccount = daysBetween(account.createdAt, now) < NEW_ACCOUNT_DAYS || account.riskTier === "new" || account.riskTier === "high";
    const scale = (n: number) => (isNewAccount ? Math.max(1, Math.floor(n / 2)) : n);
    for (const [window, rule] of Object.entries(SMS_RATE_RULES)) {
      if (!(await deps.rateLimiter.take(`sms:${window}:${account.id}`, { ...rule, capacity: scale(rule.capacity) }))) {
        await block(account, `sms_rate_${window}`, 429, "rate_limited", "hold");
      }
    }
    if (!(await repo.hasOutboundTo(account.id, to, now))) {
      const fresh = await repo.countNewRecipientsSince(account.id, new Date(now.getTime() - 3600_000));
      if (fresh >= scale(NEW_RECIPIENTS_PER_HOUR)) await block(account, "sms_new_recipient_velocity", 429, "new_recipient_limit", "hold");
    }
    const fingerprint = deps.cipher.fingerprint(body.body);
    if (body.body) {
      const sameBody = await repo.countFingerprintRecipientsSince(account.id, fingerprint, new Date(now.getTime() - BULK_IDENTICAL_WINDOW_MS));
      if (sameBody >= BULK_IDENTICAL_RECIPIENTS) await block(account, "sms_bulk_identical", 429, "bulk_identical_blocked");
    }
    if (plan === "free" && looksLikeOtp(body.body)) await block(account, "sms_otp_content", 403, "otp_content_blocked");

    const segments = smsSegments(body.body);
    const caps = effectiveCaps(plan, account.riskTier, account.createdAt, now, trialing);
    const isMms = Boolean(body.mediaUrls?.length || body.mediaIds?.length);
    const cap = checkSmsCaps({ caps, usage: await repo.getUsage(account.id, monthPeriod(now)), segments, mms: isMms });
    if (!cap.ok) {
      if (cap.reason === "mms_exhausted") throw forbidden("mms_quota_exhausted", "Monthly MMS allowance used");
      throw forbidden("sms_quota_exhausted", "Monthly message allowance used (sent and received)");
    }
    const today = await repo.getUsage(account.id, dayPeriod(now));
    if (exceedsDailySpend(today.spendCad, config.DAILY_SPEND_ALERT_CAD)) {
      await setAccountStatus(repo, account, "OUTBOUND_SUSPENDED", "daily_spend_guard");
      await block(account, "daily_spend_guard", 403, "account_restricted");
    }

    // Uploaded media: checked (owner, size, magic bytes) only now, after every fraud and cap check.
    const uploads: MediaObject[] = [];
    for (const id of new Set(body.mediaIds ?? [])) uploads.push(await claimUpload(deps, account.id, id, "mms"));
    if (uploads.reduce((n, m) => n + (m.sizeBytes ?? 0), 0) > MMS_MAX_TOTAL_BYTES) throw new HttpError(413, "media_too_large", "MMS is limited to 5 MB");
    const mediaUrls = [...(body.mediaUrls ?? [])];
    for (const m of uploads) mediaUrls.push((await signedMediaUrl(deps, m.id, OUTBOUND_MEDIA_URL_TTL_S)).url);

    let sent: { sid: string; status: string; segments: number };
    try {
      sent = await deps.twilio.sendMessage({
        from: from.e164,
        to,
        body: body.body,
        ...(mediaUrls.length ? { mediaUrls } : {}),
        statusCallback: `${base}/webhooks/twilio/sms/status`,
      });
    } catch (err) {
      req.log.error({ err }, "Twilio send failed");
      throw new HttpError(502, "send_failed", "The message could not be sent");
    }

    const message = await repo.createMessage({
      twilioSid: sent.sid,
      telecomAccountId: account.id,
      direction: "outbound",
      ourNumber: from.e164,
      peer: to,
      bodyEncrypted: deps.cipher.encrypt(body.body),
      bodyFingerprint: fingerprint,
      status: sent.status,
      segments: sent.segments,
      numMedia: mediaUrls.length,
    });
    const attached: MessageMediaDto[] = [];
    for (const m of uploads) {
      const linked = await repo.media.updateMedia(m.id, { messageId: message.id });
      if (linked) attached.push(await mediaDto(deps, linked));
    }
    await repo.addUsage(account.id, usagePeriods(now), { smsOut: sent.segments, ...(mediaUrls.length ? { mmsOut: 1 } : {}) });
    await repo.updateNumber(from.id, { lastActivityAt: now });
    return reply.code(201).send(messageDto(deps, message, attached));
  });

  app.get("/v1/conversations", auth, async (req): Promise<ConversationsResponse> => {
    const { account } = await loadContext(deps, req);
    const conversations = await repo.listConversations(account.id);
    return {
      conversations: conversations.map((c) => ({
        peer: c.peer,
        ourNumber: c.ourNumber,
        lastMessageAt: c.lastMessageAt.toISOString(),
        lastMessage: { id: c.lastMessageId, direction: c.lastDirection, preview: deps.cipher.decrypt(c.lastBodyEncrypted).slice(0, 120) },
      })),
    };
  });

  app.get("/v1/conversations/:peer/messages", auth, async (req): Promise<MessagesResponse> => {
    const { peer } = parse(z.object({ peer: z.string().refine((p) => E164.test(p) || MIMT_HANDLE.test(p), "phone number or @handle") }), req.params);
    const q = parse(z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }), req.query);
    const { account } = await loadContext(deps, req);
    const rows = await repo.listMessages(account.id, peer, { limit: q.limit + 1, ...(q.cursor ? { before: toBefore(decodeCursor(q.cursor)) } : {}) });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    const spam = deps.ai ? await deps.ai.store.getSpamScores("message", page.filter((m) => m.direction === "inbound").map((m) => m.id)) : new Map();
    const media = await mediaByMessage(deps, page);
    const withLabel = (m: Message) => {
      const label = spamLabelOf(spam.get(m.id));
      return { ...messageDto(deps, m, media.get(m.id)), ...(label ? { spamLabel: label } : {}) };
    };
    return { messages: page.map(withLabel), nextCursor: rows.length > q.limit && last ? encodeCursor(last.createdAt, last.id) : null };
  });
}

const toBefore = (c: { at: Date; id: string }) => ({ createdAt: c.at, id: c.id });
