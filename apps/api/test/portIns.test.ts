import twilio from "twilio";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateLoaText, loaCanonicalText, type CreatePortInRequest, type NumberPortIn } from "@mimt/shared";
import type { PortInSnapshot, TwilioPortingGateway } from "../src/gateways/twilioPorting.js";
import { sha256Hex } from "../src/lib/crypto.js";
import { AUTH_TOKEN, BASE_URL, makeUser, setup, type Ctx } from "./helpers.js";
import { makeBusiness } from "./pbxFixtures.js";

const SID = "KW" + "0123456789abcdef".repeat(2);
const PORTED = "+14505550123";
const ACCOUNT_NUMBER = "ACCT-998877-SECRET";
const PIN = "4321";

/** Fake Twilio Porting API: records calls, answers the snapshot the test sets. */
function fakePorting() {
  const state: { snapshot: PortInSnapshot | null; notPortable: Set<string> } = { snapshot: null, notPortable: new Set() };
  let n = 0;
  const gw = {
    checkPortability: vi.fn(async (e164: string) => ({
      portable: !state.notPortable.has(e164),
      reason: state.notPortable.has(e164) ? "Number is not portable" : null,
      pinAndAccountNumberRequired: false,
    })),
    createPortIn: vi.fn(async () => ({ sid: SID })),
    getPortIn: vi.fn(async (sid: string) => state.snapshot ?? { sid, status: "In progress", numbers: [] }),
    cancelPortIn: vi.fn(async () => {}),
    configurePortedNumber: vi.fn(async () => ({ sid: `PNported${++n}` })),
  } satisfies TwilioPortingGateway;
  return { gw, state };
}

let ctx: Ctx;
let porting: ReturnType<typeof fakePorting>;
beforeEach(async () => {
  ctx = await setup({ now: () => new Date("2026-10-14T14:00:00Z") });
  porting = fakePorting();
  ctx.deps.porting = porting.gw;
});
afterEach(() => ctx.app.close());

type Headers = Record<string, string>;
const req = (method: "GET" | "POST", url: string, headers: Headers, payload?: unknown) =>
  ctx.app.inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });

const body = (extra: Partial<CreatePortInRequest> = {}): CreatePortInRequest => ({
  numbers: [PORTED],
  currentCarrier: "Bell Canada",
  customerType: "individual",
  customerName: "Camille Tremblay",
  authorizedName: "Camille Tremblay",
  authorizedEmail: "camille@example.ca",
  accountNumber: ACCOUNT_NUMBER,
  pin: PIN,
  serviceAddress: { street: "1 rue Sainte-Catherine", unit: null, city: "Montréal", province: "QC", postalCode: "h2x1y4" },
  ...extra,
});

/** Twilio-signed JSON webhook (bodySHA256 in the URL, signature over the URL). */
function portingWebhook(payload: object, signature?: string) {
  const raw = JSON.stringify(payload);
  const path = `/webhooks/twilio/porting?bodySHA256=${twilio.getExpectedBodyHash(raw)}`;
  const sig = signature ?? twilio.getExpectedTwilioSignature(AUTH_TOKEN, BASE_URL + path, {});
  return ctx.app.inject({ method: "POST", url: path, headers: { "content-type": "application/json", "x-twilio-signature": sig }, payload: raw });
}

async function consumer() {
  return makeUser(ctx, { e911: true, ack: true, number: "+15145550100" });
}

async function createAndSign(u: { auth: Headers }, extra: Partial<CreatePortInRequest> = {}) {
  const created = await req("POST", "/v1/port-ins", u.auth, body(extra));
  expect(created.statusCode, created.body).toBe(201);
  const id = (created.json() as NumberPortIn).id;
  const signed = await req("POST", `/v1/port-ins/${id}/sign`, { ...u.auth, "user-agent": "vitest" }, { signedName: "camille tremblay", accept: true });
  expect(signed.statusCode, signed.body).toBe(200);
  return signed.json() as NumberPortIn;
}

