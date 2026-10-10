// Map API and network failures to translated messages (pure, unit-tested).
import type { TKey } from "../i18n/core";

const CODE_TO_KEY: Record<string, TKey> = {
  cap_reached: "error.capReached",
  usage_cap_reached: "error.capReached",
  e911_required: "error.e911Required",
  invalid_code: "error.invalidCode",
  otp_invalid: "error.invalidCode",
  number_unavailable: "error.numberTaken",
  number_taken: "error.numberTaken",
  feature_required: "error.featureRequired",
  plan_required: "error.featureRequired",
  validation_error: "error.validation",
  rate_limited: "error.rateLimited",
  // Codes sent by apps/api (body: { error, message }).
  invalid_request: "error.validation",
  e911_address_required: "error.e911Required",
  e911_ack_required: "error.e911Required",
  sms_quota_exhausted: "error.capReached",
  mms_not_in_plan: "error.featureRequired",
  intl_requires_paid_plan: "error.featureRequired",
  number_limit_reached: "error.featureRequired",
  new_recipient_limit: "error.rateLimited",
  bulk_identical_blocked: "error.rateLimited",
  not_implemented: "error.notImplemented",
  device_attestation_required: "error.deviceRequired",
  reward_pending: "error.rewardPending",
  vm_greeting_not_in_plan: "error.featureRequired",
  vm_email_not_in_plan: "error.featureRequired",
  media_too_large: "error.mediaTooLarge",
  unsupported_media_type: "error.mediaInvalid",
  invalid_media: "error.mediaInvalid",
  media_not_uploaded: "error.mediaInvalid",
  media_already_used: "error.mediaInvalid",
  no_email: "error.noEmail",
  no_number: "error.noNumber",
};

export function errorKeyFor(status: number | null, code?: string | null): TKey {
  if (code && CODE_TO_KEY[code]) return CODE_TO_KEY[code];
  if (status === null || status === 0) return "error.network";
  if (status === 401) return "error.session";
  if (status === 402) return "error.capReached";
  if (status === 403) return "error.forbidden";
  if (status === 404) return "error.notFound";
  if (status === 400 || status === 422) return "error.validation";
  if (status === 429) return "error.rateLimited";
  if (status === 501) return "error.notImplemented";
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
