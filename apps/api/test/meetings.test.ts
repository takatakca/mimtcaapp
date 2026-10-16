import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccessToken, TokenVerifier } from "livekit-server-sdk";
import { MEETING_MAX_DURATION_S, type MeetingTokenResponse } from "@mimt/shared";
import { hashGuestToken } from "../src/routes/meetings.js";
import type { EmailMessage } from "../src/services/email.js";
import { LiveKitVideoGateway, VideoParticipantNotFoundError, type VideoGateway, type VideoParticipant, type VideoTokenRequest } from "../src/video/gateway.js";
import { makeUser, setup, type Ctx } from "./helpers.js";
import { makeBusiness, subscribe } from "./pbxFixtures.js";

/** In-memory SFU: records tokens and permission updates; participants are set by the test. */
function fakeVideo() {
  const tokens: VideoTokenRequest[] = [];
  const updates: Array<{ room: string; identity: string; metadata: string; permission: unknown }> = [];
  const rooms = new Map<string, VideoParticipant[]>();
  const deleted: string[] = [];
  const ensured: Array<{ room: string; maxParticipants: number }> = [];
  const gw: VideoGateway & { tokens: typeof tokens; updates: typeof updates; rooms: typeof rooms; deleted: string[]; ensured: typeof ensured } = {
    url: "wss://rtc.test.mimt.ca",
    tokens,
    updates,
    rooms,
    deleted,
    ensured,
    async createToken(req) {
      tokens.push(req);
      return `tok.${req.identity}`;
    },
    async ensureRoom(room, opts) {
      ensured.push({ room, maxParticipants: opts.maxParticipants });
    },
    async listParticipants(room) {
      return rooms.get(room) ?? [];
    },
    async updateParticipant(room, identity, update) {
      if (!(rooms.get(room) ?? []).some((p) => p.identity === identity)) throw new VideoParticipantNotFoundError();
      updates.push({ room, identity, ...update });
    },
    async deleteRoom(room) {
      deleted.push(room);
      rooms.delete(room);
    },
    async receiveWebhook() {
      throw new Error("not used: webhook tests use the real LiveKit gateway");
    },
  };
  return gw;
}

const NOW = new Date("2026-10-16T14:00:00Z");
let ctx: Ctx;
let video: ReturnType<typeof fakeVideo>;
let clock: Date;
let sent: EmailMessage[];

beforeEach(async () => {
  clock = NOW;
  ctx = await setup({ now: () => clock });
  video = fakeVideo();
  sent = [];
  ctx.deps.video = video;
  ctx.deps.email = { send: async (m) => void sent.push(m) };
});
afterEach(() => ctx.app.close());

type Headers = Record<string, string>;
const req = (method: "GET" | "POST" | "PATCH", url: string, headers: Headers = {}, payload?: unknown) =>
  ctx.app.inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });

async function premiumUser() {
  const u = await makeUser(ctx);
  await subscribe(ctx, u.account.id, "premium", 1);
  return u;
}

async function createMeeting(auth: Headers, body: Record<string, unknown> = {}) {
  const res = await req("POST", "/v1/meetings", auth, { title: "Point d'équipe", ...body });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string; maxParticipants: number; status: string; lobbyEnabled: boolean; joinUrl: string };
}

async function guestLink(auth: Headers, meetingId: string) {
  const res = await req("POST", `/v1/meetings/${meetingId}/invites`, auth, {});
  expect(res.statusCode, res.body).toBe(201);
  const link = res.json().invites[0].link as string;
  return link.split("/reunion/")[1]!;
}

const room = async (id: string) => (await ctx.repo.meetings.get(id))!.roomName;

