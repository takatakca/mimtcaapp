import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { deliverOutbox } from "../src/services/outbox.js";
import { MemoryRepository } from "../src/repo/memory.js";
import { testConfig } from "./helpers.js";

describe("config", () => {
  it("boots in development with nothing configured", () => {
    const c = loadConfig({});
    expect(c.PORT).toBe(8080);
    expect(c.TWILIO_ACCOUNT_SID).toBeUndefined();
    expect(c.CORS_ORIGINS).toEqual(["https://mimt.ca", "https://app.mimt.ca", "https://takatak.ca"]);
  });

  it("treats empty strings as unset", () => {
    expect(loadConfig({ TWILIO_ACCOUNT_SID: "" }).TWILIO_ACCOUNT_SID).toBeUndefined();
  });

  it("accepts an additional PostgreSQL CA PEM from Coolify environment variables", () => {
    const pem = "-----BEGIN CERTIFICATE-----\\nEXAMPLE_CA_FOR_CONFIGURATION_TEST_ONLY\\n-----END CERTIFICATE-----";
    const c = loadConfig({ DATABASE_SSL_CA_PEM: pem });
    expect(c.DATABASE_SSL_CA_PEM).toBe(
      "-----BEGIN CERTIFICATE-----\nEXAMPLE_CA_FOR_CONFIGURATION_TEST_ONLY\n-----END CERTIFICATE-----",
    );
  });

  it("requires Twilio, Stripe, keys and the database in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/TWILIO_ACCOUNT_SID.*required/);
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/STRIPE_SECRET_KEY/);
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/MESSAGE_ENCRYPTION_KEY/);
  });
});

describe("TAKATAK outbox", () => {
  it("delivers signed webhooks and backs off on failure", async () => {
    const repo = new MemoryRepository();
    const config = testConfig({ TAKATAK_WEBHOOK_URL: "https://takatak.test/hooks/mimt", TAKATAK_WEBHOOK_SECRET: "whsec" });
    const log = { warn: vi.fn() } as never;
    await repo.enqueueOutbox("entitlement.updated", { plan: "premium" });

    const failing = vi.fn(async () => new Response("no", { status: 500 }));
    expect(await deliverOutbox({ repo, config, log, fetchImpl: failing as never })).toEqual({ delivered: 0, failed: 1 });
    expect(repo.outbox[0]!.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

    const ok = vi.fn(async (_url: string, _init: RequestInit) => new Response("ok"));
    const later = new Date(Date.now() + 60_000);
    expect(await deliverOutbox({ repo, config, log, fetchImpl: ok as never, now: later })).toEqual({ delivered: 1, failed: 0 });
    const headers = ok.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers["x-mimt-signature"]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(JSON.parse(String(ok.mock.calls[0]![1].body))).toMatchObject({ type: "entitlement.updated", data: { plan: "premium" } });
  });
});
