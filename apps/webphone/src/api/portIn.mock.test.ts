// Demo API for number port-in (/v1/port-ins) through the real HTTP client.
import type { AuthTokensResponse, CreatePortInRequest, NumberPortIn, PortInLoaResponse, PortInsResponse } from "@mimt/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createHttpClient, type HttpClient } from "./http";
import { mockFetch, resetMockState } from "./mock";
import { createTokenStore } from "./tokens";

let http: HttpClient;

beforeEach(async () => {
  resetMockState();
  http = createHttpClient({ baseUrl: "https://api.mimt.test", fetch: mockFetch, store: createTokenStore(null), appVersion: "web-test", onSignedOut: () => undefined });
  http.setTokens(await http.request<AuthTokensResponse>("POST", "/v1/auth/takatak/exchange", { body: { code: "x", codeVerifier: "y", redirectUri: "z" }, auth: false }));
});

const request: CreatePortInRequest = {
  numbers: ["+14505550123"],
  currentCarrier: "Bell Canada",
  customerType: "individual",
  customerName: "Camille Tremblay",
  authorizedName: "Camille Tremblay",
  authorizedEmail: "camille@example.ca",
  accountNumber: "ACCT-SECRET-1",
  pin: "4321",
  serviceAddress: { street: "1 rue Sainte-Catherine", unit: null, city: "Montréal", province: "QC", postalCode: "H2X 1Y4" },
  temporaryNumber: "+15145550100",
};

describe("mock API: port-in", () => {
  it("creates, shows the bilingual LOA, signs and cancels; never echoes the account number or PIN", async () => {
    const before = await http.request<PortInsResponse>("GET", "/v1/port-ins");
    expect(before.portIns.map((p) => p.status)).toEqual(["foc_scheduled"]);

    const p = await http.request<NumberPortIn>("POST", "/v1/port-ins", { body: request });
    expect(p).toMatchObject({ status: "pending_signature", hasPin: true, feeCents: 0, temporaryNumber: "+15145550100" });
    expect(JSON.stringify(p)).not.toMatch(/ACCT-SECRET-1|4321/);

    const loa = await http.request<PortInLoaResponse>("GET", `/v1/port-ins/${p.id}/loa`, { query: { format: "json" } });
    expect(loa.fr.title).toMatch(/Lettre d'autorisation/);
    expect(loa.en.paragraphs.join(" ")).toContain("+14505550123");

    await expect(http.request("POST", `/v1/port-ins/${p.id}/sign`, { body: { signedName: "Autre Personne", accept: true } })).rejects.toMatchObject({
      status: 400,
      key: "error.portSignatureMismatch",
    });
    const signed = await http.request<NumberPortIn>("POST", `/v1/port-ins/${p.id}/sign`, { body: { signedName: "camille tremblay", accept: true } });
    expect(signed).toMatchObject({ status: "submitted", loa: { signedName: "camille tremblay" } });
    await expect(http.request("POST", `/v1/port-ins/${p.id}/sign`, { body: { signedName: "Camille Tremblay", accept: true } })).rejects.toMatchObject({
      key: "error.portLocked",
    });

    const canceled = await http.request<NumberPortIn>("POST", `/v1/port-ins/${p.id}/cancel`, { body: {} });
    expect(canceled.status).toBe("canceled");
    await expect(http.request("POST", `/v1/port-ins/${p.id}/cancel`, { body: {} })).rejects.toMatchObject({ status: 409, key: "error.portLocked" });
  });

  it("refuses MIMT numbers, duplicates and numbers already being transferred", async () => {
    await expect(http.request("POST", "/v1/port-ins", { body: { ...request, numbers: ["+15145550100"] } })).rejects.toMatchObject({ key: "error.numberAlreadyOnMimt" });
    await expect(http.request("POST", "/v1/port-ins", { body: { ...request, numbers: ["+15145550177"] } })).rejects.toMatchObject({ key: "error.portInExists" });
    await expect(http.request("POST", "/v1/port-ins", { body: { ...request, numbers: ["514"] } })).rejects.toMatchObject({ key: "error.validation" });
    await expect(http.request("POST", "/v1/port-ins", { body: { ...request, accountNumber: " " } })).rejects.toMatchObject({ status: 400 });
  });
});
