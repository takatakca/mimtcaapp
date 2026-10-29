// Demo mode (VITE_MOCK_API=1) of Paramètres › Sécurité: sessions, passkeys and step-up from memory. Simplified on
// purpose: the real checks (signed single-use challenges, WebAuthn verification, 10-minute window) live in
// apps/api/src/routes/security.ts.
import type { PasskeyDto, SecurityStatusResponse, SessionDto } from "@mimt/shared";

type Call = (method: string, path: string, body?: unknown) => Promise<Response>;

const json = (status: number, body: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const state = {
  sessions: [
    { id: "demo-session-current", current: true, method: "sms", device: "Chrome · Windows", network: "203.0.113.0/24", createdAt: ago(60 * 24 * 3), lastSeenAt: ago(0) },
    { id: "demo-session-phone", current: false, method: "passkey", device: "Safari · iOS", network: "198.51.100.0/24", createdAt: ago(60 * 24 * 12), lastSeenAt: ago(95) },
  ] as SessionDto[],
  passkeys: [] as PasskeyDto[],
  confirmedUntil: Date.now() + 10 * 60_000,
  requireStrongAuth: false,
};

const remaining = () => Math.max(0, Math.ceil((state.confirmedUntil - Date.now()) / 1000));
const needsStepUp = () => (remaining() > 0 ? null : json(403, { error: "step_up_required", message: "step-up required" }));
const options = () => ({ options: { challenge: `demo-${Math.random().toString(36).slice(2)}-challenge-000` }, challengeToken: "demo-challenge-token-0000" });


export async function securityMock(method: string, path: string, body: unknown, call: Call): Promise<Response> {
  const route = `${method} ${path}`;
  let m: RegExpExecArray | null;
  if (route === "GET /v1/me/sessions") return json(200, { sessions: state.sessions });
  if ((m = /^DELETE \/v1\/me\/sessions\/([^/]+)$/.exec(route))) {
    state.sessions = state.sessions.filter((s) => s.id !== decodeURIComponent(m![1]!));
    return json(204, undefined);
  }
  if (route === "POST /v1/me/sessions/revoke-others") {
    const revoked = state.sessions.filter((s) => !s.current).length;
    state.sessions = state.sessions.filter((s) => s.current);
    return json(200, { revoked });
  }
  if (route === "GET /v1/me/security") {
    const status: SecurityStatusResponse = {
      passkeys: state.passkeys.length,
      stepUpPhone: "•••-•••-0142",
      recentAuthRemainingS: remaining(),
      strongAuth: false,
      strongAuthRequiredByBusiness: state.requireStrongAuth,
      passkeysEnabled: true,
    };
    return json(200, status);
  }
  if (route === "GET /v1/me/passkeys") return json(200, { passkeys: state.passkeys });
  if (route === "POST /v1/me/passkeys/register/options") return needsStepUp() ?? json(200, options());
  if (route === "POST /v1/me/passkeys/register/verify") {
    const key: PasskeyDto = { id: `demo-key-${state.passkeys.length + 1}`, name: (body as { name?: string } | null)?.name ?? "Chrome · Windows", createdAt: new Date().toISOString(), lastUsedAt: null, backedUp: true };
    state.passkeys.push(key);
    return json(201, key);
  }
  if ((m = /^DELETE \/v1\/me\/passkeys\/([^/]+)$/.exec(route))) {
    const blocked = needsStepUp();
    if (blocked) return blocked;
    state.passkeys = state.passkeys.filter((k) => k.id !== decodeURIComponent(m![1]!));
    return json(204, undefined);
  }
  if (route === "POST /v1/auth/passkeys/options" || route === "POST /v1/auth/step-up/passkey/options") return json(200, options());
  // Demo sign-in with a passkey: same fixture tokens as the TAKATAK demo exchange.
  if (route === "POST /v1/auth/passkeys/verify") return call("POST", "/v1/auth/takatak/exchange", { code: "demo", codeVerifier: "demo", redirectUri: "https://mock.mimt.local" });
  if (route === "POST /v1/auth/step-up/sms/start") return json(202, { status: "pending", phone: "•••-•••-0142" });
  if (route === "POST /v1/auth/step-up/passkey/verify" || route === "POST /v1/auth/step-up/sms/verify") {
    state.confirmedUntil = Date.now() + 10 * 60_000;
    return json(200, { recentAuthRemainingS: remaining(), strongAuth: route.includes("passkey") });
  }
  if (/^GET \/v1\/business\/[^/]+\/security$/.test(route)) return json(200, { requireStrongAuth: state.requireStrongAuth });
  if (/^PUT \/v1\/business\/[^/]+\/security$/.test(route)) {
    const blocked = needsStepUp();
    if (blocked) return blocked;
    state.requireStrongAuth = Boolean((body as { requireStrongAuth?: boolean } | null)?.requireStrongAuth);
    return json(200, { requireStrongAuth: state.requireStrongAuth });
  }
  return json(404, { error: "not_found", message: route });
}
