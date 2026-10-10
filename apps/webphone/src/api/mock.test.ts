// Happy path of the demo API through the real HTTP client (bearer tokens, refresh, error mapping).
import type {
  AuthTokensResponse,
  BusinessHoursResponse,
  BusinessesResponse,
  ConversationsResponse,
  Extension,
  IvrMenu,
  MeResponse,
  MessageDto,
  OffersResponse,
  OrderDetailResponse,
  ServiceOrder,
} from "@mimt/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createHttpClient, type HttpClient } from "./http";
import { isOpenNow, mockFetch, resetMockState } from "./mock";
import { createTokenStore } from "./tokens";
import { ApiClientError } from "./errors";

let http: HttpClient;
let signedOut = 0;

beforeEach(() => {
  resetMockState();
  signedOut = 0;
  http = createHttpClient({
    baseUrl: "https://api.mimt.test",
    fetch: mockFetch,
    store: createTokenStore(null),
    appVersion: "web-test",
    onSignedOut: () => signedOut++,
  });
});

async function signIn() {
  http.setTokens(await http.request<AuthTokensResponse>("POST", "/v1/auth/takatak/exchange", { body: { code: "x", codeVerifier: "y", redirectUri: "z" }, auth: false }));
}

describe("mock API", () => {
  it("rejects calls without a session", async () => {
    await expect(http.request("GET", "/v1/me")).rejects.toMatchObject({ status: 401, key: "error.session" });
  });

  it("signs in, loads the profile and the business membership", async () => {
    await signIn();
    const me = await http.request<MeResponse>("GET", "/v1/me");
    expect(me.numbers[0]?.e164).toBe("+15145550100");
    expect(me.e911.addressRegistered).toBe(true);
    const biz = await http.request<BusinessesResponse>("GET", "/v1/business");
    expect(biz.businesses[0]?.role).toBe("owner");
  });

  it("refreshes an expired access token once, then signs out when the refresh token is bad", async () => {
    await signIn();
    // Pretend the access token expired: the client refreshes before the request.
    const store = createTokenStore(null);
    const expired = createHttpClient({ baseUrl: "https://api.mimt.test", fetch: mockFetch, store, appVersion: "t", now: () => Date.now(), onSignedOut: () => signedOut++ });
    store.set({ accessToken: "demo-access-old", refreshToken: "demo-refresh-old", tokenType: "Bearer", expiresIn: 0 });
    await expect(expired.request<MeResponse>("GET", "/v1/me")).resolves.toHaveProperty("user");
    store.set({ accessToken: "bad", refreshToken: "bad", tokenType: "Bearer", expiresIn: 3600 });
    await expect(expired.request("GET", "/v1/me")).rejects.toBeInstanceOf(ApiClientError);
    expect(signedOut).toBe(1);
  });

  it("sends a text and shows it in the conversation list", async () => {
    await signIn();
    const m = await http.request<MessageDto>("POST", "/v1/messages", { body: { from: "+15145550100", to: "+15145550177", body: "Salut!" } });
    expect(m.direction).toBe("outbound");
    const convs = await http.request<ConversationsResponse>("GET", "/v1/conversations");
    expect(convs.conversations.map((c) => c.peer)).toContain("+15145550177");
    // Never a text to 9-1-1.
    await expect(http.request("POST", "/v1/messages", { body: { from: "+15145550100", to: "911", body: "x" } })).rejects.toMatchObject({ key: "error.validation" });
  });

  it("manages extensions, refusing N11 codes and duplicates", async () => {
    await signIn();
    const b = "/v1/business/biz-demo";
    const e = await http.request<Extension>("POST", `${b}/extensions`, { body: { number: "105", displayName: "Livraisons" } });
    expect(e.number).toBe("105");
    await expect(http.request("POST", `${b}/extensions`, { body: { number: "105", displayName: "Encore" } })).rejects.toMatchObject({ status: 409, key: "error.duplicate" });
    await expect(http.request("POST", `${b}/extensions`, { body: { number: "911", displayName: "Non" } })).rejects.toMatchObject({ status: 400 });
    const updated = await http.request<Extension>("PATCH", `${b}/extensions/${e.id}`, { body: { displayName: "Livraisons (soir)" } });
    expect(updated.displayName).toBe("Livraisons (soir)");
    await http.request("DELETE", `${b}/extensions/${e.id}`);
    // Like apps/api: a business you are not a member of does not exist for you.
    await expect(http.request("GET", "/v1/business/other/extensions")).rejects.toMatchObject({ status: 404, key: "error.notFound" });
  });

  it("saves an IVR menu and business hours", async () => {
    await signIn();
    const b = "/v1/business/biz-demo";
    const m = await http.request<IvrMenu>("POST", `${b}/ivr`, {
      body: { name: "Soir", greeting: { fr: "Bonsoir.", en: "" }, options: [{ digit: "1", target: { type: "voicemail" } }] },
    });
    expect(m.timeoutS).toBe(6);
    await expect(
      http.request("POST", `${b}/ivr`, { body: { name: "Non", greeting: { fr: "x", en: "" }, options: [{ digit: "9", target: { type: "external", number: "911" } }] } }),
    ).rejects.toMatchObject({ status: 400 });
    const h = await http.request<BusinessHoursResponse>("GET", `${b}/hours`);
    const saved = await http.request<BusinessHoursResponse>("PUT", `${b}/hours`, { body: { ...h.hours, quebecHolidays: false } });
    expect(saved.hours.quebecHolidays).toBe(false);
  });

  it("lists offers for a postal code and places an order with the contract summary", async () => {
    await signIn();
    const all = await http.request<OffersResponse>("GET", "/v1/catalog/offers");
    const montreal = await http.request<OffersResponse>("GET", "/v1/catalog/offers", { query: { postalCode: "H3B 1A1" } });
    const rimouski = await http.request<OffersResponse>("GET", "/v1/catalog/offers", { query: { postalCode: "G5L 1A1" } });
    expect(montreal.offers.some((o) => o.code === "INT-1G-24")).toBe(true);
    expect(rimouski.offers.some((o) => o.code === "INT-1G-24")).toBe(false);
    expect(all.offers.length).toBeGreaterThanOrEqual(montreal.offers.length);

    // Draft first (like apps/api): nothing is accepted or sent before /submit.
    const order = await http.request<ServiceOrder>("POST", "/v1/catalog/orders", { body: { offerId: "off-mob-20", simKind: "esim" } });
    expect(order).toMatchObject({ state: "draft", simKind: "esim", productLine: "mobile", contractSummaryVersion: null });
    const detail = await http.request<OrderDetailResponse>("GET", `/v1/catalog/orders/${order.id}`);
    expect(detail).toMatchObject({ service: null, appointments: [], devices: [], porting: null });
    await expect(http.request("POST", "/v1/catalog/orders", { body: { offerId: "off-int-400" } })).rejects.toMatchObject({ status: 400 });
  });
});

describe("isOpenNow (America/Montreal)", () => {
  const weekly = { mon: [{ open: "09:00", close: "17:00" }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
  it("uses Montreal local time", () => {
    // Monday 2026-10-05 14:00 UTC = 10:00 in Montreal (EDT).
    expect(isOpenNow({ weekly, holidays: [], quebecHolidays: false }, new Date("2026-10-05T14:00:00Z"))).toBe(true);
    // 22:00 UTC = 18:00 Montreal: closed.
    expect(isOpenNow({ weekly, holidays: [], quebecHolidays: false }, new Date("2026-10-05T22:00:00Z"))).toBe(false);
  });
  it("closes on custom closures and Quebec holidays (Thanksgiving 2026-10-12)", () => {
    expect(isOpenNow({ weekly, holidays: [{ date: "2026-10-05", name: "Inventaire" }], quebecHolidays: false }, new Date("2026-10-05T14:00:00Z"))).toBe(false);
    expect(isOpenNow({ weekly, holidays: [], quebecHolidays: true }, new Date("2026-10-12T14:00:00Z"))).toBe(false);
    expect(isOpenNow({ weekly, holidays: [], quebecHolidays: false }, new Date("2026-10-12T14:00:00Z"))).toBe(true);
  });
});
