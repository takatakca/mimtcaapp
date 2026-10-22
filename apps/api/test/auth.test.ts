import { generateKeyPairSync } from "node:crypto";
import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSigningKey } from "../src/auth/sessions.js";
import { TakatakOidc } from "../src/auth/takatak.js";
import { ISSUER, makeUser, setup, type Ctx } from "./helpers.js";

let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup();
});
afterEach(() => ctx.app.close());

const VERIFIER = "a".repeat(43);

/** Fake TAKATAK: discovery + token endpoint returning an ID token signed with the test key. */
function fakeIdp(idToken: () => Promise<string>, tokenStatus = 200) {
  return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/.well-known/openid-configuration")) {
      return Response.json({ token_endpoint: `${ISSUER}/oauth/token`, jwks_uri: `${ISSUER}/jwks` });
    }
    if (u === `${ISSUER}/oauth/token`) return Response.json({ id_token: await idToken() }, { status: tokenStatus });
    return new Response("not found", { status: 404 });
  });
}

const idToken = (claims: Record<string, unknown> = {}, aud = "mimt") =>
  new SignJWT({ email: "a@b.ca", name: "Marie", locale: "fr-CA", phone_number_verified: true, workspace_id: "ws_1", ...claims })
    .setProtectedHeader({ alg: "ES256", kid: "tk-1" })
    .setIssuer(ISSUER)
    .setAudience(aud)
    .setSubject("gu_42")
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime("5m")
    .sign(ctx.keys.privateKey);

function useIdp(fetchImpl: ReturnType<typeof fakeIdp>) {
  ctx.deps.takatak = new TakatakOidc(ctx.deps.config, ctx.repo, { jwks: ctx.keys.jwks, fetch: fetchImpl as unknown as typeof fetch });
}

const exchange = () =>
  ctx.app.inject({
    method: "POST",
    url: "/v1/auth/takatak/exchange",
    payload: { code: "abc", codeVerifier: VERIFIER, redirectUri: "https://app.mimt.ca/auth/callback" },
  });

describe("TAKATAK code exchange (Flow A)", () => {
  it("exchanges the code with PKCE, verifies the ID token and issues MIMT tokens", async () => {
    const f = fakeIdp(() => idToken());
    useIdp(f);
    const res = await exchange();
    expect(res.statusCode).toBe(200);
    const tokens = res.json();
    expect(tokens).toMatchObject({ tokenType: "Bearer", expiresIn: 900 });
    const tokenCall = f.mock.calls.find(([u]) => String(u).endsWith("/oauth/token"))!;
    const form = new URLSearchParams(String(tokenCall[1]!.body));
    expect(form.get("code_verifier")).toBe(VERIFIER);
    expect(form.get("grant_type")).toBe("authorization_code");

    const user = await ctx.repo.findUserByGlobalId("gu_42");
    expect(user).toMatchObject({ email: "a@b.ca", displayName: "Marie", locale: "fr-CA" });
    expect(user!.phoneVerifiedAt).toBeInstanceOf(Date);
    expect((await ctx.repo.getAccountByOwner(user!.id))!.workspaceId).toBe("ws_1");

    const me = await ctx.app.inject({ url: "/v1/me", headers: { authorization: `Bearer ${tokens.accessToken}` } });
    expect(me.json().user.globalUserId).toBe("gu_42");
  });

  it("rejects an ID token for another audience", async () => {
    useIdp(fakeIdp(() => idToken({}, "someone-else")));
    expect((await exchange()).statusCode).toBe(401);
  });

  it("rejects a refused code", async () => {
    useIdp(fakeIdp(() => idToken(), 400));
    expect((await exchange()).statusCode).toBe(401);
  });

  it("validates the PKCE verifier format", async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/v1/auth/takatak/exchange", payload: { code: "x", codeVerifier: "short", redirectUri: "https://app.mimt.ca/cb" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("MIMT sessions", () => {
  it("rejects missing or forged bearer tokens", async () => {
    expect((await ctx.app.inject({ url: "/v1/me" })).statusCode).toBe(401);
    expect((await ctx.app.inject({ url: "/v1/me", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
  });

  it("rotates refresh tokens and revokes the family on reuse", async () => {
    const u = await makeUser(ctx);
    const first = await ctx.deps.sessions.issue(u.user.id);
    const r1 = await ctx.app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: first.refreshToken } });
    expect(r1.statusCode).toBe(200);
    const second = r1.json();
    expect(second.refreshToken).not.toBe(first.refreshToken);

    const reuse = await ctx.app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: first.refreshToken } });
    expect(reuse.statusCode).toBe(401);
    const afterTheft = await ctx.app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: second.refreshToken } });
    expect(afterTheft.statusCode).toBe(401);
  });

  it("logout revokes the refresh token", async () => {
    const u = await makeUser(ctx);
    const t = await ctx.deps.sessions.issue(u.user.id);
    expect((await ctx.app.inject({ method: "POST", url: "/v1/auth/logout", payload: { refreshToken: t.refreshToken } })).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: t.refreshToken } })).statusCode).toBe(401);
  });

  it("loads Ed25519 keys from PEM and JWK and refuses other key types", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    expect(loadSigningKey(privateKey.export({ format: "pem", type: "pkcs8" }).toString()).ephemeral).toBe(false);
    expect(loadSigningKey(JSON.stringify(privateKey.export({ format: "jwk" }))).ephemeral).toBe(false);
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    expect(() => loadSigningKey(rsa)).toThrow(/Ed25519/);
  });
});

describe("OTP fallback", () => {
  it("answers 503 when Twilio Verify is turned off", async () => {
    await ctx.app.close();
    ctx = await setup({ config: { TWILIO_VERIFY_SERVICE_SID: "off" } });
    const res = await ctx.app.inject({ method: "POST", url: "/v1/auth/otp/start", payload: { phone: "+15145550123" } });
    expect(res.statusCode).toBe(503);
  });

  it("uses the owner's Verify service « MIMT » by default", async () => {
    expect(ctx.deps.config.TWILIO_VERIFY_SERVICE_SID).toBe("VAc17f03b98d76d6f0183445ab09458afc");
    expect((await ctx.app.inject({ method: "POST", url: "/v1/auth/otp/start", payload: { phone: "+15145550123" } })).statusCode).toBe(202);
  });

  it("creates a phone-only user after a verified code", async () => {
    await ctx.app.close();
    ctx = await setup({ config: { TWILIO_VERIFY_SERVICE_SID: "VAtest" } });
    expect((await ctx.app.inject({ method: "POST", url: "/v1/auth/otp/start", payload: { phone: "+15145550123" } })).statusCode).toBe(202);
    const res = await ctx.app.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: { phone: "+15145550123", code: "123456" } });
    expect(res.statusCode).toBe(200);
    expect(await ctx.repo.findUserByPhone("+15145550123")).toMatchObject({ globalUserId: null });
  });
});