describe("port-in: create and validate", () => {
  it("creates a request waiting for the LOA signature, with the fee from config (0 by default)", async () => {
    const u = await consumer();
    const res = await req("POST", "/v1/port-ins", u.auth, body({ temporaryNumber: "+15145550100", desiredDate: "2026-10-30" }));
    expect(res.statusCode, res.body).toBe(201);
    const p = res.json() as NumberPortIn;
    expect(p).toMatchObject({
      kind: "consumer",
      status: "pending_signature",
      numbers: [{ e164: PORTED, status: "pending", focDate: null }],
      serviceAddress: { postalCode: "H2X 1Y4", unit: null },
      hasPin: true,
      temporaryNumber: "+15145550100",
      keepTemporaryNumber: false,
      feeCents: 0,
      loa: null,
    });
    expect(porting.gw.checkPortability).toHaveBeenCalledWith(PORTED);

    const list = await req("GET", "/v1/port-ins", u.auth);
    expect(list.json().portIns.map((x: NumberPortIn) => x.id)).toEqual([p.id]);
    expect((await req("GET", `/v1/port-ins/${p.id}`, u.auth)).json().id).toBe(p.id);
  });

  it("uses PORT_IN_FEE_CENTS when the owner sets one", async () => {
    await ctx.app.close();
    ctx = await setup({ config: { PORT_IN_FEE_CENTS: "1499" } });
    ctx.deps.porting = porting.gw;
    const u = await consumer();
    expect((await req("POST", "/v1/port-ins", u.auth, body({ temporaryNumber: "+15145550100" }))).json().feeCents).toBe(1499);
  });

  it("refuses bad input, MIMT numbers, duplicates, non-portable numbers and plans without room", async () => {
    const u = await consumer();
    const bad: Array<[Partial<CreatePortInRequest>, number, string]> = [
      [{ numbers: [] }, 400, "invalid_request"],
      [{ numbers: ["5145550123"] }, 400, "invalid_request"],
      [{ numbers: [PORTED, PORTED] }, 400, "duplicate_numbers"],
      [{ authorizedEmail: "nope" }, 400, "invalid_request"],
      [{ serviceAddress: { street: "1 rue X", unit: null, city: "Montréal", province: "QC", postalCode: "00000" } }, 400, "invalid_request"],
      [{ numbers: ["+15145550100"] }, 409, "number_already_on_mimt"],
      [{ numbers: ["+12125550123"] }, 403, "canadian_numbers_only"],
      [{ temporaryNumber: "+15145550999" }, 400, "invalid_temporary_number"],
      [{ desiredDate: "2026-01-01" }, 400, "invalid_date"],
      // Free plan: one number. The current one counts unless it is the temporary number.
      [{ temporaryNumber: undefined }, 403, "number_limit_reached"],
      [{ numbers: [PORTED, "+14505550124"] }, 403, "number_limit_reached"],
    ];
    for (const [extra, status, code] of bad) {
      const res = await req("POST", "/v1/port-ins", u.auth, { ...body({ temporaryNumber: "+15145550100" }), ...extra });
      expect(res.statusCode, JSON.stringify(extra)).toBe(status);
      expect(res.json().error, JSON.stringify(extra)).toBe(code);
    }

    porting.state.notPortable.add(PORTED);
    const np = await req("POST", "/v1/port-ins", u.auth, body({ temporaryNumber: "+15145550100" }));
    expect(np.statusCode).toBe(422);
    expect(np.json().error).toBe("not_portable");
    porting.state.notPortable.clear();

    expect((await req("POST", "/v1/port-ins", u.auth, body({ temporaryNumber: "+15145550100" }))).statusCode).toBe(201);
    const again = await req("POST", "/v1/port-ins", u.auth, body({ temporaryNumber: "+15145550100" }));
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("port_in_exists");
  });

  it("needs the 9-1-1 address and notice, and authentication", async () => {
    const noAddress = await makeUser(ctx, { ack: true });
    expect((await req("POST", "/v1/port-ins", noAddress.auth, body())).json().error).toBe("e911_address_required");
    expect((await ctx.app.inject({ method: "GET", url: "/v1/port-ins" })).statusCode).toBe(401);
  });

  it("other users cannot see or act on a request (404)", async () => {
    const u = await consumer();
    const p = (await req("POST", "/v1/port-ins", u.auth, body({ temporaryNumber: "+15145550100" }))).json() as NumberPortIn;
    const other = await makeUser(ctx, { e911: true, ack: true });
    for (const [method, url, payload] of [
      ["GET", `/v1/port-ins/${p.id}`],
      ["GET", `/v1/port-ins/${p.id}/loa`],
      ["POST", `/v1/port-ins/${p.id}/sign`, { signedName: "Camille Tremblay", accept: true }],
      ["POST", `/v1/port-ins/${p.id}/cancel`, {}],
    ] as const) {
      expect((await req(method, url, other.auth, payload)).statusCode, `${method} ${url}`).toBe(404);
    }
    expect((await req("GET", "/v1/port-ins", other.auth)).json().portIns).toEqual([]);
  });
});

