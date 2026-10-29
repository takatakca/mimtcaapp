// « Google Agenda » connector (docs/MIMT-CALENDAR.md): kill switch, OAuth state + PKCE, step-up, entitlement matrix,
// encrypted refresh token, outbox idempotency, deterministic event ids, the worker (backoff, 401 → needs_reconnect)
// and the Law 25 content opt-in. Google is a mocked fetch. Repository rules: calendar.repo.contract.test.ts.
import { createHash } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_CONSENT_KIND, type PlanCode } from "@mimt/shared";
import type { BillingGateway } from "../src/gateways/billing.js";
import { MessageCipher } from "../src/lib/crypto.js";
import {
  base32hex,
  backoffMs,
  CALENDAR_MAX_ATTEMPTS,
  calendarEventId,
  clearAccessCache,
  queueCalendarSync,
  runCalendarSync,
  STATE_TTL_S,
} from "../src/services/calendar.js";
import { makeUser, setup, twilioPost, type Ctx } from "./helpers.js";
import { makeBusiness, subscribe } from "./pbxFixtures.js";

const GOOGLE = {
  GOOGLE_OAUTH_CLIENT_ID: "test-client.apps.googleusercontent.com",
  GOOGLE_OAUTH_CLIENT_SECRET: "test-client-secret",
  GOOGLE_OAUTH_REDIRECT_URI: "https://api.test.mimt.ca/v1/integrations/google-calendar/callback",
};
const P = "/v1/integrations/google-calendar";
const silentLog = { warn: () => undefined, error: () => undefined, info: () => undefined };

let ctx: Ctx;
let now: Date;
const advance = (s: number) => (now = new Date(now.getTime() + s * 1000));

interface GoogleCall {
  url: string;
  method: string;
  body: string;
  headers: Record<string, string>;
}

/** Mocked Google: token endpoint, revoke, events.insert. Responses are set per test. */
function mockGoogle() {
  const calls: GoogleCall[] = [];
  const g = {
    calls,
    tokenScope: "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.events",
    refreshToken: "1//refresh-token-secret" as string | null,
    refreshStatus: 200,
    refreshError: undefined as string | undefined,
    insert: [] as number[],
    fetch: vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      const body = typeof init.body === "string" ? init.body : "";
      calls.push({ url, method: init.method ?? "GET", body, headers: (init.headers ?? {}) as Record<string, string> });
      const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
      if (url === "https://oauth2.googleapis.com/token") {
        const form = new URLSearchParams(body);
        if (form.get("grant_type") === "authorization_code") {
          const idPayload = Buffer.from(JSON.stringify({ email: "marie@example.com", email_verified: true })).toString("base64url");
          return json(200, {
            access_token: "ya29.access-1",
            expires_in: 3599,
            scope: g.tokenScope,
            ...(g.refreshToken ? { refresh_token: g.refreshToken } : {}),
            id_token: `eyJhbGciOiJSUzI1NiJ9.${idPayload}.sig`,
          });
        }
        if (g.refreshStatus !== 200) return json(g.refreshStatus, { error: g.refreshError ?? "server_error" });
        return json(200, { access_token: `ya29.access-${calls.length}`, expires_in: 3599 });
      }
      if (url === "https://oauth2.googleapis.com/revoke") return new Response("", { status: 200 });
      if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events")) {
        const status = g.insert.shift() ?? 200;
        return status === 200 ? json(200, { id: JSON.parse(body).id, status: "confirmed" }) : json(status, { error: { code: status, message: "x" } });
      }
      return json(404, {});
    }),
  };
  return g;
}
let google: ReturnType<typeof mockGoogle>;

beforeEach(async () => {
  now = new Date("2026-10-29T15:00:00Z");
  ctx = await setup({ config: { CALENDAR: "on", ...GOOGLE }, now: () => now });
  google = mockGoogle();
  ctx.deps.googleFetch = google.fetch as unknown as typeof fetch;
  clearAccessCache();
});
afterEach(async () => {
  vi.useRealTimers();
  await ctx.app.close();
});

type Method = "GET" | "PUT" | "DELETE";
const call = (method: Method, url: string, headers: Record<string, string> = {}, payload?: unknown) =>
  ctx.app.inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });

async function subscribed(plan: PlanCode | null, addOn?: { status: "active" | "trialing" | "canceled" }) {
  const u = await makeUser(ctx);
  if (plan) await subscribe(ctx, u.account.id, plan, 1);
  if (addOn) {
    await ctx.repo.upsertSubscription({
      telecomAccountId: u.account.id,
      kind: "addon",
      code: "google_calendar",
      quantity: 1,
      stripeSubscriptionId: `sub_gcal_${u.account.id.slice(0, 8)}`,
      status: addOn.status,
      source: "stripe",
      currentPeriodEnd: null,
    });
  }
  return u;
}

