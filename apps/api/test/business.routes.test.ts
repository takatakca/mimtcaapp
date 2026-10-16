import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BusinessHoursRequest } from "@mimt/shared";
import { makeUser, setup, type Ctx } from "./helpers.js";
import { makeBusiness, subscribe } from "./pbxFixtures.js";

let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup({ now: () => new Date("2026-10-14T14:00:00Z") });
});
afterEach(() => ctx.app.close());

type Headers = Record<string, string>;
const req = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, headers: Headers, payload?: unknown) =>
  ctx.app.inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });

const HOURS: BusinessHoursRequest = {
  weekly: { mon: [{ open: "09:00", close: "17:00" }], tue: [], wed: [{ open: "09:00", close: "17:00" }], thu: [], fri: [], sat: [], sun: [] },
  holidays: [{ date: "2026-12-26", name: "Lendemain de Noël" }],
  quebecHolidays: true,
  openTarget: { type: "voicemail" },
  closedTarget: { type: "voicemail" },
};

describe("business: create and list", () => {
  it("creates a business owned by the caller and lists it with the role and seats", async () => {
    const u = await makeUser(ctx);
    const res = await req("POST", "/v1/business", u.auth, { name: "Dépanneur Test" });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ role: "owner", seats: 1, business: { name: "Dépanneur Test", locale: "fr-CA", telecomAccountId: u.account.id } });
    expect(body.business.recordingPolicy.mode).toBe("off");

    const list = await req("GET", "/v1/business", u.auth);
    expect(list.json().businesses).toHaveLength(1);
    expect((await req("POST", "/v1/business", u.auth, { name: "Encore" })).statusCode).toBe(409);
    expect((await ctx.repo.getAccount(u.account.id))!.kind).toBe("business");
  });

  it("refuses a TAKATAK business id that does not come from the signed handoff", async () => {
    const u = await makeUser(ctx);
    const res = await req("POST", "/v1/business", u.auth, { name: "X", takatakBusinessId: "biz_other" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("takatak_business_mismatch");
    await ctx.repo.updateAccount(u.account.id, { businessId: "biz_1" });
    expect((await req("POST", "/v1/business", u.auth, { name: "X", takatakBusinessId: "biz_1" })).statusCode).toBe(201);
  });

  it("requires authentication", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/v1/business" })).statusCode).toBe(401);
  });
});

