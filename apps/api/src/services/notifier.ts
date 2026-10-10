import type { FastifyBaseLogger } from "fastify";

export type NotificationTemplate =
  | "number_inactivity_warning"
  | "number_quarantined"
  | "spend_guard_triggered"
  /** data.text: AI summary of the voicemail (push body). */
  | "voicemail_received"
  /** A caller left a message with the AI receptionist. */
  | "ai_receptionist_message";

/** Push/email delivery. Placeholder: logs only, until FCM/APNs and the email provider are wired. */
export interface Notifier {
  notify(userId: string, template: NotificationTemplate, data: Record<string, unknown>): Promise<void>;
}

export class LogNotifier implements Notifier {
  constructor(private readonly log: Pick<FastifyBaseLogger, "info">) {}
  async notify(userId: string, template: NotificationTemplate, data: Record<string, unknown>) {
    this.log.info({ userId, template, data }, "notification (placeholder)");
  }
}