describe("meetings: configuration and plan gating", () => {
  it("answers 503 not_configured without LiveKit, including the guest join", async () => {
    ctx.deps.video = null;
    const u = await premiumUser();
    for (const [method, url] of [["GET", "/v1/meetings"], ["POST", "/v1/meetings"]] as const) {
      const res = await req(method, url, u.auth, method === "POST" ? { title: "x" } : undefined);
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe("not_configured");
    }
    const guest = await req("POST", "/v1/meetings/join/guest", {}, { guestToken: "a".repeat(43), displayName: "Invité" });
    expect(guest.statusCode).toBe(503);
    const hook = await ctx.app.inject({ method: "POST", url: "/webhooks/livekit", headers: { "content-type": "application/webhook+json" }, payload: "{}" });
    expect(hook.statusCode).toBe(503);
  });

  it("requires authentication", async () => {
    expect((await req("GET", "/v1/meetings")).statusCode).toBe(401);
  });

  it("refuses free plans and caps participants by plan (premium 4, business 25, business_pro 100)", async () => {
    const free = await makeUser(ctx);
    const res = await req("POST", "/v1/meetings", free.auth, { title: "x" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("plan_required");

    expect((await createMeeting((await premiumUser()).auth)).maxParticipants).toBe(4);
    const biz = await makeBusiness(ctx);
    expect((await createMeeting(biz.owner.auth, { businessId: biz.business.id })).maxParticipants).toBe(25);
    const pro = await makeBusiness(ctx, { plan: "business_pro", did: "+15145550101" });
    expect((await createMeeting(pro.owner.auth, { businessId: pro.business.id })).maxParticipants).toBe(100);
  });

  it("validates the schedule", async () => {
    const u = await premiumUser();
    const res = await req("POST", "/v1/meetings", u.auth, { title: "x", scheduledStart: "2026-10-20T15:00:00Z", scheduledEnd: "2026-10-20T14:00:00Z" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_schedule");
  });
});

describe("meetings: business access", () => {
  it("only owner/admin create business meetings; every member sees and joins them; strangers get 404", async () => {
    const { owner, staff, business } = await makeBusiness(ctx);
    const denied = await req("POST", "/v1/meetings", staff.auth, { title: "x", businessId: business.id });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error).toBe("business_role_required");
    const stranger = await premiumUser();
    expect((await req("POST", "/v1/meetings", stranger.auth, { title: "x", businessId: business.id })).statusCode).toBe(404);

    const m = await createMeeting(owner.auth, { businessId: business.id });
    const list = await req("GET", "/v1/meetings", staff.auth);
    expect(list.json().meetings.map((x: { id: string }) => x.id)).toEqual([m.id]);
    expect(list.json().meetings[0].canManage).toBe(false);

    const tok = await req("POST", `/v1/meetings/${m.id}/token`, staff.auth);
    expect(tok.statusCode, tok.body).toBe(200);
    expect(tok.json()).toMatchObject({ role: "participant", canPublish: true, waiting: false, identity: staff.user.id });

    expect((await req("GET", `/v1/meetings/${m.id}`, stranger.auth)).statusCode).toBe(404);
    expect((await req("POST", `/v1/meetings/${m.id}/token`, stranger.auth)).statusCode).toBe(404);
    expect((await req("GET", "/v1/meetings/not-a-uuid", stranger.auth)).statusCode).toBe(404);
  });

  it("only the host (or a business admin) edits, invites, admits and ends", async () => {
    const { owner, staff, business } = await makeBusiness(ctx);
    const m = await createMeeting(owner.auth, { businessId: business.id });
    for (const [method, url, body] of [
      ["PATCH", `/v1/meetings/${m.id}`, { title: "pwned" }],
      ["POST", `/v1/meetings/${m.id}/invites`, {}],
      ["POST", `/v1/meetings/${m.id}/admit`, { identity: "guest-x" }],
      ["POST", `/v1/meetings/${m.id}/end`, {}],
    ] as const) {
      const res = await req(method, url, staff.auth, body);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json().error).toBe("meeting_host_required");
    }
    const ended = await req("POST", `/v1/meetings/${m.id}/end`, owner.auth, {});
    expect(ended.statusCode).toBe(200);
    expect(ended.json().status).toBe("ended");
    expect(video.deleted).toEqual([await room(m.id)]);
    const late = await req("POST", `/v1/meetings/${m.id}/token`, staff.auth);
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toBe("meeting_ended");
    expect((await ctx.repo.meetings.listEvents(m.id)).map((e) => e.type)).toEqual(["ended"]);
  });
});

describe("meetings: tokens", () => {
  it("grants the meeting's room only, with the user id as identity and the display name; the host is room admin", async () => {
    const host = await premiumUser();
    const m = await createMeeting(host.auth);
    const res = await req("POST", `/v1/meetings/${m.id}/token`, host.auth);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as MeetingTokenResponse;
    expect(body).toMatchObject({ url: "wss://rtc.test.mimt.ca", identity: host.user.id, role: "host", canPublish: true, waiting: false });
    expect(new Date(body.expiresAt).getTime() - NOW.getTime()).toBe(3600_000);
    const t = video.tokens[0]!;
    expect(t).toMatchObject({ room: await room(m.id), identity: host.user.id, name: "Test", ttlS: 3600, canPublish: true, canSubscribe: true, roomAdmin: true });
    expect(JSON.parse(t.metadata)).toEqual({ role: "host", waiting: false });
    expect(video.ensured).toEqual([{ room: t.room, maxParticipants: 4 }]);
    // First token starts the meeting.
    expect((await ctx.repo.meetings.get(m.id))!.status).toBe("live");
    expect(JSON.stringify(body)).not.toContain(ctx.deps.config.LIVEKIT_API_SECRET ?? "never-set");
  });

  it("enforces the participant cap at token issuance (rejoining is allowed)", async () => {
    const host = await premiumUser();
    const m = await createMeeting(host.auth);
    const r = await room(m.id);
    video.rooms.set(r, [1, 2, 3, 4].map((i) => ({ identity: `p${i}`, name: `P${i}`, metadata: "" })));
    const full = await req("POST", `/v1/meetings/${m.id}/token`, host.auth);
    expect(full.statusCode).toBe(409);
    expect(full.json().error).toBe("meeting_full");
    video.rooms.set(r, [{ identity: host.user.id, name: "Test", metadata: "" }, ...[1, 2, 3].map((i) => ({ identity: `p${i}`, name: `P${i}`, metadata: "" }))]);
    expect((await req("POST", `/v1/meetings/${m.id}/token`, host.auth)).statusCode).toBe(200);
  });

  it("ends a meeting at its 4-hour limit and shortens tokens near it", async () => {
    const host = await premiumUser();
    const m = await createMeeting(host.auth);
    await req("POST", `/v1/meetings/${m.id}/token`, host.auth);
    clock = new Date(NOW.getTime() + (MEETING_MAX_DURATION_S - 600) * 1000);
    expect((await req("POST", `/v1/meetings/${m.id}/token`, host.auth)).statusCode).toBe(200);
    expect(video.tokens[1]!.ttlS).toBe(600);
    clock = new Date(NOW.getTime() + MEETING_MAX_DURATION_S * 1000);
    const res = await req("POST", `/v1/meetings/${m.id}/token`, host.auth);
    expect(res.statusCode).toBe(409);
    expect((await ctx.repo.meetings.get(m.id))!.status).toBe("ended");
  });
});

describe("meetings: guests and lobby", () => {
  it("emails one link per address (only the token hash is stored) and returns a shareable link without email", async () => {
    const host = await premiumUser();
    const m = await createMeeting(host.auth, { scheduledStart: "2026-10-20T14:00:00Z" });
    const res = await req("POST", `/v1/meetings/${m.id}/invites`, host.auth, { emails: ["Ami@Exemple.ca", "ami@exemple.ca", "b@exemple.ca"] });
    expect(res.statusCode).toBe(201);
    const invites = res.json().invites as Array<{ email: string; link: string; emailed: boolean; expiresAt: string }>;
    expect(invites.map((i) => [i.email, i.emailed])).toEqual([["ami@exemple.ca", true], ["b@exemple.ca", true]]);
    expect(invites[0]!.link).toMatch(/^https:\/\/app\.mimt\.ca\/reunion\/[A-Za-z0-9_-]{43}$/);
    expect(new Date(invites[0]!.expiresAt).getTime() - NOW.getTime()).toBe(7 * 86_400_000);
    expect(sent.map((s) => s.to)).toEqual(["ami@exemple.ca", "b@exemple.ca"]);
    expect(sent[0]!.text).toContain(invites[0]!.link);
    expect(sent[0]!.text.indexOf("vous invite")).toBeLessThan(sent[0]!.text.indexOf("invites you"));
    const token = invites[0]!.link.split("/reunion/")[1]!;
    const stored = [...ctx.repo.meetings.invites.values()];
    expect(stored.some((i) => i.guestTokenHash === createHash("sha256").update(token).digest("hex"))).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(token);

    // No email provider: links are still returned, emailed=false.
    ctx.deps.email = { send: async () => Promise.reject(new Error("email_provider_not_configured")) };
    const again = await req("POST", `/v1/meetings/${m.id}/invites`, host.auth, { emails: ["c@exemple.ca"] });
    expect(again.json().invites[0]).toMatchObject({ email: "c@exemple.ca", emailed: false });
    const anon = await req("POST", `/v1/meetings/${m.id}/invites`, host.auth, {});
    expect(anon.json().invites).toHaveLength(1);
    expect(anon.json().invites[0].email).toBeNull();

    const detail = await req("GET", `/v1/meetings/${m.id}`, host.auth);
    expect(detail.json().invites).toHaveLength(4);
    expect(JSON.stringify(detail.json())).not.toContain("guestTokenHash");
  });

  it("a guest token works for its meeting only, until it expires", async () => {
    const host = await premiumUser();
    const m1 = await createMeeting(host.auth, { lobbyEnabled: false });
    await createMeeting(host.auth);
    const token = await guestLink(host.auth, m1.id);

    const info = await req("POST", "/v1/meetings/join/guest/info", {}, { guestToken: token });
    expect(info.json()).toMatchObject({ title: "Point d'équipe", hostName: "Test", lobbyEnabled: false });

    const res = await req("POST", "/v1/meetings/join/guest", {}, { guestToken: token, displayName: "  Alex\u0007 " });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ role: "guest", waiting: false, canPublish: true, meeting: { id: m1.id } });
    const t = video.tokens.at(-1)!;
    expect(t.room).toBe(await room(m1.id));
    expect(t.identity).toMatch(/^guest-[0-9a-f]{8}-[0-9a-f]{8}$/);
    expect(t).toMatchObject({ name: "Alex", roomAdmin: false, canPublish: true });
    expect([...ctx.repo.meetings.invites.values()].find((i) => i.guestTokenHash === hashGuestToken(token))!.usedAt).toEqual(NOW);

    const bad = await req("POST", "/v1/meetings/join/guest", {}, { guestToken: "x".repeat(43), displayName: "Alex" });
    expect(bad.statusCode).toBe(404);
    expect(bad.json().error).toBe("invalid_guest_token");

    clock = new Date(NOW.getTime() + 7 * 86_400_000 + 1000);
    const expired = await req("POST", "/v1/meetings/join/guest", {}, { guestToken: token, displayName: "Alex" });
    expect(expired.statusCode).toBe(410);
    expect(expired.json().error).toBe("invite_expired");
  });

  it("rate-limits guest attempts per IP", async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await req("POST", "/v1/meetings/join/guest", {}, { guestToken: "y".repeat(43), displayName: "A" })).statusCode;
    expect(last).toBe(429);
  });

  it("lobby: a guest waits without publishing nor subscribing until the host admits them", async () => {
    const host = await premiumUser();
    const m = await createMeeting(host.auth);
    expect(m.lobbyEnabled).toBe(true);
    const token = await guestLink(host.auth, m.id);
    const res = await req("POST", "/v1/meetings/join/guest", {}, { guestToken: token, displayName: "Invitée" });
    expect(res.json()).toMatchObject({ waiting: true, canPublish: false });
    const t = video.tokens.at(-1)!;
    expect(t).toMatchObject({ canPublish: false, canSubscribe: false, canPublishData: false });
    expect(JSON.parse(t.metadata)).toEqual({ role: "guest", waiting: true });

    const r = await room(m.id);
    const missing = await req("POST", `/v1/meetings/${m.id}/admit`, host.auth, { identity: t.identity });
    expect(missing.statusCode).toBe(404);
    video.rooms.set(r, [{ identity: t.identity, name: "Invitée", metadata: t.metadata }]);
    expect((await req("POST", `/v1/meetings/${m.id}/admit`, host.auth, { identity: host.user.id })).statusCode).toBe(400);
    const ok = await req("POST", `/v1/meetings/${m.id}/admit`, host.auth, { identity: t.identity });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(video.updates[0]).toMatchObject({ room: r, identity: t.identity, permission: { canPublish: true, canSubscribe: true, canPublishData: true } });
    expect(JSON.parse(video.updates[0]!.metadata)).toEqual({ role: "guest", waiting: false });
    expect((await ctx.repo.meetings.listEvents(m.id)).map((e) => e.type)).toContain("admitted");
  });
});

