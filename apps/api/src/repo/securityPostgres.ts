import type postgres from "postgres";
import type { AuthSessionRow, NewAuthSession, PasskeyRow, SecurityRepository } from "./security.js";

type Sql = postgres.Sql<{}>;
const SESSION_COLS = "id, user_id, method, user_agent, ip_prefix, created_at, last_seen_at, recent_auth_at, strong_auth_at, revoked_at";
const PASSKEY_COLS = "id, user_id, credential_id, public_key, counter, transports, device_type, backed_up, name, created_at, last_used_at";

// bigint arrives as a string from postgres.js.
const passkey = (r: Record<string, unknown>): PasskeyRow => ({ ...(r as unknown as PasskeyRow), counter: Number(r.counter) });

/** Sessions, passkeys and business security policy on Postgres (0022_security_sessions.sql). */
export class PostgresSecurityRepository implements SecurityRepository {
  constructor(private readonly sql: Sql) {}

  async createSession(s: NewAuthSession) {
    await this.sql`insert into auth_sessions (id, user_id, method, user_agent, ip_prefix, created_at, last_seen_at, recent_auth_at, strong_auth_at)
      values (${s.id}, ${s.userId}, ${s.method}, ${s.userAgent}, ${s.ipPrefix}, ${s.at}, ${s.at}, ${s.recentAuthAt}, ${s.strongAuthAt})
      on conflict (id) do nothing`;
    return (await this.getSession(s.id))!;
  }
  async getSession(id: string) {
    const [r] = await this.sql`select ${this.sql.unsafe(SESSION_COLS)} from auth_sessions where id = ${id}`;
    return (r as unknown as AuthSessionRow) ?? null;
  }
  async listActiveSessions(userId: string) {
    return (await this.sql`select ${this.sql.unsafe(SESSION_COLS)} from auth_sessions
      where user_id = ${userId} and revoked_at is null order by last_seen_at desc limit 100`) as unknown as AuthSessionRow[];
  }
  async deviceHistory(userId: string, userAgent: string) {
    const [r] = await this.sql<{ anySession: boolean; sameDevice: boolean }[]>`select
      exists(select 1 from auth_sessions where user_id = ${userId}) as any_session,
      exists(select 1 from auth_sessions where user_id = ${userId} and user_agent = ${userAgent}) as same_device`;
    return { anySession: Boolean(r?.anySession), sameDevice: Boolean(r?.sameDevice) };
  }
  async touchSession(id: string, at: Date) {
    await this.sql`update auth_sessions set last_seen_at = ${at} where id = ${id} and last_seen_at < ${at}`;
  }
  async markAuth(id: string, at: Date, strong: boolean) {
    await this.sql`update auth_sessions set recent_auth_at = ${at},
      strong_auth_at = case when ${strong} then ${at}::timestamptz else strong_auth_at end where id = ${id}`;
  }
  async revokeSession(id: string, at: Date) {
    const rows = await this.sql`update auth_sessions set revoked_at = ${at} where id = ${id} and revoked_at is null returning id`;
    return rows.length > 0;
  }
  async revokeOtherSessions(userId: string, keepId: string | null, at: Date) {
    const rows = await this.sql<{ id: string }[]>`update auth_sessions set revoked_at = ${at}
      where user_id = ${userId} and revoked_at is null and (${keepId}::uuid is null or id <> ${keepId}::uuid) returning id`;
    return rows.map((r) => r.id);
  }
  async pruneSessions(before: Date) {
    const rows = await this.sql`delete from auth_sessions where revoked_at < ${before} or last_seen_at < ${before} returning id`;
    return rows.length;
  }

  async addPasskey(p: Omit<PasskeyRow, "id" | "createdAt" | "lastUsedAt"> & { createdAt: Date }) {
    const [r] = await this.sql`insert into passkeys (user_id, credential_id, public_key, counter, transports, device_type, backed_up, name, created_at)
      values (${p.userId}, ${p.credentialId}, ${p.publicKey}, ${p.counter}, ${this.sql.array(p.transports)}, ${p.deviceType}, ${p.backedUp}, ${p.name}, ${p.createdAt})
      returning ${this.sql.unsafe(PASSKEY_COLS)}`;
    return passkey(r!);
  }
  async listPasskeys(userId: string) {
    const rows = await this.sql`select ${this.sql.unsafe(PASSKEY_COLS)} from passkeys where user_id = ${userId} order by created_at`;
    return rows.map(passkey);
  }
  async findPasskeyByCredentialId(credentialId: string) {
    const [r] = await this.sql`select ${this.sql.unsafe(PASSKEY_COLS)} from passkeys where credential_id = ${credentialId}`;
    return r ? passkey(r) : null;
  }
  async updatePasskeyUse(id: string, counter: number, at: Date) {
    await this.sql`update passkeys set counter = ${counter}, last_used_at = ${at} where id = ${id}`;
  }
  async deletePasskey(id: string, userId: string) {
    const rows = await this.sql`delete from passkeys where id = ${id} and user_id = ${userId} returning id`;
    return rows.length > 0;
  }

  async getBusinessPolicy(businessId: string) {
    const [r] = await this.sql<{ requireStrongAuth: boolean }[]>`select require_strong_auth from business_security_policies where business_id = ${businessId}`;
    return { requireStrongAuth: r?.requireStrongAuth ?? false };
  }
  async setBusinessPolicy(businessId: string, requireStrongAuth: boolean, updatedBy: string, at: Date) {
    await this.sql`insert into business_security_policies (business_id, require_strong_auth, updated_by, updated_at)
      values (${businessId}, ${requireStrongAuth}, ${updatedBy}, ${at})
      on conflict (business_id) do update set require_strong_auth = excluded.require_strong_auth,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at`;
  }
}