/** Connect: auth URL, then Google's redirect to our callback. Returns the redirect Location. */
async function connect(u: Awaited<ReturnType<typeof makeUser>>) {
  const res = await call("GET", `${P}/connect`, u.auth);
  expect(res.statusCode).toBe(200);
  const authUrl = new URL(res.json().authUrl);
  const state = authUrl.searchParams.get("state")!;
  const cb = await call("GET", `${P}/callback?code=4/auth-code&state=${encodeURIComponent(state)}`);
  expect(cb.statusCode).toBe(302);
  return { authUrl, state, location: cb.headers.location as string };
}

const jobs = () => ctx.repo.calendar.jobs;

describe("kill switch and configuration", () => {
  it("CALENDAR=off: every route answers 404 and nothing is queued", async () => {
    const off = await setup({ config: { ...GOOGLE } });
    try {
      const u = await makeUser(off);
      for (const [m, url] of [
        ["GET", P],
        ["GET", `${P}/connect`],
        ["GET", `${P}/callback?code=x&state=y`],
        ["PUT", P],
        ["DELETE", P],
      ] as const) {
        const res = await off.app.inject({ method: m, url, headers: u.auth, ...(m === "PUT" ? { payload: { syncCalls: false } } : {}) });
        expect(res.statusCode, `${m} ${url}`).toBe(404);
        expect(res.json().error).toBe("not_found");
      }
      expect(await queueCalendarSync(off.deps, { userId: u.user.id, sourceType: "call", sourceId: "CA1" })).toBeNull();
      expect(await runCalendarSync(off.deps, silentLog)).toEqual({ sent: 0, skipped: 0, failed: 0, retried: 0, reconnect: 0 });
    } finally {
      await off.app.close();
    }
  });

  it("without Google OAuth credentials: status says not configured, connect answers 503", async () => {
    const bare = await setup({ config: { CALENDAR: "on" } });
    try {
      const u = await makeUser(bare);
      await subscribe(bare, u.account.id, "business", 1);
      const status = await bare.app.inject({ url: P, headers: u.auth });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({ configured: false, entitled: true, connected: false });
      const res = await bare.app.inject({ url: `${P}/connect`, headers: u.auth });
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe("not_configured");
    } finally {
      await bare.app.close();
    }
  });

  it("requires a signed-in user", async () => {
    expect((await call("GET", P)).statusCode).toBe(401);
    expect((await call("GET", `${P}/connect`)).statusCode).toBe(401);
  });
});

describe("entitlement matrix", () => {
  const cases: Array<[string, PlanCode | null, { status: "active" | "trialing" | "canceled" } | undefined, boolean, string | null, boolean]> = [
    ["free", null, undefined, false, null, false],
    ["Essentiel", "lock", undefined, false, null, true],
    ["Premium", "premium", undefined, false, null, true],
    ["Essentiel + add-on", "lock", { status: "active" }, true, "addon", false],
    ["Premium + add-on in trial", "premium", { status: "trialing" }, true, "addon", false],
    ["Premium + cancelled add-on", "premium", { status: "canceled" }, false, null, true],
    ["Affaires", "business", undefined, true, "plan", false],
    ["Affaires Pro", "business_pro", undefined, true, "plan", false],
  ];
  for (const [name, plan, addOn, entitled, source, canBuy] of cases) {
    it(`${name}: ${entitled ? "allowed" : "refused"}`, async () => {
      const u = await subscribed(plan, addOn);
      const status = (await call("GET", P, u.auth)).json();
      expect(status).toMatchObject({ configured: true, entitled, entitlement: source, canBuy, connected: false });
      const res = await call("GET", `${P}/connect`, u.auth);
      expect(res.statusCode).toBe(entitled ? 200 : 403);
      if (!entitled) expect(res.json().error).toBe("calendar_not_entitled");
    });
  }

  it("a member of an Affaires business is allowed through the business", async () => {
    const biz = await makeBusiness(ctx);
    expect((await call("GET", P, biz.staff.auth)).json()).toMatchObject({ entitled: true, entitlement: "business" });
  });

  it("the trial is offered once: not after any earlier google_calendar subscription", async () => {
    const u = await subscribed("premium");
    expect((await call("GET", P, u.auth)).json().trialAvailable).toBe(true);
    const v = await subscribed("premium", { status: "canceled" });
    expect((await call("GET", P, v.auth)).json().trialAvailable).toBe(false);
  });
});