describe("port-in: carrier secrets", () => {
  it("encrypts the account number and PIN and never returns them", async () => {
    const u = await consumer();
    const created = await req("POST", "/v1/port-ins", u.auth, body({ temporaryNumber: "+15145550100" }));
    const signed = await req("POST", `/v1/port-ins/${created.json().id}/sign`, u.auth, { signedName: "Camille Tremblay", accept: true });
    const list = await req("GET", "/v1/port-ins", u.auth);
    const loa = await req("GET", `/v1/port-ins/${created.json().id}/loa?format=json`, u.auth);
    const html = await req("GET", `/v1/port-ins/${created.json().id}/loa`, u.auth);
    for (const res of [created, signed, list, loa, html]) {
      expect(res.body).not.toContain(ACCOUNT_NUMBER);
      expect(res.body).not.toContain(PIN);
      expect(res.body).not.toMatch(/accountNumber|pinEncrypted|loaSignedIp|userAgent/);
    }
    const row = [...ctx.repo.portIns.requests.values()][0]!;
    expect(row.accountNumberEncrypted).toMatch(/^v1\./);
    expect(row.accountNumberEncrypted).not.toContain(ACCOUNT_NUMBER);
    expect(ctx.deps.cipher.decrypt(row.accountNumberEncrypted)).toBe(ACCOUNT_NUMBER);
    expect(ctx.deps.cipher.decrypt(row.pinEncrypted!)).toBe(PIN);
    // Only the Twilio submission sees them in clear.
    expect(porting.gw.createPortIn).toHaveBeenCalledWith(
      expect.objectContaining({ accountNumber: ACCOUNT_NUMBER, numbers: [{ e164: PORTED, pin: PIN }], accountTelephoneNumber: PORTED }),
    );
    // Audit entries carry no secret either.
    expect(JSON.stringify(ctx.repo.auditLog ?? [])).not.toContain(ACCOUNT_NUMBER);
  });
});

