// Security: session inventory, passkeys (WebAuthn), step-up for sensitive actions, business strong-auth policy.
// API: apps/api/src/routes/security.ts. Spec and Law 25 notes: docs/MIMT-SECURITY.md.

/** How a session was opened. "legacy": a session that existed before the inventory (first refresh after the release). */
export type AuthMethod = "takatak" | "sms" | "passkey" | "legacy";

/** A recent authentication (passkey or fresh SMS code) unlocks sensitive actions for this long. */
export const STEP_UP_WINDOW_S = 10 * 60;

/** One signed-in device. Coarse on purpose (Law 25): browser/OS family and a /24 (IPv4) or /48 (IPv6) network only. */
export interface SessionDto {
  id: string;
  /** The session making this request. */
  current: boolean;
  method: AuthMethod;
  /** "Chrome · Windows", "Safari · iOS", "App MIMT · Android"; "Unknown" parts when the agent says nothing useful. */
  device: string;
  /** "203.0.113.0/24" or "2001:db8:1234::/48"; null when unknown. Never the full address. */
  network: string | null;
  createdAt: string;
  /** Updated at most every 5 minutes. */
  lastSeenAt: string;
}

/** GET /v1/me/sessions */
export interface SessionsResponse {
  sessions: SessionDto[];
}

/** POST /v1/me/sessions/revoke-others */
export interface RevokeOthersResponse {
  revoked: number;
}

/** GET /v1/me/security: what the Sécurité page needs. */
export interface SecurityStatusResponse {
  passkeys: number;
  /** The phone a step-up SMS code goes to, masked ("•••-•••-0123"); null when the account has no verified phone. */
  stepUpPhone: string | null;
  /** Seconds left in the current step-up window (0 when a step-up is needed). */
  recentAuthRemainingS: number;
  /** This session was confirmed with a passkey (sign-in or step-up). */
  strongAuth: boolean;
  /** A business where you are owner/admin requires a passkey (require_strong_auth). */
  strongAuthRequiredByBusiness: boolean;
  passkeysEnabled: boolean;
}

export interface PasskeyDto {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** Synced passkey (iCloud Keychain, Google Password Manager…) vs. bound to one device. */
  backedUp: boolean;
}

/** GET /v1/me/passkeys */
export interface PasskeysResponse {
  passkeys: PasskeyDto[];
}

/**
 * POST /v1/me/passkeys/register/options, /v1/auth/passkeys/options, /v1/auth/step-up/passkey/options.
 * `options` is the WebAuthn JSON (PublicKeyCredentialCreationOptionsJSON / RequestOptionsJSON) for
 * @simplewebauthn/browser; `challengeToken` comes back with the response (signed, single use, 5 minutes).
 */
export interface WebAuthnOptionsResponse {
  options: Record<string, unknown>;
  challengeToken: string;
}

/** POST /v1/me/passkeys/register/verify */
export interface PasskeyRegisterRequest {
  challengeToken: string;
  /** RegistrationResponseJSON from startRegistration(). */
  response: Record<string, unknown>;
  name?: string;
}

/** POST /v1/auth/passkeys/verify (sign-in, returns AuthTokensResponse) and /v1/auth/step-up/passkey/verify. */
export interface PasskeyAuthRequest {
  challengeToken: string;
  /** AuthenticationResponseJSON from startAuthentication(). */
  response: Record<string, unknown>;
}

/** POST /v1/auth/step-up/sms/verify */
export interface StepUpSmsVerifyRequest {
  code: string;
}

/** Answer of a successful step-up. */
export interface StepUpResponse {
  recentAuthRemainingS: number;
  strongAuth: boolean;
}

/** GET/PUT /v1/business/:id/security */
export interface BusinessSecurityPolicy {
  requireStrongAuth: boolean;
}

/** Error codes the security layer answers with (403 unless noted). */
export const SECURITY_ERROR_CODES = [
  "step_up_required",
  "strong_auth_required",
  "strong_auth_setup_required",
  "passkey_required_by_business",
  "session_revoked",
] as const;
