// "Continuer avec TAKATAK": OAuth 2.0 authorization code + PKCE in the browser (public client, no
// secret). The browser only ever sees a one-time `code`; the MIMT API exchanges it server-to-server
// (POST /v1/auth/takatak/exchange) and returns MIMT session tokens.
import { env } from "../env";
import { createPkcePair, randomUrlSafe } from "./pkce";

const PENDING_KEY = "mimt.oauth.pending";
export const CALLBACK_PATH = "/auth/callback";

/** An OAuth return route must stay inside this application, never be a protocol-relative URL. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) {
    return "/accueil";
  }
  // A direct callback/authentication loop is also an invalid post-login destination.
  if (/^\/(?:auth\/|connexion(?:\/|$|\?|#))/.test(value)) return "/accueil";
  return value;
}

interface PendingAuth {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  /** Where to go after sign-in. */
  returnTo: string;
  createdAt: number;
}

export function isTakatakConfigured(): boolean {
  return Boolean(env.takatakIssuer && env.takatakClientId);
}

export function redirectUri(origin = window.location.origin): string {
  return `${origin}${CALLBACK_PATH}`;
}

/** OIDC discovery, with the conventional path as fallback. */
async function authorizationEndpoint(): Promise<string> {
  try {
    const res = await fetch(`${env.takatakIssuer}/.well-known/openid-configuration`);
    if (res.ok) {
      const doc = (await res.json()) as { authorization_endpoint?: string };
      if (doc.authorization_endpoint) return doc.authorization_endpoint;
    }
  } catch {
    // Fall through.
  }
  return `${env.takatakIssuer}/oauth/authorize`;
}

export function buildAuthorizeUrl(
  endpoint: string,
  p: { clientId: string; redirectUri: string; challenge: string; state: string; nonce: string; locale: string },
): string {
  const u = new URL(endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("scope", "openid profile email phone");
  u.searchParams.set("code_challenge", p.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", p.state);
  u.searchParams.set("nonce", p.nonce);
  u.searchParams.set("ui_locales", p.locale);
  return u.toString();
}

/** Stores the verifier/state for this tab and sends the browser to TAKATAK. */
export async function startTakatakSignIn(locale: string, returnTo = "/"): Promise<void> {
  const pkce = await createPkcePair();
  const pending: PendingAuth = {
    state: randomUrlSafe(16),
    nonce: randomUrlSafe(16),
    verifier: pkce.verifier,
    redirectUri: redirectUri(),
    returnTo: safeReturnTo(returnTo),
    createdAt: Date.now(),
  };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  const endpoint = await authorizationEndpoint();
  window.location.assign(
    buildAuthorizeUrl(endpoint, {
      clientId: env.takatakClientId,
      redirectUri: pending.redirectUri,
      challenge: pkce.challenge,
      state: pending.state,
      nonce: pending.nonce,
      locale,
    }),
  );
}

export type CallbackResult =
  | { ok: true; code: string; verifier: string; redirectUri: string; nonce: string; returnTo: string }
  | { ok: false; reason: "cancelled" | "state_mismatch" | "missing" | "expired" };

/** Reads ?code&state (or ?error) and the stored PKCE data. Single use: clears the stored data. */
export function readCallback(search: string, now = Date.now()): CallbackResult {
  const params = new URLSearchParams(search);
  let pending: PendingAuth | null = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null") as PendingAuth | null;
  } catch {
    pending = null;
  }
  sessionStorage.removeItem(PENDING_KEY);
  if (params.get("error")) return { ok: false, reason: "cancelled" };
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state || !pending) return { ok: false, reason: "missing" };
  if (state !== pending.state) return { ok: false, reason: "state_mismatch" };
  if (!Number.isFinite(pending.createdAt) || pending.createdAt > now + 60_000 || now - pending.createdAt > 10 * 60_000) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, code, verifier: pending.verifier, redirectUri: pending.redirectUri, nonce: pending.nonce, returnTo: safeReturnTo(pending.returnTo) };
}
