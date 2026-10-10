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
};

export function errorKeyFor(status: number | null, code?: string | null): TKey {
  if (code && CODE_TO_KEY[code]) return CODE_TO_KEY[code];
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