describe("business: access control", () => {
  it("non-members get 404 on every business route; members get 403 on admin routes", async () => {
    const { business, staff, ext } = await makeBusiness(ctx);
    const stranger = await makeUser(ctx);
    const b = `/v1/business/${business.id}`;
    const strangerCalls: Array<[Parameters<typeof req>[0], string, unknown?]> = [
      ["GET", b],
      ["PATCH", b, { name: "pwned" }],
      ["GET", `${b}/members`],
      ["GET", `${b}/extensions`],
      ["PATCH", `${b}/extensions/${ext.id}`, { displayName: "pwned" }],
      ["DELETE", `${b}/extensions/${ext.id}`],
      ["GET", `${b}/hours`],
      ["PUT", `${b}/hours`, HOURS],
      ["GET", `${b}/dids`],
      ["GET", `${b}/calls`],
      ["GET", `${b}/recordings`],
      ["GET", `${b}/usage`],
      ["GET", `${b}/ai-receptionist`],
    ];
    for (const [method, url, payload] of strangerCalls) {
      const res = await req(method, url, stranger.auth, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    // Unknown or malformed id: same 404.
    expect((await req("GET", "/v1/business/not-a-uuid", stranger.auth)).statusCode).toBe(404);

    // A plain member can read but not administer.
    expect((await req("GET", `${b}/extensions`, staff.auth)).statusCode).toBe(200);
    for (const [method, url, payload] of [
      ["PATCH", b, { name: "x" }],
      ["POST", `${b}/extensions`, { number: "102", displayName: "x" }],
      ["PUT", `${b}/hours`, HOURS],
      ["POST", `${b}/members`, { email: "a@b.ca", role: "member" }],
      ["GET", `${b}/usage`],
      ["POST", `${b}/seats`, { count: 2 }],
    ] as Array<[Parameters<typeof req>[0], string, unknown]>) {
      const res = await req(method, url, staff.auth, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json().error).toBe("business_role_required");
    }
    // Nothing changed.
    expect((await ctx.repo.pbx.getExtension(ext.id))!.displayName).toBe("Réception");
  });

  it("objects of another business cannot be referenced", async () => {
    const a = await makeBusiness(ctx);
    const other = await makeBusiness(ctx, { did: "+15145550222" });
    const b = `/v1/business/${a.business.id}`;
    // Other business's extension: 404 on direct access, 400 as a target.
    expect((await req("PATCH", `${b}/extensions/${other.ext.id}`, a.owner.auth, { displayName: "x" })).statusCode).toBe(404);
    const ivr = await req("POST", `${b}/ivr`, a.owner.auth, {
      name: "Menu",
      greeting: { fr: "Bonjour", en: "Hello" },
      options: [{ digit: "1", target: { type: "extension", extensionId: other.ext.id } }],
    });
    expect(ivr.statusCode).toBe(400);
    expect(ivr.json().error).toBe("invalid_target");
    // Other business's number.
    const did = await req("PUT", `${b}/dids`, a.owner.auth, { e164: other.didNumber.e164, target: { type: "voicemail" } });
    expect(did.statusCode).toBe(400);
    expect(did.json().error).toBe("number_not_in_business");
  });
});

describe("business: members and invitations", () => {
  it("invites by email; the invited user claims after sign-in", async () => {
    const { business, owner } = await makeBusiness(ctx);
    const inv = await req("POST", `/v1/business/${business.id}/members`, owner.auth, { email: "Nouvelle@Test.ca", role: "admin" });
    expect(inv.statusCode).toBe(201);
    expect(inv.json()).toMatchObject({ status: "invited", role: "admin", userId: null });
    expect((await req("POST", `/v1/business/${business.id}/members`, owner.auth, { email: "nouvelle@test.ca", role: "member" })).statusCode).toBe(409);

    const newbie = await makeUser(ctx);
    await ctx.repo.updateUser(newbie.user.id, { email: "nouvelle@test.ca" });
    expect((await req("GET", `/v1/business/${business.id}`, newbie.auth)).statusCode).toBe(404);
    const claim = await req("POST", "/v1/business/invites/claim", newbie.auth);
    expect(claim.json().claimed).toEqual([expect.objectContaining({ businessId: business.id, role: "admin" })]);
    expect((await req("GET", `/v1/business/${business.id}`, newbie.auth)).json().role).toBe("admin");
  });

  it("the owner cannot be changed or removed; only the owner manages admins", async () => {
    const { business, owner, staff, ext } = await makeBusiness(ctx);
    const b = `/v1/business/${business.id}`;
    const members = (await req("GET", `${b}/members`, owner.auth)).json().members as Array<{ id: string; role: string; userId: string }>;
    const ownerRow = members.find((m) => m.role === "owner")!;
    const staffRow = members.find((m) => m.userId === staff.user.id)!;

    // Promote staff to admin (owner only).
    expect((await req("PATCH", `${b}/members/${staffRow.id}`, owner.auth, { role: "admin" })).json().role).toBe("admin");
    // The new admin cannot touch the owner or demote themselves.
    expect((await req("DELETE", `${b}/members/${ownerRow.id}`, staff.auth)).statusCode).toBe(403);
    expect((await req("PATCH", `${b}/members/${ownerRow.id}`, staff.auth, { role: "member" })).statusCode).toBe(403);
    expect((await req("PATCH", `${b}/members/${staffRow.id}`, staff.auth, { role: "member" })).statusCode).toBe(403);

    // Removing a member unassigns their extension (it keeps its voicemail box).
    expect((await req("DELETE", `${b}/members/${staffRow.id}`, owner.auth)).statusCode).toBe(204);
    expect((await ctx.repo.pbx.getExtension(ext.id))!.userId).toBeNull();
    expect((await req("GET", b, staff.auth)).statusCode).toBe(404);
  });
});

describe("business: extensions, ring groups, IVR, hours, DIDs", () => {
  it("validates extensions (dial plan, members, numbers)", async () => {
    const { business, owner, staff } = await makeBusiness(ctx);
    const b = `/v1/business/${business.id}/extensions`;
    const ok = await req("POST", b, owner.auth, { number: "102", displayName: "Cuisine", userId: owner.user.id, forwardToMobile: "+14385550111" });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ number: "102", ringTimeoutS: 25, voicemail: { enabled: true, greeting: null } });

    expect((await req("POST", b, owner.auth, { number: "101", displayName: "Dup" })).json().error).toBe("extension_number_taken");
    for (const bad of ["911", "933", "411", "012", "12345"]) {
      expect((await req("POST", b, owner.auth, { number: bad, displayName: "x" })).statusCode, bad).toBe(400);
    }
    const stranger = await makeUser(ctx);
    expect((await req("POST", b, owner.auth, { number: "103", displayName: "x", userId: stranger.user.id })).json().error).toBe("user_not_member");
    expect((await req("POST", b, owner.auth, { number: "103", displayName: "x", forwardToMobile: "+19005550100" })).statusCode).toBe(400);
    expect((await req("POST", b, owner.auth, { number: "103", displayName: "x", did: "+15145559999" })).json().error).toBe("number_not_in_business");

    const patched = await req("PATCH", `${b}/${ok.json().id}`, owner.auth, { userId: staff.user.id, ringTimeoutS: 30 });
    expect(patched.json()).toMatchObject({ userId: staff.user.id, ringTimeoutS: 30, number: "102" });
    expect((await req("DELETE", `${b}/${ok.json().id}`, owner.auth)).statusCode).toBe(204);
  });

  it("ring groups need the plan feature and valid members/overflow", async () => {
    const { business, owner, ext } = await makeBusiness(ctx);
    const b = `/v1/business/${business.id}/ring-groups`;
    const body = { name: "Ventes", number: "200", strategy: "sequential", memberExtensionIds: [ext.id], overflow: { type: "voicemail" } };
    const created = await req("POST", b, owner.auth, body);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ timeoutS: 20, memberExtensionIds: [ext.id] });
    // Dial plan shared with extensions.
    expect((await req("POST", `/v1/business/${business.id}/extensions`, owner.auth, { number: "200", displayName: "x" })).statusCode).toBe(409);
    // Self overflow refused on update.
    const self = await req("PUT", `${b}/${created.json().id}`, owner.auth, { ...body, overflow: { type: "ring_group", ringGroupId: created.json().id } });
    expect(self.statusCode).toBe(400);
    expect((await req("PUT", `${b}/${created.json().id}`, owner.auth, { ...body, strategy: "simultaneous" })).json().strategy).toBe("simultaneous");
    expect((await req("GET", b, owner.auth)).json().ringGroups).toHaveLength(1);

    // Free plan: no ring groups.
    const free = await makeUser(ctx);
    const biz = (await req("POST", "/v1/business", free.auth, { name: "Gratuit" })).json().business;
    const refused = await req("POST", `/v1/business/${biz.id}/ring-groups`, free.auth, { ...body, memberExtensionIds: [], number: null });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe("plan_required");
  });

  it("IVR menus: unique digits, default timeouts", async () => {
    const { business, owner, ext } = await makeBusiness(ctx);
    const b = `/v1/business/${business.id}/ivr`;
    const menu = {
      name: "Principal",
      greeting: { fr: "Pour la réception, faites le 1.", en: "For reception, press 1." },
      options: [
        { digit: "1", target: { type: "extension", extensionId: ext.id } },
        { digit: "0", target: { type: "directory" } },
      ],
    };
    const created = await req("POST", b, owner.auth, menu);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ timeoutS: 6, maxRetries: 2, timeoutTarget: null });
    const dup = await req("POST", b, owner.auth, { ...menu, options: [menu.options[0], menu.options[0]] });
    expect(dup.statusCode).toBe(400);
    const sched = await req("POST", b, owner.auth, { ...menu, options: [{ digit: "1", target: { type: "schedule" } }] });
    expect(sched.statusCode).toBe(400);
    expect((await req("DELETE", `${b}/${created.json().id}`, owner.auth)).statusCode).toBe(204);
  });

  it("hours: defaults, update and the open flag", async () => {
    const { business, owner } = await makeBusiness(ctx);
    const b = `/v1/business/${business.id}/hours`;
    const def = (await req("GET", b, owner.auth)).json();
    expect(def.hours).toMatchObject({ timezone: "America/Montreal", quebecHolidays: true });
    expect(def.open).toBe(true); // Wednesday 10:00 in Montreal
    const put = await req("PUT", b, owner.auth, { ...HOURS, weekly: { ...HOURS.weekly, wed: [] } });
    expect(put.statusCode).toBe(200);
    expect(put.json().open).toBe(false);
    expect(put.json().hours.holidays).toEqual(HOURS.holidays);
    // "schedule" inside the hours would loop.
    expect((await req("PUT", b, owner.auth, { ...HOURS, openTarget: { type: "schedule" } })).statusCode).toBe(400);
    expect((await req("PUT", b, owner.auth, { ...HOURS, weekly: { ...HOURS.weekly, mon: [{ open: "17:00", close: "09:00" }] } })).statusCode).toBe(400);
  });

  it("DID routes: business numbers only, schedule allowed, external NANP only", async () => {
    const { business, owner, didNumber } = await makeBusiness(ctx);
    const b = `/v1/business/${business.id}/dids`;
    const put = await req("PUT", b, owner.auth, { e164: didNumber.e164, target: { type: "schedule" } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ e164: didNumber.e164, phoneNumberId: didNumber.id, target: { type: "schedule" } });
    // Upsert re-points the same number.
    await req("PUT", b, owner.auth, { e164: didNumber.e164, target: { type: "external", number: "+14165550123" } });
    const list = (await req("GET", b, owner.auth)).json().routes;
    expect(list).toHaveLength(1);
    expect(list[0].target.type).toBe("external");
    const premium = await req("PUT", b, owner.auth, { e164: didNumber.e164, target: { type: "external", number: "+19005550123" } });
    expect(premium.json().error).toBe("external_number_not_allowed");
    expect((await req("DELETE", `${b}/${list[0].id}`, owner.auth)).statusCode).toBe(204);
  });
});

