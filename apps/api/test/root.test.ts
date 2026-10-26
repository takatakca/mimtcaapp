import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setup, type Ctx } from "./helpers.js";

let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup();
});
afterEach(() => ctx.app.close());

describe("GET /", () => {
  it("describes the service instead of answering 404", async () => {
    const res = await ctx.app.inject({ url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, service: "API MIMT", health: "/healthz", readiness: "/readyz" });
  });

  it("still answers 404 for unknown routes", async () => {
    const res = await ctx.app.inject({ url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "not_found" });
  });
});
