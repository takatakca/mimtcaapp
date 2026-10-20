// Map API and network failures to translated French/English messages (pure, unit-tested).
import type { TKey } from "../i18n/core";

const CODE_TO_KEY: Record<string, TKey> = {
  cap_reached: "error.capReached",
  usage_cap_reached: "error.capReached",
  sms_quota_exhausted: "error.capReached",
  e911_required: "error.e911Required",
  e911_address_required: "error.e911Required",
  e911_ack_required: "error.e911Required",
  invalid_code: "error.invalidCode",
  otp_invalid: "error.invalidCode",
  number_unavailable: "error.numberTaken",
  number_taken: "error.numberTaken",
  feature_required: "error.featureRequired",
  plan_required: "error.featureRequired",
  mms_not_in_plan: "error.featureRequired",
  intl_requires_paid_plan: "error.featureRequired",
  number_limit_reached: "error.featureRequired",
  validation_error: "error.validation",
  invalid_request: "error.validation",
  rate_limited: "error.rateLimited",
  new_recipient_limit: "error.rateLimited",
  bulk_identical_blocked: "error.rateLimited",
  not_implemented: "error.notImplemented",
  not_configured: "error.notConfigured",
  not_a_member: "error.forbidden",
  insufficient_role: "error.forbidden",
  duplicate_extension: "error.duplicate",
  conflict: "error.duplicate",
  // Number port-in
  signature_name_mismatch: "error.portSignatureMismatch",
  port_in_exists: "error.portInExists",
  number_already_on_mimt: "error.numberAlreadyOnMimt",
  not_portable: "error.notPortable",
  pin_required: "error.portPinRequired",
  not_cancelable: "error.portLocked",
  already_signed: "error.portLocked",
  canadian_numbers_only: "error.canadianNumbersOnly",
  invalid_temporary_number: "error.validation",
  duplicate_numbers: "error.validation",
  // Codes sent by apps/api (business, AI and catalog routes).
  business_role_required: "error.forbidden",
  owner_immutable: "error.forbidden",
  admin_only: "error.forbidden",
  member_exists: "error.duplicate",
  extension_number_taken: "error.duplicate",
  seats_exceed_subscription: "error.seatsExceed",
  seats_below_members: "error.seatsBelow",
  invalid_media_token: "error.mediaExpired",
  ai_consent_required: "error.aiConsentRequired",
  ai_budget_exhausted: "error.aiBudgetExhausted",
  ai_unavailable: "error.aiUnavailable",
  no_transcript: "error.noTranscript",
  terms_not_accepted: "error.termsNotAccepted",
  contract_summary_required: "error.contractSummaryRequired",
  contract_summary_outdated: "error.contractSummaryOutdated",
  consumer_code_required: "error.consumerCodeRequired",
  credit_check_consent_required: "error.creditCheckRequired",
  invalid_postal_code: "address.invalidPostal",
  offer_not_available: "error.offerNotAvailable",
  order_not_ready: "error.orderNotReady",
  order_not_cancellable: "error.orderNotCancellable",
  invalid_transition: "error.orderChanged",
  order_changed: "error.orderChanged",
  porting_exists: "error.portingExists",
  invalid_phone_number: "messages.invalidTo",
  // Call controls and voicemail settings (callControls.ts, media.ts).
  cannot_block_emergency: "error.cannotBlockEmergency",
  block_limit: "error.blockLimit",
  forwarding_target_required: "settings.forwarding.targetRequired",
  forwarding_destination_not_allowed: "settings.forwarding.invalidTarget",
  vm_email_not_in_plan: "error.featureRequired",
  vm_greeting_not_in_plan: "error.featureRequired",
  no_email: "settings.vm.noEmail",
  unsupported_media_type: "settings.vm.badType",
  media_too_large: "settings.vm.tooBig",
  invalid_media: "settings.vm.badType",
  // Free-plan cost guard (apps/api/src/services/freeTier.ts).
  free_quota_reached: "error.freeQuotaReached",
  free_budget_reached: "error.freeOutboundPaused",
  free_outbound_disabled: "error.freeOutboundPaused",
  meeting_full: "error.meetingFull",
  meeting_ended: "error.meetingEnded",
  invite_expired: "error.inviteExpired",
  invalid_guest_token: "error.invalidGuestToken",
  meeting_unavailable: "error.invalidGuestToken",
  video_unavailable: "error.videoUnavailable",
  meeting_host_required: "error.meetingHostRequired",
  invalid_schedule: "error.validation",
};

export function errorKeyFor(status: number | null, code?: string | null): TKey {
  if (code && CODE_TO_KEY[code]) return CODE_TO_KEY[code];
  // Wholesaler refusals come back as provider_<code> (apps/api/src/catalog/orders.ts viaProvider).
  if (code?.startsWith("provider_")) return "error.providerRejected";
  if (status === null || status === 0) return "error.network";
  if (status === 401) return "error.session";
  if (status === 402) return "error.capReached";
  if (status === 403) return "error.forbidden";
  if (status === 404) return "error.notFound";
  if (status === 409) return "error.duplicate";
  if (status === 400 || status === 422) return "error.validation";
  if (status === 429) return "error.rateLimited";
  if (status === 501) return "error.notImplemented";
  if (status === 503) return "error.notConfigured";
  if (status >= 500) return "error.server";
  return "error.generic";
}

export class ApiClientError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string | null,
    readonly key: TKey,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export function toErrorKey(e: unknown): TKey {
  return e instanceof ApiClientError ? e.key : "error.generic";
}
