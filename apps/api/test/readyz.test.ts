import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MIGRATION_ORDER } from "../src/jobs/migrateStandalone.js";
import { setup, type Ctx } from "./helpers.js";

let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup();
});
afterEach(() => ctx.app.close());

describe("/readyz schema check", () => {
  it("is ready when every migration is applied", async () => {
    (ctx.repo as { appliedMigrations?: () => Promise<string[]> }).appliedMigrations = async () => [...MIGRATION_ORDER];
    const res = await ctx.app.inject({ url: "/readyz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, db: "up", schema: "current" });
  });

  it("answers 503 and names the missing migrations when the schema is behind", async () => {
    (ctx.repo as { appliedMigrations?: () => Promise<string[]> }).appliedMigrations = async () => MIGRATION_ORDER.slice(0, 10);
    const res = await ctx.app.inject({ url: "/readyz" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, schema: "outdated", missingMigrations: MIGRATION_ORDER.slice(10) });
  });
});
