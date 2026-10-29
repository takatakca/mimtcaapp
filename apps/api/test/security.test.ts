// Security hardening (docs/MIMT-SECURITY.md): session inventory and revocation, step-up for sensitive actions,
// passkeys with a mocked WebAuthn verifier, the business « require_strong_auth » policy and security events.
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WebAuthnGateway } from "../src/auth/webauthn.js";
import { coarseIp, coarseUserAgent } from "../src/lib/clientInfo.js";
import { runSessionRetention } from "../src/jobs/sessionRetention.js";
import { pushPayload } from "../src/services/webPush.js";
import { makeUser, setup, type Ctx } from "./helpers.js";

const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const SAFARI_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const PHONE = "+15145550123";

let ctx: Ctx;
let clock: Date;
const tick = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};

/** Fake WebAuthn: the library's cryptography is mocked, everything around it (challenges, counters, policy) is real. */
function fakeWebAuthn(): WebAuthnGateway {
  const challenge = () => randomBytes(32).toString("base64url");
  return {
    async registrationOptions() {
      return { challenge: challenge(), rp: { id: "mimt.ca", name: "MIMT" } };
    },
    async verifyRegistration({ response }) {
      const r = response as { id: string; good?: boolean };
      return r.good ? { credentialId: r.id, publicKey: "cHVibGljLWtleQ", counter: 0, transports: ["internal"], deviceType: "multiDevice", backedUp: true } : null;
    },
    async authenticationOptions() {
      return { challenge: challenge(), rpId: "mimt.ca" };
    },
    async verifyAuthentication({ response, credential }) {
      return (response as { good?: boolean }).good ? { newCounter: credential.counter + 1 } : null;
    },
  };
}

const clientData = (challenge: string) => Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: "https://app.mimt.ca" })).toString("base64url");
const credResponse = (id: string, challenge: string, good = true) => ({ id, rawId: id, type: "public-key", good, response: { clientDataJSON: clientData(challenge) } });

beforeEach(async () => {
  clock = new Date("2026-10-29T12:00:00Z");
  ctx = await setup({ config: { TWILIO_VERIFY_SERVICE_SID: "VAtest" }, now: () => clock });
  ctx.deps.webauthn = fakeWebAuthn();
});
afterEach(() => ctx.app.close());

const call = (method: string, url: string, headers: Record<string, string> = {}, payload?: unknown) =>
  ctx.app.inject({ method: method as "GET", url, headers, ...(payload === undefined ? {} : { payload: payload as object }) });

/** Signs in by SMS code like the app does, from a given browser and address. */
async function smsSignIn(ua = CHROME_WIN, ip = "203.0.113.57") {
  const res = await ctx.app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { "user-agent": ua }, remoteAddress: ip, payload: { phone: PHONE, code: "123456" } });
  expect(res.statusCode).toBe(200);
  const t = res.json() as { accessToken: string; refreshToken: string };
  return { ...t, auth: { authorization: `Bearer ${t.accessToken}` } };
}