describe("meetings: LiveKit webhook", () => {
  const KEY = "APItestkey";
  const SECRET = "test-livekit-secret-0123456789abcdef";

  async function signedPost(body: string, secret = SECRET) {
    const at = new AccessToken(KEY, secret);
    at.sha256 = createHash("sha256").update(body).digest("base64");
    return ctx.app.inject({
      method: "POST",
      url: "/webhooks/livekit",
      headers: { "content-type": "application/webhook+json", authorization: await at.toJwt() },
      payload: body,
    });
  }

  it("rejects a bad signature and updates status and events on a valid one", async () => {
    ctx.deps.video = new LiveKitVideoGateway("wss://rtc.test.mimt.ca", KEY, SECRET);
    const host = await premiumUser();
    const m = await createMeeting(host.auth);
    const r = await room(m.id);
    const started = JSON.stringify({ event: "room_started", room: { name: r }, id: "EV_1", createdAt: "1792159200" });

    expect((await signedPost(started, "wrong-secret-0123456789abcdefghij")).statusCode).toBe(401);
    const unsigned = await ctx.app.inject({ method: "POST", url: "/webhooks/livekit", headers: { "content-type": "application/webhook+json" }, payload: started });
    expect(unsigned.statusCode).toBe(401);
    // Body changed after signing.
    const at = new AccessToken(KEY, SECRET);
    at.sha256 = createHash("sha256").update(started).digest("base64");
    const tampered = await ctx.app.inject({
      method: "POST",
      url: "/webhooks/livekit",
      headers: { "content-type": "application/webhook+json", authorization: await at.toJwt() },
      payload: started.replace("room_started", "room_finished"),
    });
    expect(tampered.statusCode).toBe(401);
    expect((await ctx.repo.meetings.get(m.id))!.status).toBe("scheduled");

    expect((await signedPost(started)).statusCode).toBe(200);
    expect((await ctx.repo.meetings.get(m.id))!.status).toBe("live");
    await signedPost(JSON.stringify({ event: "participant_joined", room: { name: r }, participant: { identity: host.user.id } }));
    await signedPost(JSON.stringify({ event: "participant_left", room: { name: r }, participant: { identity: "guest-abc" } }));
    await signedPost(JSON.stringify({ event: "room_finished", room: { name: r } }));
    expect((await ctx.repo.meetings.get(m.id))!.status).toBe("ended");
    const events = await ctx.repo.meetings.listEvents(m.id);
    expect(events.map((e) => [e.type, e.identity, e.userId])).toEqual([
      ["started", null, null],
      ["joined", host.user.id, host.user.id],
      ["left", "guest-abc", null],
      ["ended", null, null],
    ]);
    expect((await signedPost(JSON.stringify({ event: "room_started", room: { name: "mimt-unknown" } }))).json()).toEqual({ ignored: true });
  });
});