describe("OAuth: state, PKCE, step-up", () => {
  it("auth URL: calendar.events + openid email only, offline, S256 challenge, state bound to the user", async () => {
    const u = await subscribed("business");
    const { authUrl } = await connect(u);
    expect(authUrl.origin + authUrl.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(authUrl.searchParams.get("scope")).toBe("openid email https://www.googleapis.com/auth/calendar.events");
    expect(authUrl.searchParams.get("client_id")).toBe(GOOGLE.GOOGLE_OAUTH_CLIENT_ID);
    expect(authUrl.searchParams.get("redirect_uri")).toBe(GOOGLE.GOOGLE_OAUTH_REDIRECT_URI);
    expect(authUrl.searchParams.get("access_type")).toBe("offline");
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.get("state")!.startsWith(`${u.user.id}.`)).toBe(true);
  });

  it("callback: PKCE verifier matches the challenge, refresh token stored encrypted, redirect gc=ok", async () => {
    const u = await subscribed("business");
    const { authUrl, location } = await connect(u);
    expect(location).toBe("https://app.mimt.ca/compte/integrations?gc=ok");
    const exchange = google.calls.find((c) => c.url === "https://oauth2.googleapis.com/token")!;
    const form = new URLSearchParams(exchange.body);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("4/auth-code");
    expect(form.get("redirect_uri")).toBe(GOOGLE.GOOGLE_OAUTH_REDIRECT_URI);
    const verifier = form.get("code_verifier")!;
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(authUrl.searchParams.get("code_challenge"));

    const conn = (await ctx.repo.calendar.getConnection(u.user.id))!;
    expect(conn).toMatchObject({ googleEmail: "marie@example.com", status: "active", calendarId: "primary", includeContent: false });
    expect(conn.refreshTokenEncrypted).not.toContain("refresh-token-secret");
    expect(conn.refreshTokenEncrypted.startsWith("v1.")).toBe(true);
    expect(ctx.deps.cipher.decrypt(conn.refreshTokenEncrypted)).toBe("1//refresh-token-secret");
    expect((await call("GET", P, u.auth)).json()).toMatchObject({ connected: true, email: "marie@example.com", calendarId: "primary", status: "active" });
    expect(ctx.repo.auditLog.some((e) => e.action === "calendar.connected" && e.targetId === u.user.id)).toBe(true);
    // Nothing secret in the audit trail.
    expect(JSON.stringify(ctx.repo.auditLog)).not.toContain("refresh-token-secret");
  });

  it("a state is single use", async () => {
    const u = await subscribed("business");
    const { state } = await connect(u);
    const replay = await call("GET", `${P}/callback?code=4/other&state=${encodeURIComponent(state)}`);
    expect(replay.headers.location).toBe("https://app.mimt.ca/compte/integrations?gc=error&reason=state");
  });

  it("a tampered state (other user, other nonce, forged token) is refused", async () => {
    const u = await subscribed("business");
    const v = await subscribed("business");
    const authUrl = new URL((await call("GET", `${P}/connect`, u.auth)).json().authUrl);
    const [, nonce, ...token] = authUrl.searchParams.get("state")!.split(".");
    for (const forged of [`${v.user.id}.${nonce}.${token.join(".")}`, `${u.user.id}.AAAAAAAAAAAAAAAAAAAAAAAA.${token.join(".")}`, `${u.user.id}.${nonce}.not-a-token`, "garbage"]) {
      const res = await call("GET", `${P}/callback?code=4/x&state=${encodeURIComponent(forged)}`);
      expect(res.headers.location, forged).toBe("https://app.mimt.ca/compte/integrations?gc=error&reason=state");
    }
    expect(await ctx.repo.calendar.getConnection(v.user.id)).toBeNull();
    expect(google.calls).toHaveLength(0);
  });

  it("a state expires after 5 minutes", async () => {
    const u = await subscribed("business");
    const state = new URL((await call("GET", `${P}/connect`, u.auth)).json().authUrl).searchParams.get("state")!;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + (STATE_TTL_S + 60) * 1000);
    const res = await call("GET", `${P}/callback?code=4/x&state=${encodeURIComponent(state)}`);
    expect(res.headers.location).toBe("https://app.mimt.ca/compte/integrations?gc=error&reason=state");
  });

  it("the user refusing at Google, or unticking the calendar permission, connects nothing", async () => {
    const u = await subscribed("business");
    const s1 = new URL((await call("GET", `${P}/connect`, u.auth)).json().authUrl).searchParams.get("state")!;
    const denied = await call("GET", `${P}/callback?error=access_denied&state=${encodeURIComponent(s1)}`);
    expect(denied.headers.location).toBe("https://app.mimt.ca/compte/integrations?gc=error&reason=denied");

    google.tokenScope = "openid https://www.googleapis.com/auth/userinfo.email";
    const { location } = await connect(u);
    expect(location).toBe("https://app.mimt.ca/compte/integrations?gc=error&reason=scope");
    expect(google.calls.some((c) => c.url === "https://oauth2.googleapis.com/revoke")).toBe(true);
    expect(await ctx.repo.calendar.getConnection(u.user.id)).toBeNull();
  });

  it("connect and disconnect require a recent authentication (step-up)", async () => {
    const u = await subscribed("business");
    await connect(u);
    advance(11 * 60);
    const c = await call("GET", `${P}/connect`, u.auth);
    expect(c.statusCode).toBe(403);
    expect(c.json().error).toBe("step_up_required");
    const d = await call("DELETE", P, u.auth);
    expect(d.statusCode).toBe(403);
    expect(d.json().error).toBe("step_up_required");
    expect(await ctx.repo.calendar.getConnection(u.user.id)).not.toBeNull();
    // Settings do not need it.
    expect((await call("PUT", P, u.auth, { syncCalls: false })).statusCode).toBe(200);
  });

  it("disconnect revokes the token at Google and drops the connection and pending jobs", async () => {
    const u = await subscribed("business");
    await connect(u);
    await queueCalendarSync(ctx.deps, { userId: u.user.id, sourceType: "call", sourceId: "CA-pending" });
    const res = await call("DELETE", P, u.auth);
    expect(res.statusCode).toBe(204);
    const revoke = google.calls.find((c) => c.url === "https://oauth2.googleapis.com/revoke")!;
    expect(new URLSearchParams(revoke.body).get("token")).toBe("1//refresh-token-secret");
    expect(await ctx.repo.calendar.getConnection(u.user.id)).toBeNull();
    expect(jobs()).toHaveLength(0);
    expect((await call("DELETE", P, u.auth)).statusCode).toBe(404);
  });
});

