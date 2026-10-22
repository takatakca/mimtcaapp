import type { FastifyBaseLogger } from "fastify";

export type NotificationTemplate =
  | "number_inactivity_warning"
  | "number_quarantined"
  | "spend_guard_triggered"
  /** data.text: AI summary of the voicemail (push body). */
  | "voicemail_received"
  /** A caller left a message with the AI receptionist. */
  | "ai_receptionist_message"
  /** data.months, data.plan: a referral earned a free month. */
  | "referral_reward"
  /** data.from: number or @handle of the sender. Never the text itself. */
  | "message_received"
  /** The app is ringing. data.from: @handle or E.164 only. Never a user id or message text. */
  | "incoming_call";

/** Push/email delivery. A placeholder is NOT delivery; never log notification payloads. */
export interface Notifier {
  notify(userId: string, template: NotificationTemplate, data: Record<string, unknown>): Promise<void>;
}

export class LogNotifier implements Notifier {
  constructor(private readonly log: Pick<FastifyBaseLogger, "info">) {}
  async notify(_userId: string, template: NotificationTemplate, _data: Record<string, unknown>) {
    // Voicemail summaries, caller numbers, AI content and customer identifiers must
    // never appear in logs, even when delivery has not yet been configured.
    this.log.info({ template, delivered: false }, "notification not delivered: push provider not configured");
  }
}