describe("LiveKit gateway (real token signing)", () => {
  it("signs a token whose grant is limited to one room, with identity, name, metadata and ttl", async () => {
    const gw = new LiveKitVideoGateway("wss://rtc.test.mimt.ca", "APIk", "s".repeat(40));
    const jwt = await gw.createToken({
      room: "mimt-abc",
      identity: "user-1",
      name: "Camille",
      ttlS: 3600,
      metadata: '{"role":"guest","waiting":true}',
      canPublish: false,
      canSubscribe: false,
      canPublishData: false,
      roomAdmin: false,
    });
    const claims = await new TokenVerifier("APIk", "s".repeat(40)).verify(jwt);
    expect(claims.sub).toBe("user-1");
    expect(claims.name).toBe("Camille");
    expect(claims.metadata).toBe('{"role":"guest","waiting":true}');
    expect(claims.exp! - claims.nbf!).toBe(3600);
    expect(claims.video).toMatchObject({ room: "mimt-abc", roomJoin: true, roomAdmin: false, roomCreate: false, roomList: false, canPublish: false, canSubscribe: false, canPublishData: false });
    await expect(new TokenVerifier("APIk", "x".repeat(40)).verify(jwt)).rejects.toThrow();
    expect(jwt).not.toContain("s".repeat(40));
  });
});