describe("settings", () => {
  it("updates the toggles; only the primary calendar; unknown fields refused", async () => {
    const u = await subscribed("business");
    expect((await call("PUT", P, u.auth, { syncCalls: false })).statusCode).toBe(404);
    await connect(u);
    const res = await call("PUT", P, u.auth, { syncCalls: false, includeContent: true, calendar: "primary" });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings).toEqual({ syncCalls: false, syncMissedCalls: true, syncVoicemails: true, syncSummaries: true, includeContent: true, calendar: "primary" });
    expect((await call("PUT", P, u.auth, { calendar: "mimt" })).statusCode).toBe(400);
    expect((await call("PUT", P, u.auth, { refreshToken: "x" })).statusCode).toBe(400);
  });
});

describe("encryption", () => {
  it("refresh token round-trip; derived PKCE secrets are stable per nonce and differ between nonces and keys", () => {
    const c = new MessageCipher(MessageCipher.generateKey());
    const enc = c.encrypt("1//refresh-token");
    expect(enc).not.toContain("refresh");
    expect(c.decrypt(enc)).toBe("1//refresh-token");
    expect(c.encrypt("1//refresh-token")).not.toBe(enc);
    expect(c.derivedSecret("gcal-pkce", "n1")).toBe(c.derivedSecret("gcal-pkce", "n1"));
    expect(c.derivedSecret("gcal-pkce", "n1")).not.toBe(c.derivedSecret("gcal-pkce", "n2"));
    expect(new MessageCipher(MessageCipher.generateKey()).derivedSecret("gcal-pkce", "n1")).not.toBe(c.derivedSecret("gcal-pkce", "n1"));
    expect(() => new MessageCipher(MessageCipher.generateKey()).decrypt(enc)).toThrow();
  });
});

describe("deterministic event ids", () => {
  it("base32hex follows RFC 4648", () => {
    expect(base32hex(Buffer.from("foobar"))).toBe("cpnmuoj1e8");
    expect(base32hex(Buffer.from("f"))).toBe("co");
  });

  it("same (user, source) → same id; Google's alphabet; different sources differ", () => {
    const id = calendarEventId("u1", "call", "CA123");
    expect(id).toMatch(/^[a-v0-9]{32}$/);
    expect(calendarEventId("u1", "call", "CA123")).toBe(id);
    expect(calendarEventId("u2", "call", "CA123")).not.toBe(id);
    expect(calendarEventId("u1", "voicemail", "CA123")).not.toBe(id);
    expect(calendarEventId("u1", "call", "CA124")).not.toBe(id);
  });
});

