// English — « MIMT Connect » account links, MIMT user's side: /lier page and the « Partners » card of
// Account › Integrations (docs/MIMT-CONNECT.md). Same keys as fr.partnerLinks.ts.
import type { frPartnerLinks } from "./fr.partnerLinks";

export const enPartnerLinks: Record<keyof typeof frPartnerLinks, string> = {
  "partnerLink.title": "Link your account",
  "partnerLink.lead": "A MIMT partner asks to link your MIMT account to your profile on its service.",
  "partnerLink.codeLabel": "Code from the partner",
  "partnerLink.codeHint": "8 characters, valid 15 minutes.",
  "partnerLink.check": "Check the code",
  "partnerLink.ask": "{partner} wants to link your MIMT account to your profile (ID {externalId}).",
  "partnerLink.profile": "Profile: {name}",
  "partnerLink.canTitle": "Once linked, {partner} will be able to:",
  "partnerLink.perm.calls": "see the calls of its lines that are routed to you (numbers, times, durations);",
  "partnerLink.perm.click_to_call": "place calls on your behalf (your MIMT app rings first; you decide to answer);",
  "partnerLink.perm.number": "see and use the MIMT number you choose as the line for these calls.",
  "partnerLink.cannot": "It sees none of your texts, voicemails or other calls, and it cannot buy anything on your behalf.",
  "partnerLink.revocable": "You can remove this link at any time in Account › Integrations.",
  "partnerLink.approve": "Allow",
  "partnerLink.cancel": "Cancel",
  "partnerLink.done": "Your MIMT account is linked to {partner}.",
  "partnerLink.seeIntegrations": "See my integrations",
  "partnerLink.error.invalid": "This code is not valid. Check it and try again.",
  "partnerLink.error.expired": "This code has expired or was already used. Ask the partner for a new one.",
  "partnerLink.error.memberTaken": "This profile is already linked to another MIMT account.",
  "partnerLink.error.alreadyLinked": "Your account is already linked to another profile of this partner. Remove that link first.",

  "partners.title": "Partners",
  "partners.lead": "Services that can ring your MIMT apps and call on your behalf, with your consent.",
  "partners.empty": "No partner is linked to your account.",
  "partners.soon": "Partner links will be available soon.",
  "partners.item": "{partner} — profile {externalId}",
  "partners.line": "Line used: {number}",
  "partners.noLine": "No line chosen for this partner.",
  "partners.since": "Linked since {date}",
  "partners.revoke": "Remove link",
  "partners.revokeConfirm": "Remove the link with {partner}? It will no longer ring your apps or call on your behalf.",
  "partners.revoked": "The link was removed.",
};