describe("port-in: LOA e-signature", () => {
  it("shows a bilingual LOA, records typed name + time + IP + document hash, then submits to Twilio", async () => {
    const u = await consumer();
    const created = (await req("POST", "/v1/port-ins", u.auth, body({ temporaryNumber: "+15145550100" }))).json() as NumberPortIn;

    const html = await req("GET", `/v1/port-ins/${created.id}/loa`, u.auth);
    expect(html.headers["content-type"]).toMatch(/text\/html/);
    expect(html.body).toContain("Lettre d&#39;autorisation de transfert de numéro");
    expect(html.body).toContain("Letter of authorization for number transfer");
    expect(html.body.indexOf("Lettre d&#39;autorisation")).toBeLessThan(html.body.indexOf("Letter of authorization"));
    expect(html.body).toContain("Non signé.");

    // Wrong name, or no explicit acceptance: refused.
    expect((await req("POST", `/v1/port-ins/${created.id}/sign`, u.auth, { signedName: "Quelqu'un d'autre", accept: true })).json().error).toBe("signature_name_mismatch");
    expect((await req("POST", `/v1/port-ins/${created.id}/sign`, u.auth, { signedName: "Camille Tremblay", accept: false })).statusCode).toBe(400);

    const res = await req("POST", `/v1/port-ins/${created.id}/sign`, { ...u.auth, "user-agent": "vitest-browser" }, { signedName: "  camille  tremblay ", accept: true });
    expect(res.statusCode, res.body).toBe(200);
    const p = res.json() as NumberPortIn;
    const expected = sha256Hex(
      loaCanonicalText(
        generateLoaText({
          customerName: "Camille Tremblay",
          customerType: "individual",
          authorizedName: "Camille Tremblay",
          currentCarrier: "Bell Canada",
          numbers: [PORTED],
          serviceAddress: { street: "1 rue Sainte-Catherine", unit: null, city: "Montréal", province: "QC", postalCode: "H2X 1Y4" },
        }),
      ),
    );
    expect(p.loa).toEqual({ version: "2026-10-loa-1", signedName: "camille  tremblay", signedAt: "2026-10-14T14:00:00.000Z", documentSha256: expected });
    expect(p.status).toBe("submitted");
    expect(p.numbers[0]!.status).toBe("submitted");

    const row = ctx.repo.portIns.requests.get(p.id)!;
    expect(row.loaSignedIp).toBe("127.0.0.1");
    expect(row.loaUserAgent).toBe("vitest-browser");
    expect(row.carrierRef).toBe(SID);
    // The number is held by the account while it ports.
    expect((await ctx.repo.getNumberByE164(PORTED))).toMatchObject({ state: "porting_in", telecomAccountId: u.account.id, twilioSid: null });

    const signedHtml = await req("GET", `/v1/port-ins/${p.id}/loa`, u.auth);
    expect(signedHtml.body).toContain("Signé électroniquement par <strong>camille  tremblay</strong>");
    expect(signedHtml.body).toContain(expected);
    expect((await req("POST", `/v1/port-ins/${p.id}/sign`, u.auth, { signedName: "Camille Tremblay", accept: true })).json().error).toBe("already_signed");
  });

  it("without the Twilio porting gateway, stays signed for manual submission; /submit retries", async () => {
    ctx.deps.porting = null;
    const u = await consumer();
    const p = await createAndSign(u, { temporaryNumber: "+15145550100" });
    expect(p).toMatchObject({ status: "signed", statusReason: "awaiting_manual_submission" });
    expect(p.loa?.signedName).toBe("camille tremblay");

    ctx.deps.porting = porting.gw;
    const res = await req("POST", `/v1/port-ins/${p.id}/submit`, u.auth, {});
    expect(res.json()).toMatchObject({ status: "submitted", statusReason: null });
  });
});

