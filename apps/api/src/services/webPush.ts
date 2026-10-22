import webpush from "web-push";
import { MIMT_HANDLE, type Locale } from "@mimt/shared";
import type { MessageCipher } from "../lib/crypto.js";
import { E164 } from "../lib/phone.js";
import type { Repository } from "../repo/types.js";
import type { NotificationTemplate, Notifier } from "./notifier.js";

/** How long an incoming-call push may be delivered, and how long the lock screen should keep it. */
export const INCOMING_CALL_TTL_S = 60;

/**
 * Web Push for app.mimt.ca. The VAPID key pair is created on first use and kept ENCRYPTED in server_keys
 * (MessageCipher), so nothing has to be configured by hand. Payloads are short and carry no message content
 * (Law 25: a lock screen is not private); the app fetches the details once opened.
 */
export interface Vapid {
  publicKey: string;
  privateKey: string;
}

const VAPID_KEY = "vapid";
const SUBJECT = "mailto:info@mimt.ca";

export async function vapidKeys(repo: Repository, cipher: MessageCipher): Promise<Vapid> {
  const stored = await repo.webPush.getKey(VAPID_KEY);
  if (stored) return JSON.parse(cipher.decrypt(stored)) as Vapid;
  const fresh = webpush.generateVAPIDKeys();
  // First writer wins if two instances race; everyone then uses the stored pair.
  const winner = await repo.webPush.putKeyOnce(VAPID_KEY, cipher.encrypt(JSON.stringify(fresh)));
  return JSON.parse(cipher.decrypt(winner)) as Vapid;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Path in app.mimt.ca to open on tap. */
  url: string;
  tag: string;
  /** Seconds until the push service drops it. The service worker closes the notification after the same delay. */
  ttl?: number;
}

/**
 * What a lock screen may show for a caller: an @handle or an E.164 number.
 * A user id, a Twilio client identity, or any other text is dropped.
 */
export function lockScreenCaller(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (MIMT_HANDLE.test(v)) return v;
  if (E164.test(v)) return v;
  return null;
}

/** What a notification says, French first. Never the text of a message or a voicemail. */
export function pushPayload(template: NotificationTemplate, data: Record<string, unknown>, locale: Locale): PushPayload | null {
  const fr = locale === "fr-CA";
  const from = typeof data.from === "string" ? data.from : null;
  switch (template) {
    case "message_received":
      return {
        title: fr ? "Nouveau texto" : "New text",
        body: from ? (fr ? `De ${from}` : `From ${from}`) : fr ? "Vous avez un nouveau texto." : "You have a new text.",
        url: from ? `/messages/${encodeURIComponent(from)}` : "/messages",
        tag: from ? `msg:${from}` : "msg",
      };
    case "voicemail_received":
      return { title: fr ? "Nouveau message vocal" : "New voicemail", body: fr ? "Écoutez-le dans MIMT." : "Listen in MIMT.", url: "/messagerie", tag: "vm" };
    case "ai_receptionist_message":
      return { title: fr ? "Message du réceptionniste IA" : "AI receptionist message", body: fr ? "Un appelant a laissé un message." : "A caller left a message.", url: "/messagerie", tag: "ai" };
    case "number_inactivity_warning":
      return { title: fr ? "Votre numéro MIMT" : "Your MIMT number", body: fr ? "Utilisez-le bientôt pour le garder." : "Use it soon to keep it.", url: "/compte", tag: "number" };
    case "incoming_call": {
      const who = lockScreenCaller(data.from);
      return {
        title: fr ? "Appel entrant" : "Incoming call",
        body: who ?? "",
        url: "/appels",
        tag: "call",
        ttl: INCOMING_CALL_TTL_S,
      };
    }
    default:
      return null;
  }
}

type Send = (sub: webpush.PushSubscription, payload: string, opts: webpush.RequestOptions) => Promise<unknown>;

/** Sends Web Push to every browser the user subscribed; drops subscriptions the push service says are gone. */
export class WebPushNotifier implements Notifier {
  constructor(
    private readonly deps: { repo: Repository; cipher: MessageCipher; log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void } },
    private readonly send: Send = webpush.sendNotification,
  ) {}

  async notify(userId: string, template: NotificationTemplate, data: Record<string, unknown>) {
    const { repo, cipher, log } = this.deps;
    const subs = await repo.webPush.listForUser(userId);
    if (!subs.length) return;
    const user = await repo.getUser(userId);
    const payload = pushPayload(template, data, user?.locale ?? "fr-CA");
    if (!payload) return;
    const vapid = await vapidKeys(repo, cipher);
    const opts: webpush.RequestOptions = {
      vapidDetails: { subject: SUBJECT, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
      TTL: payload.ttl ?? 3600,
      urgency: "high",
    };
    await Promise.all(
      subs.map(async (s) => {
        try {
          await this.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), opts);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) await repo.webPush.deleteByEndpoint(s.endpoint);
          else log.warn({ template, status }, "web push failed");
        }
      }),
    );
    // Never log who or what: only that a template went out.
    log.info({ template, devices: subs.length }, "web push sent");
  }
}
