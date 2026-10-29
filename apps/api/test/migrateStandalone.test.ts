import { readdirSync } from "node:fs";
import { join } from "node:path";
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
    // Containment and relative order (not an exact length): parallel branches add their own files.
    expect(MIGRATION_ORDER.length).toBeGreaterThanOrEqual(22);
    expect(MIGRATION_ORDER).toContain("0020_ai_pilot.sql");
    expect(MIGRATION_ORDER[0]).toBe("0001_init.sql");
    expect(MIGRATION_ORDER[9]).toBe("0009_port_in.sql");
    expect(MIGRATION_ORDER[10]).toBe("0010_meetings.sql");
    expect(MIGRATION_ORDER[11]).toBe("0011_usage_messages.sql");
    expect(MIGRATION_ORDER[12]).toBe("0012_number_holds.sql");
    expect(MIGRATION_ORDER[13]).toBe("0013_user_handles.sql");
    expect(MIGRATION_ORDER[14]).toBe("0014_web_push.sql");
    expect(MIGRATION_ORDER[15]).toBe("0015_ai_help.sql");
    expect(MIGRATION_ORDER[16]).toBe("0016_call_summaries.sql");
    expect(MIGRATION_ORDER[17]).toBe("0017_missions.sql");
    expect(MIGRATION_ORDER[18]).toBe("0018_points.sql");
    expect(MIGRATION_ORDER).toContain("0019_affiliates.sql");
    expect(MIGRATION_ORDER).toContain("0022_security_sessions.sql");
    expect(MIGRATION_ORDER.indexOf("0022_security_sessions.sql")).toBeGreaterThan(MIGRATION_ORDER.indexOf("0020_ai_pilot.sql"));
    expect(MIGRATION_ORDER[20]).toBe("0020_ai_pilot.sql");
    // 0021 (points clawback) and 0022 (security) come from other branches; MIMT Connect is 0023 and runs after them.
    expect(MIGRATION_ORDER).toContain("0023_partners.sql");
    expect(MIGRATION_ORDER.indexOf("0023_partners.sql")).toBeGreaterThan(MIGRATION_ORDER.indexOf("0020_ai_pilot.sql"));
    for (const earlier of MIGRATION_ORDER.filter((m) => m.startsWith("0021_") || m.startsWith("0022_"))) {
      expect(MIGRATION_ORDER.indexOf(earlier)).toBeLessThan(MIGRATION_ORDER.indexOf("0023_partners.sql"));
    }
  });
  it("lists every migration file in supabase/migrations", () => {
    const files = readdirSync(join(__dirname, "../../../supabase/migrations")).filter((f) => f.endsWith(".sql"));
    expect([...MIGRATION_ORDER].sort()).toEqual(files.sort());
  });
});