describe("port-in: status webhook", () => {
  it("rejects a bad or missing Twilio signature", async () => {
    const payload = { port_in_request_sid: SID };
    expect((await portingWebhook(payload, "bad-signature")).statusCode).toBe(403);
    const raw = JSON.stringify(payload);
    const noSig = await ctx.app.inject({ method: "POST", url: "/webhooks/twilio/porting", headers: { "content-type": "application/json" }, payload: raw });
    expect(noSig.statusCode).toBe(403);
    // A valid signature over a different body is still rejected (bodySHA256 mismatch).
    const path = `/webhooks/twilio/porting?bodySHA256=${twilio.getExpectedBodyHash(raw)}`;
    const sig = twilio.getExpectedTwilioSignature(AUTH_TOKEN, BASE_URL + path, {});
    const tampered = await ctx.app.inject({ method: "POST", url: path, headers: { "content-type": "application/json", "x-twilio-signature": sig }, payload: JSON.stringify({ port_in_request_sid: SID, x: 1 }) });
    expect(tampered.statusCode).toBe(403);
    expect(porting.gw.getPortIn).not.toHaveBeenCalled();
  });

  it("acknowledges unknown requests without doing anything", async () => {
    const res = await portingWebhook({ port_in_request_sid: SID });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ignored: true });
  });

  it("FOC date keeps the temporary number; completion activates the number and switches routing (consumer)", async () => {
    const u = await consumer();
    const p = await createAndSign(u, { temporaryNumber: "+15145550100" });

    porting.state.snapshot = { sid: SID, status: "In progress", numbers: [{ e164: PORTED, status: "Port Date Set", portDate: "2026-10-21", rejectionReason: null }] };
    const foc = await portingWebhook({ port_in_request_sid: SID });
    expect(foc.statusCode, foc.body).toBe(200);
    let now = (await req("GET", `/v1/port-ins/${p.id}`, u.auth)).json() as NumberPortIn;
    expect(now).toMatchObject({ status: "foc_scheduled", focDate: "2026-10-21" });
    expect((await ctx.repo.getNumberByE164("+15145550100"))!.state).toBe("active");
    expect((await ctx.repo.getNumberByE164(PORTED))!.state).toBe("porting_in");

    porting.state.snapshot = { sid: SID, status: "Completed", numbers: [{ e164: PORTED, status: "Completed", portDate: "2026-10-21", rejectionReason: null }] };
    expect((await portingWebhook({ port_in_request_sid: SID })).json()).toEqual({ status: "completed" });
    now = (await req("GET", `/v1/port-ins/${p.id}`, u.auth)).json() as NumberPortIn;
    expect(now).toMatchObject({ status: "completed", completedAt: "2026-10-14T14:00:00.000Z", numbers: [{ e164: PORTED, status: "completed" }] });

    // Ported number: live on MIMT webhooks with the 9-1-1 address.
    expect(porting.gw.configurePortedNumber).toHaveBeenCalledWith({
      e164: PORTED,
      voiceUrl: `${BASE_URL}/webhooks/twilio/voice/inbound`,
      smsUrl: `${BASE_URL}/webhooks/twilio/sms/inbound`,
      statusCallback: `${BASE_URL}/webhooks/twilio/voice/status`,
      emergencyAddressSid: "ADtest",
    });
    expect(await ctx.repo.getNumberByE164(PORTED)).toMatchObject({ state: "active", twilioSid: "PNported1", telecomAccountId: u.account.id });
    // Temporary number: past the FOC date, back to the normal recycling cycle.
    expect((await ctx.repo.getNumberByE164("+15145550100"))!.state).toBe("quarantine");

    // Idempotent: a repeated webhook does not configure the number again.
    await portingWebhook({ port_in_request_sid: SID });
    expect(porting.gw.configurePortedNumber).toHaveBeenCalledTimes(1);
  });

  it("business port-in: the ported number takes the temporary DID route and becomes the main number", async () => {
    const { business, owner, ext, didNumber } = await makeBusiness(ctx);
    await ctx.repo.pbx.upsertDidRoute({ businessId: business.id, phoneNumberId: didNumber.id, e164: didNumber.e164, target: { type: "extension", extensionId: ext.id } });
    const p = await createAndSign(owner, { businessId: business.id, customerType: "business", customerName: "Café Test inc.", temporaryNumber: didNumber.e164 });
    expect(p).toMatchObject({ kind: "business", businessId: business.id });

    porting.state.snapshot = { sid: SID, status: "Completed", numbers: [{ e164: PORTED, status: "Completed", portDate: "2026-10-21", rejectionReason: null }] };
    await portingWebhook({ port_in_request_sid: SID });

    const route = await ctx.repo.pbx.getDidRouteByE164(PORTED);
    expect(route).toMatchObject({ businessId: business.id, target: { type: "extension", extensionId: ext.id } });
    expect((await ctx.repo.pbx.getBusiness(business.id))!.mainNumber).toBe(PORTED);
    expect(await ctx.repo.pbx.getDidRouteByE164(didNumber.e164)).toBeNull();
  });

  it("business port-ins need the admin role", async () => {
    const { business, staff } = await makeBusiness(ctx);
    const res = await req("POST", "/v1/port-ins", staff.auth, body({ businessId: business.id }));
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("business_role_required");
  });

  it("a rejected number is freed and the reason shown", async () => {
    const u = await consumer();
    const p = await createAndSign(u, { temporaryNumber: "+15145550100" });
    porting.state.snapshot = { sid: SID, status: "Action Required", numbers: [{ e164: PORTED, status: "Rejected", portDate: null, rejectionReason: "Account number mismatch" }] };
    await portingWebhook({ port_in_request_sid: SID });
    const now = (await req("GET", `/v1/port-ins/${p.id}`, u.auth)).json() as NumberPortIn;
    expect(now).toMatchObject({ status: "rejected", statusReason: "Account number mismatch", numbers: [{ status: "rejected" }] });
    expect((await ctx.repo.getNumberByE164(PORTED))!.state).toBe("released");
    expect((await ctx.repo.getNumberByE164("+15145550100"))!.state).toBe("active");
  });
});

