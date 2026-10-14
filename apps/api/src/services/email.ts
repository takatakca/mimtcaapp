import type { FastifyBaseLogger } from "fastify";
import { VOICEMAIL_EMAIL_LINK_TTL_S } from "@mimt/shared";
import type { Config } from "../config.js";
import type { AppDeps } from "../deps.js";
import type { EmailOutboxItem } from "../repo/mediaTypes.js";
import { getFeatures } from "./accounts.js";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Transactional email (voicemail to email). Implementations must never log the body or links. */
export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}

/** "jean.tremblay@exemple.ca" → "j***@exemple.ca" for logs. */
export const maskEmail = (email: string) => email.replace(/^(.)[^@]*@/, "$1***@");

/** Fallback: explicitly records non-delivery without logging message content or caller identity. */
export class LogEmailSender implements EmailSender {
  constructor(private readonly log: Pick<FastifyBaseLogger, "info">) {}
  async send(msg: EmailMessage) {
    // The subject may contain a caller number; the body may include a transcript
    // and a signed audio URL. Neither belongs in logs.
    this.log.info({ delivered: false, channel: "email" }, "email not delivered: configure EMAIL_PROVIDER");
  }
}

/** Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email). Key from EMAIL_API_KEY. */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async send(msg: EmailMessage) {
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, text: msg.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`email provider answered HTTP ${res.status}`);
  }
}

export function createEmailSender(config: Config, log: Pick<FastifyBaseLogger, "info">): EmailSender {
  if (config.EMAIL_PROVIDER === "resend" && config.EMAIL_API_KEY) return new ResendEmailSender(config.EMAIL_API_KEY, config.EMAIL_FROM);
  return new LogEmailSender(log);
}

/** Emails wait this long so Twilio's transcription (a separate callback) is usually in. */
export const VOICEMAIL_EMAIL_DELAY_MS = 2 * 60_000;
const MAX_ATTEMPTS = 8;

/**
 * Queues "voicemail to email" when the account's plan has vm_email, the owner opted in and has an email.
 * Never throws: voicemail recording must not fail because of email.
 */
export async function queueVoicemailEmail(deps: AppDeps, accountId: string, voicemailId: string, log: Pick<FastifyBaseLogger, "error">): Promise<boolean> {
  try {
    const settings = await deps.repo.media.getVoicemailSettings(accountId);
    if (!settings?.emailEnabled) return false;
    const { features } = await getFeatures(deps.repo, accountId);
    if (!features.has("vm_email")) return false;
    const account = await deps.repo.getAccount(accountId);
    const owner = account ? await deps.repo.getUser(account.ownerUserId) : null;
    if (!owner?.email || owner.status !== "active") return false;
    await deps.repo.media.enqueueEmail({
      userId: owner.id,
      template: "voicemail_received",
      payload: { voicemailId },
      nextAttemptAt: new Date(deps.now().getTime() + VOICEMAIL_EMAIL_DELAY_MS),
    });
    return true;
  } catch (err) {
    log.error({ err, voicemailId }, "voicemail email could not be queued");
    return false;
  }
}

const fmtDuration = (s: number | null) => (s == null ? "?" : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`);

/** French first, then English. The audio link is a signed, expiring capability for this voicemail only. */
export function renderVoicemailEmail(input: {
  from: string | null;
  durationS: number | null;
  transcript: string | null;
  audioUrl: string | null;
  expiresAt: Date | null;
  receivedAt: Date;
}): { subject: string; text: string } {
  const from = input.from ?? "Numéro inconnu / Unknown number";
  const when = input.receivedAt.toLocaleString("fr-CA", { timeZone: "America/Toronto" });
  const expires = input.expiresAt?.toLocaleDateString("fr-CA", { timeZone: "America/Toronto" }) ?? "";
  const fr = [
    `Nouveau message vocal de ${from}`,
    `Reçu le ${when} · durée ${fmtDuration(input.durationS)}`,
    "",
    input.transcript ? `Transcription :\n${input.transcript}` : "Transcription non disponible.",
    "",
    input.audioUrl ? `Écouter le message (lien valide jusqu'au ${expires}) :\n${input.audioUrl}` : "L'enregistrement n'est plus disponible.",
    "",
    "Ne transférez pas ce courriel : le lien donne accès au message. Gérez cette option dans l'application MIMT, Messagerie vocale > Réglages.",
  ];
  const en = [
    `New voicemail from ${from}`,
    `Duration ${fmtDuration(input.durationS)}`,
    "",
    input.transcript ? "Transcript: see above." : "No transcript available.",
    input.audioUrl ? `Listen (link valid until ${expires}): same link as above.` : "The recording is no longer available.",
    "Do not forward this email: the link gives access to the message. Turn this off in the MIMT app, Voicemail > Settings.",
  ];
  return { subject: `Nouveau message vocal / New voicemail · ${from}`, text: [...fr, "", "—", "", ...en].join("\n") };
}

/** Sends due emails. Renders at send time so the transcript and link are fresh. Backoff 1 min → ~2 h. */
export async function deliverEmails(deps: AppDeps, log: Pick<FastifyBaseLogger, "warn" | "info">, now = deps.now()): Promise<{ sent: number; failed: number; skipped: number }> {
  const sender = deps.email ?? new LogEmailSender(log);
  const base = deps.config.PUBLIC_BASE_URL.replace(/\/$/, "");
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const item of await deps.repo.media.listDueEmails(now, 50)) {
    try {
      const msg = await buildEmail(deps, base, item);
      if (!msg) {
        // Voicemail deleted, user gone or opted out since: nothing to send.
        await deps.repo.media.markEmailSent(item.id, now);
        skipped++;
        continue;
      }
      await sender.send(msg);
      await deps.repo.media.markEmailSent(item.id, now);
      sent++;
    } catch (err) {
      failed++;
      const attempts = item.attempts + 1;
      const next = attempts >= MAX_ATTEMPTS ? null : new Date(now.getTime() + Math.min(60_000 * 2 ** item.attempts, 2 * 3600_000));
      await deps.repo.media.markEmailFailed(item.id, String(err instanceof Error ? err.message : err), next);
      log.warn({ emailId: item.id, attempts, dead: next === null }, "email delivery failed");
    }
  }
  return { sent, failed, skipped };
}

async function buildEmail(deps: AppDeps, base: string, item: EmailOutboxItem): Promise<EmailMessage | null> {
  if (item.template !== "voicemail_received") return null;
  const user = await deps.repo.getUser(item.userId);
  if (!user?.email || user.status !== "active") return null;
  const vm = await deps.repo.getVoicemail(String(item.payload.voicemailId ?? ""));
  if (!vm) return null;
  const settings = await deps.repo.media.getVoicemailSettings(vm.telecomAccountId);
  if (!settings?.emailEnabled) return null;
  const hasAudio = Boolean(vm.audioPath ?? vm.audioUrl);
  const signed = hasAudio ? await deps.sessions.signMedia(`voicemail:${vm.id}`, VOICEMAIL_EMAIL_LINK_TTL_S) : null;
  const rendered = renderVoicemailEmail({
    from: vm.fromNumber,
    durationS: vm.durationS,
    transcript: vm.transcript,
    audioUrl: signed ? `${base}/v1/voicemails/${vm.id}/audio?token=${encodeURIComponent(signed.token)}` : null,
    expiresAt: signed?.expiresAt ?? null,
    receivedAt: vm.createdAt,
  });
  return { to: user.email, ...rendered };
}