describe("coarse client information (Law 25)", () => {
  it("keeps only the browser and OS family", () => {
    expect(coarseUserAgent(CHROME_WIN)).toBe("Chrome · Windows");
    expect(coarseUserAgent(SAFARI_IOS)).toBe("Safari · iOS");
    expect(coarseUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/133.0")).toBe("Firefox · macOS");
    expect(coarseUserAgent("Mozilla/5.0 (Linux; Android 15) Chrome/131.0 Mobile Safari/537.36 EdgA/131.0")).toBe("Edge · Android");
    expect(coarseUserAgent(undefined)).toBe("Unknown · Unknown");
  });
  it("keeps a /24 or /48 network, never the address", () => {
    expect(coarseIp("203.0.113.57")).toBe("203.0.113.0/24");
    expect(coarseIp("::ffff:198.51.100.9")).toBe("198.51.100.0/24");
    expect(coarseIp("2001:db8:1234:5678::1")).toBe("2001:db8:1234::/48");
    expect(coarseIp("2001:db8::1")).toBe("2001:db8:0::/48");
    expect(coarseIp("not-an-ip")).toBeNull();
  });
});

describe("session inventory", () => {
  it("records each sign-in with a coarse device and network, and marks the current one", async () => {
    const a = await smsSignIn(CHROME_WIN, "203.0.113.57");
    const b = await smsSignIn(SAFARI_IOS, "198.51.100.9");
    const res = await call("GET", "/v1/me/sessions", a.auth);
    expect(res.statusCode).toBe(200);
    const sessions = res.json().sessions as Array<{ current: boolean; device: string; network: string; method: string }>;
    expect(sessions).toHaveLength(2);
    expect(sessions.find((s) => s.current)).toMatchObject({ device: "Chrome · Windows", network: "203.0.113.0/24", method: "sms" });
    expect(sessions.find((s) => !s.current)).toMatchObject({ device: "Safari · iOS", network: "198.51.100.0/24" });
    // Nothing the session inventory or its security events store holds the full address or the full user agent.
    const events = ctx.repo.auditLog.filter((e) => /^(auth|session|passkey)\./.test(e.action));
    const stored = JSON.stringify([...ctx.repo.security.sessions.values(), events]);
    expect(stored).not.toContain("203.0.113.57");
    expect(stored).not.toContain("AppleWebKit");
    expect((await call("GET", "/v1/me/sessions", b.auth)).json().sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
  });

  it("updates last_seen_at at most every 5 minutes", async () => {
    const a = await smsSignIn();
    const [s] = await ctx.repo.security.listActiveSessions((await ctx.repo.findUserByPhone(PHONE))!.id);
    tick(2 * 60_000);
    await call("GET", "/v1/me/sessions", a.auth);
    expect((await ctx.repo.security.getSession(s!.id))!.lastSeenAt.getTime()).toBe(s!.lastSeenAt.getTime());
    tick(4 * 60_000);
    await call("GET", "/v1/me/sessions", a.auth);
    expect((await ctx.repo.security.getSession(s!.id))!.lastSeenAt.getTime()).toBe(clock.getTime());
  });

  it("DELETE /v1/me/sessions/:id signs that device out at once: access token and refresh token", async () => {
    const a = await smsSignIn(CHROME_WIN);
    const b = await smsSignIn(SAFARI_IOS);
    const other = (await call("GET", "/v1/me/sessions", a.auth)).json().sessions.find((s: { current: boolean }) => !s.current);
    expect((await call("DELETE", `/v1/me/sessions/${other.id}`, a.auth)).statusCode).toBe(204);

    const denied = await call("GET", "/v1/me", b.auth);
    expect(denied.statusCode).toBe(401);
    expect(denied.json().error).toBe("session_revoked");
    expect((await call("POST", "/v1/auth/refresh", {}, { refreshToken: b.refreshToken })).statusCode).toBe(401);
    expect((await call("GET", "/v1/me", a.auth)).statusCode).toBe(200);
    expect(ctx.repo.auditLog.some((e) => e.action === "session.revoked" && e.targetId === other.id)).toBe(true);
    // Someone else's or an unknown session: 404.
    expect((await call("DELETE", `/v1/me/sessions/${other.id}`, a.auth)).statusCode).toBe(404);
    const stranger = await makeUser(ctx);
    expect((await call("DELETE", `/v1/me/sessions/${other.id}`, stranger.auth)).statusCode).toBe(404);
  });

  it("« Déconnecter partout ailleurs » keeps only the current session", async () => {
    const a = await smsSignIn(CHROME_WIN);
    const b = await smsSignIn(SAFARI_IOS);
    const c = await smsSignIn(SAFARI_IOS, "192.0.2.1");
    const res = await call("POST", "/v1/me/sessions/revoke-others", a.auth);
    expect(res.statusCode).toBe(200);
    expect(res.json().revoked).toBe(2);
    expect((await call("GET", "/v1/me", b.auth)).statusCode).toBe(401);
    expect((await call("GET", "/v1/me", c.auth)).statusCode).toBe(401);
    expect((await call("POST", "/v1/auth/refresh", {}, { refreshToken: c.refreshToken })).statusCode).toBe(401);
    expect((await call("GET", "/v1/me", a.auth)).statusCode).toBe(200);
    // The current session can still refresh.
    expect((await call("POST", "/v1/auth/refresh", {}, { refreshToken: a.refreshToken })).statusCode).toBe(200);
    expect((await call("GET", "/v1/me/sessions", a.auth)).json().sessions).toHaveLength(1);
  });

  it("logout revokes the session row too", async () => {
    const a = await smsSignIn();
    expect((await call("POST", "/v1/auth/logout", {}, { refreshToken: a.refreshToken })).statusCode).toBe(204);
    expect((await call("GET", "/v1/me", a.auth)).statusCode).toBe(401);
  });

  it("a refresh family from before the inventory gets a session row on its next refresh", async () => {
    const u = await makeUser(ctx);
    const familyId = crypto.randomUUID();
    const t = await ctx.deps.sessions.issue(u.user.id, familyId);
    ctx.repo.security.sessions.delete(familyId);
    const r = await call("POST", "/v1/auth/refresh", { "user-agent": CHROME_WIN }, { refreshToken: t.refreshToken });
    expect(r.statusCode).toBe(200);
    expect(await ctx.repo.security.getSession(familyId)).toMatchObject({ method: "legacy", userAgent: "Chrome · Windows", recentAuthAt: null });
  });

  it("deletes revoked or idle sessions after 90 days", async () => {
    const a = await smsSignIn();
    await call("POST", "/v1/me/sessions/revoke-others", a.auth);
    tick(91 * 86_400_000);
    expect((await runSessionRetention(ctx.deps)).deleted).toBe(1);
    expect(ctx.repo.security.sessions.size).toBe(0);
  });
});

describe("security events", () => {
  it("audits sign-ins and new devices with internal ids only, and sends « Nouvelle connexion »", async () => {
    await smsSignIn(CHROME_WIN);
    expect(ctx.notifier.sent).toHaveLength(0);
    await smsSignIn(SAFARI_IOS);
    const userId = (await ctx.repo.findUserByPhone(PHONE))!.id;
    const signIns = ctx.repo.auditLog.filter((e) => e.action === "auth.sign_in");
    expect(signIns).toHaveLength(2);
    expect(signIns[1]).toMatchObject({ actorUserId: userId, targetType: "session", meta: { method: "sms", newDevice: true } });
    expect(ctx.repo.auditLog.filter((e) => e.action === "auth.new_device")).toHaveLength(1);
    expect(JSON.stringify(ctx.repo.auditLog)).not.toContain(PHONE);
    expect(ctx.notifier.sent).toContainEqual([userId, "new_sign_in", { device: "Safari · iOS" }]);
    const push = pushPayload("new_sign_in", { device: "Safari · iOS" }, "fr-CA")!;
    expect(push.title).toBe("Nouvelle connexion à votre compte MIMT");
    expect(push.url).toBe("/compte/securite");
    expect(pushPayload("new_sign_in", { device: "<script>alert(1)</script>" }, "fr-CA")!.body).not.toContain("script");
  });

  it("SECURITY_SIGNIN_NOTICE=off sends nothing", async () => {
    await ctx.app.close();
    ctx = await setup({ config: { TWILIO_VERIFY_SERVICE_SID: "VAtest", SECURITY_SIGNIN_NOTICE: "off" }, now: () => clock });
    await smsSignIn(CHROME_WIN);
    await smsSignIn(SAFARI_IOS);
    expect(ctx.notifier.sent).toHaveLength(0);
  });
});

describe("step-up for sensitive actions", () => {
  it("deleting the account needs an authentication from the last 10 minutes; a fresh SMS code unlocks it", async () => {
    const a = await smsSignIn();
    tick(11 * 60_000);
    const refused = await call("DELETE", "/v1/me", a.auth);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe("step_up_required");
    expect((await call("GET", "/v1/me/security", a.auth)).json()).toMatchObject({ recentAuthRemainingS: 0, stepUpPhone: "•••-•••-0123" });

    expect((await call("POST", "/v1/auth/step-up/sms/start", a.auth)).statusCode).toBe(202);
    ctx.twilio!.checkVerification = async () => false;
    const wrong = await call("POST", "/v1/auth/step-up/sms/verify", a.auth, { code: "000000" });
    // 403, not 401: the app must not treat a wrong code as an expired session (refresh + retry).
    expect(wrong.statusCode).toBe(403);
    expect(ctx.repo.auditLog.some((e) => e.action === "auth.step_up_failed" && e.meta?.method === "sms")).toBe(true);
    ctx.twilio!.checkVerification = async () => true;
    const ok = await call("POST", "/v1/auth/step-up/sms/verify", a.auth, { code: "123456" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().recentAuthRemainingS).toBe(600);

    expect((await call("DELETE", "/v1/me", a.auth)).statusCode).toBe(202);
  });

  it("deleting the account revokes every session", async () => {
    const a = await smsSignIn(CHROME_WIN);
    const b = await smsSignIn(SAFARI_IOS);
    expect((await call("DELETE", "/v1/me", a.auth)).statusCode).toBe(202);
    expect((await call("POST", "/v1/auth/refresh", {}, { refreshToken: b.refreshToken })).statusCode).toBe(401);
    expect((await call("POST", "/v1/auth/refresh", {}, { refreshToken: a.refreshToken })).statusCode).toBe(401);
  });

  it("a new forwarding number needs a step-up; switching forwarding off does not", async () => {
    const a = await smsSignIn();
    const userId = (await ctx.repo.findUserByPhone(PHONE))!.id;
    const account = (await ctx.repo.getAccountByOwner(userId))!;
    await ctx.repo.upsertSubscription({ telecomAccountId: account.id, kind: "plan", code: "premium", quantity: 1, stripeSubscriptionId: "sub_x", status: "active", source: "stripe", currentPeriodEnd: null });
    expect((await call("PATCH", "/v1/me", a.auth, { forwarding: { mode: "always", target: "+14385550147" } })).statusCode).toBe(200);
    tick(11 * 60_000);
    const refused = await call("PATCH", "/v1/me", a.auth, { forwarding: { mode: "always", target: "+14385550148" } });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe("step_up_required");
    // Same number, other settings: no step-up.
    expect((await call("PATCH", "/v1/me", a.auth, { forwarding: { mode: "no_answer", target: "+14385550147" } })).statusCode).toBe(200);
    expect((await call("PATCH", "/v1/me", a.auth, { forwarding: { mode: "off" } })).statusCode).toBe(200);
  });

  it("a business extension forwarded to a new external number needs a step-up", async () => {
    const a = await smsSignIn();
    const biz = (await call("POST", "/v1/business", a.auth, { name: "Atelier" })).json().business;
    tick(11 * 60_000);
    const refused = await call("POST", `/v1/business/${biz.id}/extensions`, a.auth, { number: "201", displayName: "Réception", forwardToMobile: "+14385550147" });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe("step_up_required");
    expect((await call("POST", `/v1/business/${biz.id}/extensions`, a.auth, { number: "201", displayName: "Réception" })).statusCode).toBe(201);
  });
});

describe("passkeys (WebAuthn, verification mocked)", () => {
  async function registerPasskey(auth: Record<string, string>, credId = randomBytes(24).toString("base64url")) {
    const opts = await call("POST", "/v1/me/passkeys/register/options", auth);
    expect(opts.statusCode).toBe(200);
    const { options, challengeToken } = opts.json();
    const res = await call("POST", "/v1/me/passkeys/register/verify", auth, { challengeToken, response: credResponse(credId, options.challenge), name: "iPhone" });
    expect(res.statusCode).toBe(201);
    return { credId, passkey: res.json() as { id: string; name: string } };
  }

  it("registers, lists, signs in without a password, steps up and deletes", async () => {
    const a = await smsSignIn();
    const { credId, passkey } = await registerPasskey(a.auth);
    expect(passkey.name).toBe("iPhone");
    expect((await call("GET", "/v1/me/passkeys", a.auth)).json().passkeys).toHaveLength(1);
    expect(ctx.repo.auditLog.some((e) => e.action === "passkey.added" && e.targetId === passkey.id)).toBe(true);

    // Passwordless sign-in.
    const o = (await call("POST", "/v1/auth/passkeys/options")).json();
    const signIn = await ctx.app.inject({ method: "POST", url: "/v1/auth/passkeys/verify", headers: { "user-agent": SAFARI_IOS }, payload: { challengeToken: o.challengeToken, response: credResponse(credId, o.options.challenge) } });
    expect(signIn.statusCode).toBe(200);
    const p = { authorization: `Bearer ${signIn.json().accessToken}` };
    expect((await call("GET", "/v1/me/security", p)).json()).toMatchObject({ strongAuth: true, passkeys: 1 });
    // A challenge is single use.
    const replay = await call("POST", "/v1/auth/passkeys/verify", {}, { challengeToken: o.challengeToken, response: credResponse(credId, o.options.challenge) });
    expect(replay.statusCode).toBe(401);
    expect((await ctx.repo.security.findPasskeyByCredentialId(credId))!.counter).toBe(1);

    // Step-up by passkey after the window.
    tick(11 * 60_000);
    expect((await call("DELETE", `/v1/me/passkeys/${passkey.id}`, a.auth)).statusCode).toBe(403);
    const so = (await call("POST", "/v1/auth/step-up/passkey/options", a.auth)).json();
    const bad = await call("POST", "/v1/auth/step-up/passkey/verify", a.auth, { challengeToken: so.challengeToken, response: credResponse(credId, so.options.challenge, false) });
    expect(bad.statusCode).toBe(403);
    expect(ctx.repo.auditLog.some((e) => e.action === "auth.step_up_failed" && e.meta?.method === "passkey")).toBe(true);
    const so2 = (await call("POST", "/v1/auth/step-up/passkey/options", a.auth)).json();
    const good = await call("POST", "/v1/auth/step-up/passkey/verify", a.auth, { challengeToken: so2.challengeToken, response: credResponse(credId, so2.options.challenge) });
    expect(good.statusCode).toBe(200);
    expect(good.json()).toMatchObject({ strongAuth: true, recentAuthRemainingS: 600 });

    expect((await call("DELETE", `/v1/me/passkeys/${passkey.id}`, a.auth)).statusCode).toBe(204);
    expect(ctx.repo.auditLog.some((e) => e.action === "passkey.removed" && e.targetId === passkey.id)).toBe(true);
  });

  it("adding a passkey needs a recent authentication, and a challenge from another user does not verify", async () => {
    const a = await smsSignIn();
    tick(11 * 60_000);
    expect((await call("POST", "/v1/me/passkeys/register/options", a.auth)).json().error).toBe("step_up_required");
    tick(-11 * 60_000);
    const other = await makeUser(ctx);
    const { options, challengeToken } = (await call("POST", "/v1/me/passkeys/register/options", other.auth)).json();
    const res = await call("POST", "/v1/me/passkeys/register/verify", a.auth, { challengeToken, response: credResponse(randomBytes(24).toString("base64url"), options.challenge) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_challenge");
  });

  it("refuses an assertion that does not verify and an unknown credential", async () => {
    const a = await smsSignIn();
    const { credId } = await registerPasskey(a.auth);
    const o = (await call("POST", "/v1/auth/passkeys/options")).json();
    expect((await call("POST", "/v1/auth/passkeys/verify", {}, { challengeToken: o.challengeToken, response: credResponse(credId, o.options.challenge, false) })).statusCode).toBe(401);
    expect(ctx.repo.auditLog.some((e) => e.action === "auth.passkey_failed")).toBe(true);
    const o2 = (await call("POST", "/v1/auth/passkeys/options")).json();
    expect((await call("POST", "/v1/auth/passkeys/verify", {}, { challengeToken: o2.challengeToken, response: credResponse(randomBytes(24).toString("base64url"), o2.options.challenge) })).statusCode).toBe(401);
  });

  it("PASSKEYS=off turns the routes off", async () => {
    await ctx.app.close();
    ctx = await setup({ config: { PASSKEYS: "off" }, now: () => clock });
    expect((await call("POST", "/v1/auth/passkeys/options")).statusCode).toBe(503);
  });

  describe("business policy require_strong_auth", () => {
    it("is off by default and needs the owner's passkey to turn on", async () => {
      const a = await smsSignIn();
      const biz = (await call("POST", "/v1/business", a.auth, { name: "Atelier" })).json().business;
      expect((await call("GET", `/v1/business/${biz.id}/security`, a.auth)).json()).toEqual({ requireStrongAuth: false });
      const noKey = await call("PUT", `/v1/business/${biz.id}/security`, a.auth, { requireStrongAuth: true });
      expect(noKey.statusCode).toBe(403);
      expect(noKey.json().error).toBe("strong_auth_setup_required");
      await registerPasskey(a.auth);
      expect((await call("PUT", `/v1/business/${biz.id}/security`, a.auth, { requireStrongAuth: true })).json()).toEqual({ requireStrongAuth: true });
      expect(ctx.repo.auditLog.some((e) => e.action === "business.security_policy_updated")).toBe(true);
    });

    it("after an SMS sign-in, an owner needs a passkey step-up before the admin routes answer", async () => {
      const a = await smsSignIn();
      const biz = (await call("POST", "/v1/business", a.auth, { name: "Atelier" })).json().business;
      const { credId, passkey } = await registerPasskey(a.auth);
      await call("PUT", `/v1/business/${biz.id}/security`, a.auth, { requireStrongAuth: true });

      const b = await smsSignIn(SAFARI_IOS);
      const blocked = await call("GET", `/v1/business/${biz.id}/extensions`, b.auth);
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().error).toBe("strong_auth_required");
      // The overview and the policy still answer so the app can explain.
      expect((await call("GET", `/v1/business/${biz.id}`, b.auth)).statusCode).toBe(200);
      expect((await call("GET", "/v1/me/security", b.auth)).json()).toMatchObject({ strongAuthRequiredByBusiness: true, strongAuth: false });

      const so = (await call("POST", "/v1/auth/step-up/passkey/options", b.auth)).json();
      expect((await call("POST", "/v1/auth/step-up/passkey/verify", b.auth, { challengeToken: so.challengeToken, response: credResponse(credId, so.options.challenge) })).statusCode).toBe(200);
      expect((await call("GET", `/v1/business/${biz.id}/extensions`, b.auth)).statusCode).toBe(200);

      // The last passkey cannot be removed while the policy needs it.
      const del = await call("DELETE", `/v1/me/passkeys/${passkey.id}`, b.auth);
      expect(del.statusCode).toBe(409);
      expect(del.json().error).toBe("passkey_required_by_business");
    });

    it("an owner without a passkey is told to add one; the policy does not touch other businesses", async () => {
      const owner = await smsSignIn();
      const biz = (await call("POST", "/v1/business", owner.auth, { name: "Atelier" })).json().business;
      await ctx.repo.security.setBusinessPolicy(biz.id, true, "x", clock);
      const res = await call("GET", `/v1/business/${biz.id}/extensions`, owner.auth);
      expect(res.json().error).toBe("strong_auth_setup_required");
      const other = await makeUser(ctx);
      const otherBiz = (await call("POST", "/v1/business", other.auth, { name: "Autre" })).json().business;
      expect((await call("GET", `/v1/business/${otherBiz.id}/extensions`, other.auth)).statusCode).toBe(200);
    });
  });
});

describe("WebAuthn gateway (real @simplewebauthn/server)", () => {
  it("builds options for the configured relying party and refuses junk responses", async () => {
    const { createWebAuthn } = await import("../src/auth/webauthn.js");
    const wa = createWebAuthn({ WEBAUTHN_RP_ID: "mimt.ca", WEBAUTHN_ORIGINS: ["https://app.mimt.ca"], WEBAUTHN_RP_NAME: "MIMT" });
    const reg = await wa.registrationOptions({ userId: crypto.randomUUID(), userName: "@camille", exclude: [] });
    expect(reg).toMatchObject({ rp: { id: "mimt.ca", name: "MIMT" }, authenticatorSelection: { residentKey: "required", userVerification: "required" } });
    expect(reg.challenge).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    const authOpts = await wa.authenticationOptions({ allow: [] });
    expect(authOpts).toMatchObject({ rpId: "mimt.ca", userVerification: "required" });
    expect(await wa.verifyRegistration({ response: { id: "x" }, expectedChallenge: reg.challenge })).toBeNull();
  });

  it("refuses WebAuthn origins outside the RP ID", async () => {
    const { testConfig } = await import("./helpers.js");
    expect(() => testConfig({ WEBAUTHN_ORIGINS: "https://evil.example" })).toThrow(/WEBAUTHN_ORIGINS/);
    expect(() => testConfig({ WEBAUTHN_RP_ID: "localhost", WEBAUTHN_ORIGINS: "http://localhost:5173" })).not.toThrow();
  });
});
