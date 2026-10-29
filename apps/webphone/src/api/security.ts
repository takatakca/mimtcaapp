// Security endpoints (Paramètres › Sécurité): sessions, passkeys, step-up. Shapes: packages/shared/src/security.ts;
// spec docs/MIMT-SECURITY.md.
import type {
  AuthTokensResponse,
  BusinessSecurityPolicy,
  PasskeyAuthRequest,
  PasskeyDto,
  PasskeyRegisterRequest,
  PasskeysResponse,
  RevokeOthersResponse,
  SecurityStatusResponse,
  SessionsResponse,
  StepUpResponse,
  StepUpSmsVerifyRequest,
  WebAuthnOptionsResponse,
} from "@mimt/shared";
import type { HttpClient } from "./http";

export function securityEndpoints(request: HttpClient["request"]) {
  return {
    sessions: () => request<SessionsResponse>("GET", "/v1/me/sessions"),
    revokeSession: (id: string) => request<void>("DELETE", `/v1/me/sessions/${encodeURIComponent(id)}`),
    revokeOtherSessions: () => request<RevokeOthersResponse>("POST", "/v1/me/sessions/revoke-others"),
    securityStatus: () => request<SecurityStatusResponse>("GET", "/v1/me/security"),
    passkeys: () => request<PasskeysResponse>("GET", "/v1/me/passkeys"),
    passkeyRegisterOptions: () => request<WebAuthnOptionsResponse>("POST", "/v1/me/passkeys/register/options"),
    passkeyRegisterVerify: (body: PasskeyRegisterRequest) => request<PasskeyDto>("POST", "/v1/me/passkeys/register/verify", { body }),
    deletePasskey: (id: string) => request<void>("DELETE", `/v1/me/passkeys/${encodeURIComponent(id)}`),
    passkeySignInOptions: () => request<WebAuthnOptionsResponse>("POST", "/v1/auth/passkeys/options", { auth: false }),
    passkeySignInVerify: (body: PasskeyAuthRequest) => request<AuthTokensResponse>("POST", "/v1/auth/passkeys/verify", { body, auth: false }),
    stepUpPasskeyOptions: () => request<WebAuthnOptionsResponse>("POST", "/v1/auth/step-up/passkey/options"),
    stepUpPasskeyVerify: (body: PasskeyAuthRequest) => request<StepUpResponse>("POST", "/v1/auth/step-up/passkey/verify", { body }),
    stepUpSmsStart: () => request<{ status: "pending"; phone: string }>("POST", "/v1/auth/step-up/sms/start"),
    stepUpSmsVerify: (body: StepUpSmsVerifyRequest) => request<StepUpResponse>("POST", "/v1/auth/step-up/sms/verify", { body }),
    businessSecurity: (businessId: string) => request<BusinessSecurityPolicy>("GET", `/v1/business/${encodeURIComponent(businessId)}/security`),
    setBusinessSecurity: (businessId: string, body: BusinessSecurityPolicy) =>
      request<BusinessSecurityPolicy>("PUT", `/v1/business/${encodeURIComponent(businessId)}/security`, { body }),
  };
}
