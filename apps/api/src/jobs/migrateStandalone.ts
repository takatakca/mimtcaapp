/**
 * ONE-SHOT ONLY. Migrates a dedicated MIMT PostgreSQL database, never Supabase
 * or the TAKATAK master database. Run from Coolify Terminal after configuring
 * the new private MIMT PostgreSQL resource. Never run on web server startup.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { resolvePostgresTls } from "../repo/postgresTls.js";

export const MIGRATION_ORDER = [
  "0001_init.sql",
  "0002_push_tokens.sql",
  "0003_devices_rewards.sql",
  "0003_business_pbx.sql",
  "0004_ai.sql",
  "0005_catalog.sql",
  "0006_blocks_forwarding.sql",
  "0007_media_greetings.sql",
  "0008_referrals_addons.sql",
  "0009_port_in.sql",
  "0010_meetings.sql",
  "0011_usage_messages.sql",
  "0012_number_holds.sql",
  "0013_user_handles.sql",
  "0014_web_push.sql",
  "0015_ai_help.sql",
] as const;

export function assertPrivateMimtDatabase(databaseUrl: string, confirmation: string | undefined, nodeEnv: string | undefined) {
  if (confirmation !== "YES_MY_PRIVATE_MIMT_DATABASE") {
    throw new Error("Migration requires MIMT_STANDALONE_MIGRATE_CONFIRM=YES_MY_PRIVATE_MIMT_DATABASE");
  }
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Expected PostgreSQL URL");
  const host = url.hostname.toLowerCase();
  if (host.includes("supabase") || host.endsWith(".pooler.supabase.com")) {
    throw new Error("Refusing to migrate Supabase or the TAKATAK master database");
  }
  if (decodeURIComponent(url.username) !== "mimt_owner" || decodeURIComponent(url.pathname) !== "/mimt_production") {
    throw new Error("Refusing to migrate database other than dedicated mimt_owner/mimt_production");
  }
  const isLoopback = host === "localhost" || host === "127.0.0.1";
  if (nodeEnv === "production" && (isLoopback || host.includes(".") || host.length < 2)) {
    throw new Error("Production migration requires a private Docker-network hostname");
  }
}

export async function migrateStandaloneDatabase(
  databaseUrl: string,
  confirmation: string | undefined,
  nodeEnv: string | undefined,
  caPem?: string,
  sqlFolder: string = join(process.cwd(), "db"),
) {
  assertPrivateMimtDatabase(databaseUrl, confirmation, nodeEnv);
  const tls = resolvePostgresTls(databaseUrl, caPem);
  if (tls.suppliedCaInvalid) throw new Error("Invalid database CA; migration stopped without downgrading TLS verification");
  const client = postgres(tls.url, {
    max: 1,
    ...(tls.ssl ? { ssl: tls.ssl } : {}),
    prepare: false,
  });
  try {
    await client`select 1`;
    const bootstrap = readFileSync(join(sqlFolder, "bootstrap.sql"), "utf8");
    await client.unsafe(bootstrap, [], { prepare: false });
    await client`
      create table if not exists mimt_schema_migrations (
        name text primary key,
        sha256 text not null,
        applied_at timestamptz not null default now()
      )
    `;

    for (const filename of MIGRATION_ORDER) {
      const content = readFileSync(join(sqlFolder, "migrations", filename), "utf8");
      const checksum = createHash("sha256").update(content).digest("hex");
      const existing = await client`select sha256 from mimt_schema_migrations where name = ${filename}`;
      if (existing.length) {
        if (existing[0]?.sha256 !== checksum) throw new Error(`Migration checksum changed: ${filename}`);
        console.log("Already applied:", filename);
        continue;
      }
      await client.begin(async (tx) => {
        await tx.unsafe(content, [], { prepare: false });
        await tx`insert into mimt_schema_migrations(name, sha256) values (${filename}, ${checksum})`;
      });
      console.log("Applied migration:", filename);
    }
    const [summary] = await client`select count(*)::integer as count from mimt_schema_migrations`;
    if (summary?.count !== MIGRATION_ORDER.length) throw new Error("Not all MIMT migrations registered");
    console.log("PASS: all", MIGRATION_ORDER.length, "private MIMT PostgreSQL migrations verified");
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (process.argv[1]?.endsWith("/migrateStandalone.js")) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not configured");
  await migrateStandaloneDatabase(
    url,
    process.env.MIMT_STANDALONE_MIGRATE_CONFIRM,
    process.env.NODE_ENV,
    process.env.DATABASE_SSL_CA_PEM,
  );
}
