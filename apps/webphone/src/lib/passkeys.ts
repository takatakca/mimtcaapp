// Passkeys in the browser (@simplewebauthn/browser): create one, or sign with one (sign-in or step-up).
// Loaded lazily so the WebAuthn helpers are not in the main bundle. In demo mode (VITE_MOCK_API=1) the fixture API
// accepts a fake response and the browser prompt is skipped.
import type { WebAuthnOptionsResponse } from "@mimt/shared";
import { env } from "../env";

/** Passkeys work in this browser (WebAuthn + platform support checks are left to the browser prompt). */
export function passkeysSupported(): boolean {
  if (env.mock) return true;
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

const fakeResponse = (challenge: string) => ({
  id: "ZGVtby1wYXNza2V5LTAwMDAwMQ",
  rawId: "ZGVtby1wYXNza2V5LTAwMDAwMQ",
  type: "public-key",
  response: { clientDataJSON: btoa(JSON.stringify({ challenge })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") },
  clientExtensionResults: {},
});

/** Runs the browser's « create a passkey » prompt; returns the RegistrationResponseJSON for the API. */
export async function createPasskey(o: WebAuthnOptionsResponse): Promise<Record<string, unknown>> {
  if (env.mock) return fakeResponse(String(o.options.challenge));
  const { startRegistration } = await import("@simplewebauthn/browser");
  return (await startRegistration({ optionsJSON: o.options as unknown as Parameters<typeof startRegistration>[0]["optionsJSON"] })) as unknown as Record<string, unknown>;
}

/** Runs the browser's « use a passkey » prompt; returns the AuthenticationResponseJSON for the API. */
export async function signWithPasskey(o: WebAuthnOptionsResponse): Promise<Record<string, unknown>> {
  if (env.mock) return fakeResponse(String(o.options.challenge));
  const { startAuthentication } = await import("@simplewebauthn/browser");
  return (await startAuthentication({ optionsJSON: o.options as unknown as Parameters<typeof startAuthentication>[0]["optionsJSON"] })) as unknown as Record<string, unknown>;
}

/** The user closed the browser prompt (or it timed out): not an error worth showing in red. */
export function isPasskeyCancel(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name;
  return name === "NotAllowedError" || name === "AbortError";
}