describe("port-in: cancel", () => {
  it("cancels at Twilio, frees the number and keeps the temporary number", async () => {
    const u = await consumer();
    const p = await createAndSign(u, { temporaryNumber: "+15145550100" });
    const res = await req("POST", `/v1/port-ins/${p.id}/cancel`, u.auth, {});
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ status: "canceled", canceledAt: "2026-10-14T14:00:00.000Z", numbers: [{ status: "canceled" }] });
    expect(porting.gw.cancelPortIn).toHaveBeenCalledWith(SID);
    expect((await ctx.repo.getNumberByE164(PORTED))!.state).toBe("released");
    expect((await ctx.repo.getNumberByE164("+15145550100"))!.state).toBe("active");

    expect((await req("POST", `/v1/port-ins/${p.id}/cancel`, u.auth, {})).json().error).toBe("not_cancelable");
    // The number can be requested again.
    expect((await req("POST", "/v1/port-ins", u.auth, body({ temporaryNumber: "+15145550100" }))).statusCode).toBe(201);
  });

  it("cancels an unsigned request without calling Twilio; Twilio failure keeps the request open", async () => {
    const u = await consumer();
    const created = (await req("POST", "/v1/port-ins", u.auth, body({ temporaryNumber: "+15145550100" }))).json() as NumberPortIn;
    expect((await req("POST", `/v1/port-ins/${created.id}/cancel`, u.auth, {})).json().status).toBe("canceled");
    expect(porting.gw.cancelPortIn).not.toHaveBeenCalled();

    const p = await createAndSign(u, { temporaryNumber: "+15145550100" });
    porting.gw.cancelPortIn.mockRejectedValueOnce(new Error("boom"));
    const res = await req("POST", `/v1/port-ins/${p.id}/cancel`, u.auth, {});
    expect(res.statusCode).toBe(502);
    expect((await req("GET", `/v1/port-ins/${p.id}`, u.auth)).json().status).toBe("submitted");
  });

  it("a completed port cannot be canceled", async () => {
    const u = await consumer();
    const p = await createAndSign(u, { temporaryNumber: "+15145550100" });
    porting.state.snapshot = { sid: SID, status: "Completed", numbers: [{ e164: PORTED, status: "Completed", portDate: null, rejectionReason: null }] };
    await portingWebhook({ port_in_request_sid: SID });
    expect((await req("POST", `/v1/port-ins/${p.id}/cancel`, u.auth, {})).json().error).toBe("not_cancelable");
  });
});
