import { describe, expect, it } from "vitest";
import { assertPrivateMimtDatabase, MIGRATION_ORDER } from "../src/jobs/migrateStandalone.js";

const opts = "YES_MY_PRIVATE_MIMT_DATABASE";
describe("isolated self-hosted MIMT migration guard", () => {
  it("refuses the TAKATAK or any Supabase pooler even with confirmation", () => {
    expect(() => assertPrivateMimtDatabase(
      "postgresql://postgres.example:test@aws-0-ca-central-1.pooler.supabase.com:5432/postgres",
      opts, "production",
    )).toThrow(/Supabase/);
  });
  it("refuses other database usernames or names", () => {
    expect(() => assertPrivateMimtDatabase(
      "postgresql://postgres:test@mimt-pg:5432/postgres", opts, "production",
    )).toThrow(/dedicated/);
  });
  it("refuses commands without an explicit one-shot confirmation", () => {
    expect(() => assertPrivateMimtDatabase(
      "postgresql://mimt_owner:test@mimt-pg:5432/mimt_production",
      undefined, "production",
    )).toThrow(/MIMT_STANDALONE_MIGRATE_CONFIRM/);
  });
  it("refuses external hosts in production and permits the private Docker hostname", () => {
    expect(() => assertPrivateMimtDatabase(
      "postgresql://mimt_owner:test@db.example.com:5432/mimt_production", opts, "production",
    )).toThrow(/Docker-network/);
    expect(() => assertPrivateMimtDatabase(
      "postgresql://mimt_owner:test@mimt-pg:5432/mimt_production", opts, "production",
    )).not.toThrow();
  });
  it("retains explicit deterministic migration order", () => {
    expect(MIGRATION_ORDER).toHaveLength(8);
    expect(MIGRATION_ORDER[0]).toBe("0001_init.sql");
    expect(MIGRATION_ORDER[7]).toBe("0007_media_greetings.sql");
  });
});