describe("outbox and worker", () => {
  async function connectedUser(plan: PlanCode = "business", opts: { connect?: boolean } = {}) {
    const u = await makeUser(ctx, { e911: true, ack: true, number: "+15145550100" });
    await subscribe(ctx, u.account.id, plan, 1);
    if (opts.connect !== false) await connect(u);
    google.calls.length = 0;
    return u;
  }

  async function inboundCall(u: Awaited<ReturnType<typeof makeUser>>, sid: string, status: string, durationS: number) {
    await ctx.repo.upsertCall({
      twilioCallSid: sid,
      telecomAccountId: u.account.id,
      userId: null,
      direction: "inbound",
      kind: "pstn",
      fromNumber: "+14385550199",
      toNumber: "+15145550100",
      status: "ringing",
      startedAt: new Date(now.getTime() - durationS * 1000),
    });
    return twilioPost(ctx, "/webhooks/twilio/voice/status", { CallSid: sid, CallStatus: status, CallDuration: String(durationS) });
  }

  const inserted = () => google.calls.filter((c) => c.url.includes("/calendar/v3/")).map((c) => JSON.parse(c.body));

  it("a finished call is queued once (repeated status callbacks), then sent with its deterministic id", async () => {
    const u = await connectedUser();
    await inboundCall(u, "CA-answered", "completed", 185);
    await twilioPost(ctx, "/webhooks/twilio/voice/status", { CallSid: "CA-answered", CallStatus: "completed", CallDuration: "185" });
    expect(jobs()).toHaveLength(1);
    expect(jobs()[0]).toMatchObject({ sourceType: "call", sourceId: "CA-answered", status: "pending" });
    // Not before the 2-minute delay (a voicemail may still come).
    expect((await runCalendarSync(ctx.deps, silentLog)).sent).toBe(0);
    advance(121);
    expect(await runCalendarSync(ctx.deps, silentLog)).toMatchObject({ sent: 1 });
    const [event] = inserted();
    expect(event.id).toBe(calendarEventId(u.user.id, "call", "CA-answered"));
    expect(event.summary).toBe("Appel de (438) 555-0199 — 3 min");
    expect(event.transparency).toBe("transparent");
    expect(event.description).toContain("https://app.mimt.ca/appels");
    expect(new Date(event.end.dateTime).getTime() - new Date(event.start.dateTime).getTime()).toBeGreaterThanOrEqual(60_000);
    const auth = google.calls.find((c) => c.url.includes("/calendar/v3/"))!.headers.Authorization;
    expect(auth).toMatch(/^Bearer ya29\./);
    expect(jobs()[0]).toMatchObject({ status: "sent", googleEventId: event.id });
    // Re-queuing the same source is a no-op.
    expect(await queueCalendarSync(ctx.deps, { userId: u.user.id, sourceType: "call", sourceId: "CA-answered" })).toBeNull();
    expect((await call("GET", P, u.auth)).json().lastSyncAt).not.toBeNull();
  });

  it("missed call and voicemail: metadata only by default (Law 25)", async () => {
    const u = await connectedUser();
    await inboundCall(u, "CA-missed", "no-answer", 0);
    const vm = await ctx.repo.createVoicemail({
      telecomAccountId: u.account.id,
      phoneNumberId: u.number!.id,
      callSid: "CA-vm",
      recordingSid: "RE1",
      fromNumber: "+14385550199",
      audioUrl: null,
      durationS: 42,
    });
    await ctx.repo.updateVoicemailByRecordingSid("RE1", { transcript: "Bonjour, ici Marie Tremblay, rappelez-moi au sujet du contrat.", transcriptLang: "fr" });
    await queueCalendarSync(ctx.deps, { userId: u.user.id, sourceType: "voicemail", sourceId: vm.id });
    advance(200);
    expect(await runCalendarSync(ctx.deps, silentLog)).toMatchObject({ sent: 2 });
    const events = inserted();
    expect(events.map((e) => e.summary).sort()).toEqual(["Appel manqué de (438) 555-0199", "Message vocal de (438) 555-0199 — 42 s"]);
    for (const e of events) expect(e.description).not.toContain("Marie");
  });

  it("content opt-in + AI consent: transcript excerpt in the voicemail description", async () => {
    const u = await connectedUser();
    await call("PUT", P, u.auth, { includeContent: true });
    const vm = await ctx.repo.createVoicemail({
      telecomAccountId: u.account.id,
      phoneNumberId: u.number!.id,
      callSid: "CA-vm2",
      recordingSid: "RE2",
      fromNumber: "+14385550199",
      audioUrl: null,
      durationS: 30,
    });
    await ctx.repo.updateVoicemailByRecordingSid("RE2", { transcript: "Bonjour, ici Marie Tremblay.", transcriptLang: "fr" });
    await queueCalendarSync(ctx.deps, { userId: u.user.id, sourceType: "voicemail", sourceId: vm.id });
    // Opt-in alone is not enough: the AI consent is needed too.
    await runCalendarSync(ctx.deps, silentLog);
    expect(inserted()[0].description).not.toContain("Marie");

    await ctx.repo.addConsent({ userId: u.user.id, kind: AI_CONSENT_KIND as never, granted: true, version: "test", source: "test", at: now, ip: null });
    const vm2 = await ctx.repo.createVoicemail({
      telecomAccountId: u.account.id,
      phoneNumberId: u.number!.id,
      callSid: "CA-vm3",
      recordingSid: "RE3",
      fromNumber: "+14385550199",
      audioUrl: null,
      durationS: 30,
    });
    await ctx.repo.updateVoicemailByRecordingSid("RE3", { transcript: "Bonjour, ici Marie Tremblay.", transcriptLang: "fr" });
    await queueCalendarSync(ctx.deps, { userId: u.user.id, sourceType: "voicemail", sourceId: vm2.id });
    await runCalendarSync(ctx.deps, silentLog);
    expect(inserted()[1].description).toContain("« Bonjour, ici Marie Tremblay. »");
  });

  it("a disabled toggle skips the event", async () => {
    const u = await connectedUser();
    await call("PUT", P, u.auth, { syncMissedCalls: false });
    await inboundCall(u, "CA-missed2", "busy", 0);
    advance(121);
    expect(await runCalendarSync(ctx.deps, silentLog)).toMatchObject({ sent: 0, skipped: 1 });
    expect(jobs()[0]).toMatchObject({ status: "skipped", lastError: "disabled_by_user" });
    expect(inserted()).toHaveLength(0);
  });

  it("409 from Google (already inserted on an earlier try) counts as sent", async () => {
    const u = await connectedUser();
    await queueCalendarSync(ctx.deps, { userId: u.user.id, sourceType: "call", sourceId: "CA-dup" });
    await inboundCall(u, "CA-dup", "completed", 60);
    google.insert.push(409);
    advance(121);
    expect(await runCalendarSync(ctx.deps, silentLog)).toMatchObject({ sent: 1 });
  });

  it("429 / 5xx: exponential backoff with the same event id, then failed after the last attempt", async () => {
    const u = await connectedUser();
    await inboundCall(u, "CA-busy", "completed", 60);
    advance(121);
    google.insert.push(429, 503);
    expect(await runCalendarSync(ctx.deps, silentLog)).toMatchObject({ retried: 1 });
    expect(jobs()[0]).toMatchObject({ status: "pending", attempts: 1 });
    expect(jobs()[0]!.nextAttemptAt!.getTime() - now.getTime()).toBe(backoffMs(0));
    advance(backoffMs(0) / 1000);
    expect(await runCalendarSync(ctx.deps, silentLog)).toMatchObject({ retried: 1 });
    expect(jobs()[0]!.nextAttemptAt!.getTime() - now.getTime()).toBe(backoffMs(1));
    advance(backoffMs(1) / 1000);
    expect(await runCalendarSync(ctx.deps, silentLog)).toMatchObject({ sent: 1 });
    const ids = inserted().map((e) => e.id);
    expect(new Set(ids).size).toBe(1);
    expect(ids).toHaveLength(3);

    await inboundCall(u, "CA-down", "completed", 60);
    advance(121);
    for (let i = 0; i < CALENDAR_MAX_ATTEMPTS; i++) {
      google.insert.push(500);
      await runCalendarSync(ctx.deps, silentLog);
      advance(6 * 3600);
    }
    expect(jobs().find((j) => j.sourceId === "CA-down")).toMatchObject({ status: "failed", attempts: CALENDAR_MAX_ATTEMPTS });
  });

  it("401 twice → needs_reconnect, the user is told once, jobs wait; a reconnect resumes them", async () => {
    const u = await connectedUser();
    await inboundCall(u, "CA-a", "completed", 60);
    await inboundCall(u, "CA-b", "completed", 60);
    advance(121);
    // events.insert answers 401 with a cached token and again with a fresh one: the grant is no longer usable.
    google.insert.push(401, 401);
    const r = await runCalendarSync(ctx.deps, silentLog);
    expect(r).toMatchObject({ reconnect: 1, retried: 1, sent: 0 });
    expect((await ctx.repo.calendar.getConnection(u.user.id))!.status).toBe("needs_reconnect");
    const notices = (ctx.notifier.sent as unknown[][]).filter((n) => n[1] === "calendar_reconnect");
    expect(notices).toEqual([[u.user.id, "calendar_reconnect", {}]]);
    expect((await call("GET", P, u.auth)).json().status).toBe("needs_reconnect");
    // Later runs: no new notice, nothing sent.
    advance(3700);
    await runCalendarSync(ctx.deps, silentLog);
    expect((ctx.notifier.sent as unknown[][]).filter((n) => n[1] === "calendar_reconnect")).toHaveLength(1);
    expect(jobs().every((j) => j.status === "pending")).toBe(true);

    // Reconnect (a fresh sign-in: step-up window): active again, the waiting jobs go out.
    const { accessToken } = await ctx.deps.sessions.issue(u.user.id, undefined, { method: "sms" });
    await connect({ ...u, auth: { authorization: `Bearer ${accessToken}` } });
    expect((await ctx.repo.calendar.getConnection(u.user.id))!.status).toBe("active");
    advance(3700);
    expect(await runCalendarSync(ctx.deps, silentLog)).toMatchObject({ sent: 2 });
  });

  it("invalid_grant on refresh → needs_reconnect", async () => {
    const u = await connectedUser();
    await inboundCall(u, "CA-g", "completed", 60);
    advance(121);
    google.refreshStatus = 400;
    google.refreshError = "invalid_grant";
    expect(await runCalendarSync(ctx.deps, silentLog)).toMatchObject({ reconnect: 1, sent: 0 });
    expect((await ctx.repo.calendar.getConnection(u.user.id))!.status).toBe("needs_reconnect");
    expect(ctx.repo.auditLog.some((e) => e.action === "calendar.needs_reconnect")).toBe(true);
  });

  it("losing the entitlement skips the job; no connection queues nothing; 9-1-1 calls never go to a calendar", async () => {
    // Premium without the add-on (e.g. the add-on was cancelled after connecting): the connection row is still there.
    const u = await connectedUser("premium", { connect: false });
    await ctx.repo.calendar.upsertConnection({ userId: u.user.id, googleEmail: null, refreshTokenEncrypted: ctx.deps.cipher.encrypt("r"), scope: "x", at: now });
    await inboundCall(u, "CA-x", "completed", 60);
    advance(121);
    expect(await runCalendarSync(ctx.deps, silentLog)).toMatchObject({ skipped: 1 });
    expect(jobs()[0]!.lastError).toBe("not_entitled");

    const other = await makeUser(ctx);
    expect(await queueCalendarSync(ctx.deps, { userId: other.user.id, sourceType: "call", sourceId: "CA-y" })).toBeNull();

    await ctx.repo.upsertCall({
      twilioCallSid: "CA-911",
      telecomAccountId: u.account.id,
      userId: u.user.id,
      direction: "outbound",
      kind: "emergency",
      fromNumber: "+15145550100",
      toNumber: "911",
      status: "ringing",
      startedAt: now,
    });
    await twilioPost(ctx, "/webhooks/twilio/voice/status", { CallSid: "CA-911", CallStatus: "completed", CallDuration: "60" });
    expect(jobs().some((j) => j.sourceId === "CA-911")).toBe(false);
  });

  it("AI call summary (Affaires Pro): a link only by default, the summary with the opt-in and AI consent", async () => {
    const biz = await makeBusiness(ctx, { plan: "business_pro" });
    await connect(biz.owner);
    const rec = await ctx.repo.pbx.createRecording({
      businessId: biz.business.id,
      callSid: "CA-rec",
      recordingSid: "RE-rec",
      recordingUrl: null,
      extensionId: null,
      userId: null,
      source: "all",
      fromNumber: "+14385550199",
      toNumber: "+15145550100",
      durationS: 240,
      retentionDays: 30,
      deleteAfter: new Date(now.getTime() + 30 * 86_400_000),
    });
    const summary = { text: "Marie Tremblay veut un devis pour 3 postes.", actionItems: ["Envoyer le devis"] };
    await ctx.repo.pbx.setCallSummary(rec.id, { summaryEncrypted: ctx.deps.cipher.encrypt(JSON.stringify(summary)), locale: "fr-CA", model: null });
    await queueCalendarSync(ctx.deps, { userId: biz.owner.user.id, sourceType: "call_summary", sourceId: rec.id });
    expect(await runCalendarSync(ctx.deps, silentLog)).toMatchObject({ sent: 1 });
    const [first] = inserted();
    expect(first.summary).toBe("Résumé IA — appel avec (438) 555-0199");
    expect(first.description).not.toContain("Marie");
    expect(first.description).toContain(`/affaires/${biz.business.id}/enregistrements`);

    await call("PUT", P, biz.owner.auth, { includeContent: true });
    await ctx.repo.addConsent({ userId: biz.owner.user.id, kind: AI_CONSENT_KIND as never, granted: true, version: "test", source: "test", at: now, ip: null });
    await ctx.repo.calendar.deleteConnection(biz.owner.user.id);
    ctx.repo.calendar.jobs.length = 0;
    await connect(biz.owner);
    await call("PUT", P, biz.owner.auth, { includeContent: true });
    await queueCalendarSync(ctx.deps, { userId: biz.owner.user.id, sourceType: "call_summary", sourceId: rec.id });
    await runCalendarSync(ctx.deps, silentLog);
    expect(inserted()[1].description).toContain("Marie Tremblay veut un devis");
    expect(inserted()[1].description).toContain("• Envoyer le devis");
    // Same source, same id: Google would answer 409 on a real calendar.
    expect(inserted()[1].id).toBe(first.id);
  });

  it("voicemail webhook queues a voicemail job (with its delay)", async () => {
    const u = await connectedUser();
    await ctx.repo.upsertCall({
      twilioCallSid: "CA-vmhook",
      telecomAccountId: u.account.id,
      userId: null,
      direction: "inbound",
      kind: "pstn",
      fromNumber: "+14385550199",
      toNumber: "+15145550100",
      status: "in-progress",
      startedAt: now,
    });
    const res = await twilioPost(ctx, `/webhooks/twilio/voice/recording?n=${u.number!.id}`, {
      CallSid: "CA-vmhook",
      RecordingSid: "RE-hook",
      RecordingStatus: "completed",
      RecordingDuration: "12",
      RecordingUrl: "https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE-hook",
    });
    expect(res.statusCode).toBe(204);
    const job = jobs().find((j) => j.sourceType === "voicemail")!;
    expect(job).toBeDefined();
    expect(job.nextAttemptAt!.getTime() - now.getTime()).toBe(180_000);
  });
});

