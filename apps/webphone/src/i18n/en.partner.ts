// English — « MIMT Connect », Partner section of the business portal (docs/MIMT-CONNECT.md). Same keys as fr.partner.ts.
import type { frPartner } from "./fr.partner";

export const enPartner: Record<keyof typeof frPartner, string> = {
  "biz.nav.partner": "Partner",
  "partner.title": "MIMT Connect",
  "partner.lead": "Connect your own system (website, CRM) to your MIMT phone system: API keys, signed webhooks and credits.",
  "partner.notPartner": "This business is not a MIMT Connect partner yet. Write to us to turn it on.",
  "partner.suspended": "The partner account is suspended: the API refuses its keys for now.",

  "partner.credits.title": "Credits",
  "partner.credits.balance": "{credits} credits",
  "partner.credits.rate": "{credits} credit(s) per started minute, when a member answers.",
  "partner.credits.empty": "No credits left: calls still ring but are not billed. Contact MIMT to top up.",

  "partner.keys.title": "API keys",
  "partner.keys.lead": "Each key is shown only once. MIMT keeps only its fingerprint.",
  "partner.keys.label": "Key name (optional)",
  "partner.keys.create": "Create a key",
  "partner.keys.rotate": "Replace",
  "partner.keys.revoke": "Revoke",
  "partner.keys.revokeConfirm": "Revoke this key? API calls using it will be refused right away.",
  "partner.keys.revoked": "Revoked",
  "partner.keys.active": "Active",
  "partner.keys.lastUsed": "Last used: {date}",
  "partner.keys.neverUsed": "Never used",
  "partner.keys.empty": "No keys yet.",
  "partner.keys.shownOnce": "Copy this key now: it will never be shown again.",

  "partner.webhook.title": "Webhook",
  "partner.webhook.lead": "We send call.ringing, call.answered, call.completed and recording.ready to this https address, signed with X-MIMT-Signature.",
  "partner.webhook.url": "Webhook address (https)",
  "partner.webhook.save": "Save",
  "partner.webhook.remove": "Remove",
  "partner.webhook.rotate": "New signing secret",
  "partner.webhook.saved": "Webhook saved.",
  "partner.webhook.secret": "Signing secret, shown only once:",

  "partner.calls.title": "Latest calls",
  "partner.calls.empty": "No calls yet.",
  "partner.calls.member": "Member",
  "partner.calls.nobody": "Nobody answered",
  "partner.calls.credits": "{credits} credits",
  "partner.billing.billed": "Billed",
  "partner.billing.partial": "Partly billed",
  "partner.billing.unbilled": "Not billed",
  "partner.billing.free": "Free",
  "partner.billing.pending": "In progress",

  "partner.copy": "Copy",
  "partner.copied": "Copied.",
};
