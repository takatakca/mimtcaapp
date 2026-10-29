// Passkeys (WebAuthn) through @simplewebauthn/server. Wrapped behind a small gateway so the routes stay testable
// (tests inject a fake: the cryptography is the library's job, the policy around it is ours).
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { Config } from "../config.js";

export interface CredentialRef {
  /** base64url credential id. */
  id: string;
  transports?: string[];
}

export interface VerifiedCredential {
  credentialId: string;
  /** base64url COSE public key. */
  publicKey: string;
  counter: number;
  transports: string[];
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
}

export interface WebAuthnGateway {
  registrationOptions(input: { userId: string; userName: string; exclude: CredentialRef[] }): Promise<Record<string, unknown> & { challenge: string }>;
  /** null when the response does not verify. */
  verifyRegistration(input: { response: unknown; expectedChallenge: string }): Promise<VerifiedCredential | null>;
  authenticationOptions(input: { allow: CredentialRef[] }): Promise<Record<string, unknown> & { challenge: string }>;
  /** The new signature counter, or null when the assertion does not verify. */
  verifyAuthentication(input: {
    response: unknown;
    expectedChallenge: string;
    credential: CredentialRef & { publicKey: string; counter: number };
  }): Promise<{ newCounter: number } | null>;
}

const transports = (t?: string[]) => t as AuthenticatorTransportFuture[] | undefined;

export function createWebAuthn(config: Pick<Config, "WEBAUTHN_RP_ID" | "WEBAUTHN_ORIGINS" | "WEBAUTHN_RP_NAME">): WebAuthnGateway {
  const rpID = config.WEBAUTHN_RP_ID;
  const expectedOrigin = config.WEBAUTHN_ORIGINS;
  return {
    async registrationOptions({ userId, userName, exclude }) {
      return generateRegistrationOptions({
        rpName: config.WEBAUTHN_RP_NAME,
        rpID,
        userName,
        userDisplayName: userName,
        // The internal user id (a random UUID), never an email or a phone number.
        userID: new TextEncoder().encode(userId),
        attestationType: "none",
        excludeCredentials: exclude.map((c) => ({ id: c.id, transports: transports(c.transports) })),
        // Discoverable credential: passwordless sign-in without typing anything first.
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        timeout: 120_000,
      }) as unknown as Promise<Record<string, unknown> & { challenge: string }>;
    },
    async verifyRegistration({ response, expectedChallenge }) {
      try {
        const r = await verifyRegistrationResponse({
          response: response as RegistrationResponseJSON,
          expectedChallenge,
          expectedOrigin,
          expectedRPID: rpID,
          requireUserVerification: true,
        });
        if (!r.verified) return null;
        const { credential, credentialDeviceType, credentialBackedUp } = r.registrationInfo;
        return {
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey).toString("base64url"),
          counter: credential.counter,
          transports: credential.transports ?? [],
          deviceType: credentialDeviceType,
          backedUp: credentialBackedUp,
        };
      } catch {
        return null;
      }
    },
    async authenticationOptions({ allow }) {
      return generateAuthenticationOptions({
        rpID,
        userVerification: "required",
        allowCredentials: allow.map((c) => ({ id: c.id, transports: transports(c.transports) })),
        timeout: 120_000,
      }) as unknown as Promise<Record<string, unknown> & { challenge: string }>;
    },
    async verifyAuthentication({ response, expectedChallenge, credential }) {
      try {
        const r = await verifyAuthenticationResponse({
          response: response as AuthenticationResponseJSON,
          expectedChallenge,
          expectedOrigin,
          expectedRPID: rpID,
          requireUserVerification: true,
          credential: {
            id: credential.id,
            publicKey: new Uint8Array(Buffer.from(credential.publicKey, "base64url")),
            counter: credential.counter,
            transports: transports(credential.transports),
          },
        });
        return r.verified ? { newCounter: r.authenticationInfo.newCounter } : null;
      } catch {
        return null;
      }
    },
  };
}

/** The challenge a WebAuthn response was made for (clientDataJSON.challenge), or null. */
export function responseChallenge(response: unknown): string | null {
  const data = (response as { response?: { clientDataJSON?: unknown } } | null)?.response?.clientDataJSON;
  if (typeof data !== "string" || data.length > 8192) return null;
  try {
    const parsed = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as { challenge?: unknown };
    return typeof parsed.challenge === "string" && /^[A-Za-z0-9_-]{16,256}$/.test(parsed.challenge) ? parsed.challenge : null;
  } catch {
    return null;
  }
}

/** The credential id of a WebAuthn response (base64url), or null. */
export function responseCredentialId(response: unknown): string | null {
  const id = (response as { id?: unknown } | null)?.id;
  return typeof id === "string" && /^[A-Za-z0-9_-]{16,1024}$/.test(id) ? id : null;
}
