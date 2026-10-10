import { importPKCS8, SignJWT } from "jose";
import type { Config } from "../config.js";

export type AttestResult = "ok" | "invalid" | "not_configured";

export interface AttestInput {
  platform: "ios" | "android";
  challenge: string;
  assertion: string;
  deviceKey: string;
}

export interface DeviceVerifier {
  verify(input: AttestInput): Promise<AttestResult>;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export function readServiceAccount(json: string | undefined): ServiceAccount | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<ServiceAccount>;
    if (!parsed.client_email || !parsed.private_key) return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, "\n"), token_uri: parsed.token_uri };
  } catch {
    return null;
  }
}

/** OAuth access token for a Google service account. The private key is never logged. */
export async function googleAccessToken(account: ServiceAccount, scope: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const key = await importPKCS8(account.private_key, "RS256");
  const assertion = await new SignJWT({ scope })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(account.client_email)
    .setSubject(account.client_email)
    .setAudience(account.token_uri ?? "https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const res = await fetchImpl(account.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`google token HTTP ${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("google token missing");
  return json.access_token;
}

interface IntegrityPayload {
  tokenPayloadExternal?: {
    requestDetails?: { nonce?: string };
    appIntegrity?: { appRecognitionVerdict?: string };
    deviceIntegrity?: { deviceRecognitionVerdict?: string[] };
  };
}

/** Play Integrity: the nonce must be our challenge, and the device must meet the basic verdict. */
export function playIntegrityOk(payload: IntegrityPayload, challenge: string): boolean {
  const token = payload.tokenPayloadExternal;
  if (!token) return false;
  if (token.requestDetails?.nonce !== challenge) return false;
  if (token.appIntegrity?.appRecognitionVerdict !== "PLAY_RECOGNIZED") return false;
  return token.deviceIntegrity?.deviceRecognitionVerdict?.includes("MEETS_DEVICE_INTEGRITY") === true;
}

/**
 * Outside production, `dev:<challenge>` is accepted so a development build can be tested
 * before Apple and Google accounts exist. Production never accepts that shortcut.
 */
export function createDeviceVerifier(config: Config, fetchImpl: typeof fetch = fetch): DeviceVerifier {
  return {
    async verify(input) {
      if (config.NODE_ENV !== "production" && input.assertion === `dev:${input.challenge}`) return "ok";
      if (input.platform === "ios") {
        // App Attest (CBOR attestation against Apple's App Attest root) still needs the team id and a device key.
        // Until that verifier is wired, production fails closed instead of trusting the client.
        return config.APPLE_TEAM_ID ? "invalid" : "not_configured";
      }
      const account = readServiceAccount(config.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
      if (!account || !config.GOOGLE_PLAY_PACKAGE_NAME) return "not_configured";
      try {
        const access = await googleAccessToken(account, "https://www.googleapis.com/auth/playintegrity", fetchImpl);
        const res = await fetchImpl(
          `https://playintegrity.googleapis.com/v1/${encodeURIComponent(config.GOOGLE_PLAY_PACKAGE_NAME)}:decodeIntegrityToken`,
          {
            method: "POST",
            headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
            body: JSON.stringify({ integrity_token: input.assertion }),
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (!res.ok) return "invalid";
        const payload = (await res.json()) as IntegrityPayload;
        return playIntegrityOk(payload, input.challenge) ? "ok" : "invalid";
      } catch {
        return "invalid";
      }
    },
  };
}