describe("billing: Google Agenda add-on checkout", () => {
  let billing: BillingGateway & { createCheckout: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    billing = {
      createCustomer: vi.fn(async () => "cus_1"),
      createCheckout: vi.fn(async () => ({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" })),
      createPortal: vi.fn(),
      constructEvent: vi.fn((raw: Buffer) => JSON.parse(raw.toString("utf8")) as Stripe.Event),
      retrieveSubscription: vi.fn(),
      paymentFingerprint: vi.fn(async () => null),
      creditBalance: vi.fn(async () => {}),
    } as never;
    ctx.deps.billing = billing;
  });
  const checkout = (auth: Record<string, string>, payload: object) => ctx.app.inject({ method: "POST", url: "/v1/billing/checkout", headers: auth, payload });

  it("Essentiel: 3,95 $/mo with a 14-day trial the first time; yearly 43,45 $", async () => {
    const u = await subscribed("lock");
    expect((await checkout(u.auth, { addon: "google_calendar" })).statusCode).toBe(200);
    expect(billing.createCheckout.mock.calls[0]![0]).toMatchObject({
      mode: "subscription",
      trialDays: 14,
      line: { unitAmountCents: 395, recurring: "month", name: "MIMT Google Agenda" },
      metadata: { kind: "addon", code: "google_calendar" },
    });
    expect((await checkout(u.auth, { addon: "google_calendar", interval: "year" })).statusCode).toBe(200);
    expect(billing.createCheckout.mock.calls[1]![0].line).toMatchObject({ unitAmountCents: 4345, recurring: "year" });
  });

  it("no second trial; refused on Affaires (included), on free, and when already subscribed", async () => {
    const tried = await subscribed("premium", { status: "canceled" });
    expect((await checkout(tried.auth, { addon: "google_calendar" })).statusCode).toBe(200);
    expect(billing.createCheckout.mock.calls[0]![0].trialDays).toBeUndefined();
    const biz = await subscribed("business");
    expect((await checkout(biz.auth, { addon: "google_calendar" })).json().error).toBe("already_included");
    const free = await subscribed(null);
    expect((await checkout(free.auth, { addon: "google_calendar" })).json().error).toBe("plan_required");
    const has = await subscribed("premium", { status: "active" });
    expect((await checkout(has.auth, { addon: "google_calendar" })).json().error).toBe("already_subscribed");
  });
});