describe("business: recording policy, seats, usage, calls", () => {
  it("call recording needs Affaires Pro", async () => {
    const { business, owner } = await makeBusiness(ctx);
    const url = `/v1/business/${business.id}/recording-policy`;
    const refused = await req("PUT", url, owner.auth, { mode: "all" });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe("plan_required");
    expect((await req("PUT", url, owner.auth, { mode: "off" })).statusCode).toBe(200);

    await subscribe(ctx, business.telecomAccountId, "business_pro");
    const ok = await req("PUT", url, owner.auth, { mode: "all", retentionDays: 30 });
    expect(ok.json().business.recordingPolicy).toMatchObject({ mode: "all", retentionDays: 30, consentPrompt: { fr: expect.stringContaining("enregistré") } });
  });

  it("usage pools the per-line caps over the seats synced from Stripe (PBX-01 tests: business.seats.test.ts)", async () => {
    const { business, owner } = await makeBusiness(ctx); // subscription quantity 5
    await ctx.repo.pbx.setSeats(business.id, 4, null);
    const usage = (await req("GET", `/v1/business/${business.id}/usage`, owner.auth)).json();
    expect(usage).toMatchObject({ plan: "business", seats: 4, pooled: { outboundMinutes: { used: 0, cap: 4000 }, concurrentCalls: { cap: 8 } } });
    // A stale mirror above the paid quantity never widens the pool.
    await ctx.repo.pbx.setSeats(business.id, 9, null);
    expect((await req("GET", `/v1/business/${business.id}/usage`, owner.auth)).json().seats).toBe(5);
  });

  it("calls: admins see every call, members only their own", async () => {
    const { business, owner, staff } = await makeBusiness(ctx);
    const base = { telecomAccountId: business.telecomAccountId, direction: "outbound" as const, kind: "pstn" as const, toNumber: "+14185550000", status: "completed" };
    await ctx.repo.upsertCall({ ...base, twilioCallSid: "CA1", userId: owner.user.id, fromNumber: "+15145550100", startedAt: new Date("2026-10-14T13:00:00Z") });
    await ctx.repo.upsertCall({ ...base, twilioCallSid: "CA2", userId: staff.user.id, fromNumber: "+15145550100", startedAt: new Date("2026-10-14T13:05:00Z") });
    const url = `/v1/business/${business.id}/calls`;
    expect((await req("GET", url, owner.auth)).json().calls).toHaveLength(2);
    const mine = (await req("GET", url, staff.auth)).json().calls;
    expect(mine).toHaveLength(1);
    expect(mine[0].userId).toBe(staff.user.id);
    const page = (await req("GET", `${url}?limit=1`, owner.auth)).json();
    expect(page.nextCursor).toBeTruthy();
  });

  it("number claim: business plan, 9-1-1 address and a free line are required", async () => {
    const { business, owner } = await makeBusiness(ctx);
    const res = await req("POST", `/v1/business/${business.id}/numbers/claim`, owner.auth, { e164: "+15145550177" });
    expect(res.statusCode).toBe(201);
    const routes = await ctx.repo.pbx.listDidRoutes(business.id);
    expect(routes.find((r) => r.e164 === "+15145550177")?.target).toEqual({ type: "schedule" });
    expect(ctx.twilio!.purchaseNumber).toHaveBeenCalledTimes(1);
  });
});
