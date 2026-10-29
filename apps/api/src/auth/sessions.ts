import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import type { AuthMethod, AuthTokensResponse } from "@mimt/shared";
import { SignJWT, jwtVerify, type JWK } from "jose";
import { HttpError, unauthorized } from "../lib/errors.js";
import { randomToken, sha256Hex } from "../lib/crypto.js";
import type { ClientInfo } from "../lib/clientInfo.js";
import type { AuthSessionRow } from "../repo/security.js";
import type { Repository } from "../repo/types.js";

export const ACCESS_TTL_S = 15 * 60;
/** How long a "this session is not revoked" answer is trusted in memory. Bounds how long a revoked token still works. */
export const SESSION_CACHE_TTL_MS = 30_000;
/** last_seen_at is written at most this often. */
export const LAST_SEEN_INTERVAL_MS = 5 * 60_000;
const SESSION_CACHE_MAX = 10_000;
export const REFRESH_TTL_S = 30 * 24 * 60 * 60;
const AUDIENCE = "mimt-api";
/** Audience of short-lived media capability tokens (signed URLs); never accepted as an access token. */
const MEDIA_AUDIENCE = "mimt-media";

export type SessionTokens = AuthTokensResponse;

/** Loads the Ed25519 key from a JWK (JSON) or PKCS#8 PEM; generates an ephemeral one when absent (dev only). */
export function loadSigningKey(raw: string | undefined): { key: KeyObject; ephemeral: boolean } {
  if (!raw) return { key: generateKeyPairSync("ed25519").privateKey, ephemeral: true };
  const trimmed = raw.trim();
  const key = trimmed.startsWith("{")
    ? createPrivateKey({ key: JSON.parse(trimmed) as JWK & { kty: string }, format: "jwk" })
    : createPrivateKey(trimmed.replace(/\\n/g, "\n"));
  if (key.asymmetricKeyType !== "ed25519") throw new Error("MIMT_SESSION_SIGNING_KEY must be an Ed25519 private key");
  return { key, ephemeral: false };
}

/** Who a valid access token belongs to. sessionId is null only for tokens minted before the session inventory. */
export interface AccessIdentity {
  userId: string;
  sessionId: string | null;
}

export interface IssueOptions {
  /** How the user just authenticated. A new session only; ignored when the session exists (refresh). */
  method?: AuthMethod;
  client?: ClientInfo;
}

const sessionRevoked = () => new HttpError(401, "session_revoked", "Cette session a été déconnectée. Reconnectez-vous.");

/**
 * MIMT sessions: short Ed25519 access tokens (15 min) + rotating refresh tokens (30 days).
 * Each sign-in is a session row (auth_sessions, id = refresh family id = "sid" claim). Every access token is checked
 * against a non-revoked session through a small in-memory cache (SESSION_CACHE_TTL_MS), so « Déconnecter » takes effect
 * within 30 seconds on every API instance and at once on the instance that revoked it.
 */
export class SessionService {
  readonly publicJwk: JWK;
  private readonly publicKey: KeyObject;
  private readonly cache = new Map<string, { userId: string; revoked: boolean; lastSeenAt: number; checkedAt: number }>();

  constructor(
    private readonly repo: Repository,
    private readonly privateKey: KeyObject,
    private readonly issuer: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.publicKey = createPublicKey(privateKey);
    const jwk = this.publicKey.export({ format: "jwk" }) as JWK;
    this.publicJwk = { ...jwk, alg: "EdDSA", use: "sig", kid: sha256Hex(JSON.stringify(jwk)).slice(0, 16) };
  }

  /**
   * Opens a session for a user who just authenticated (TAKATAK, SMS code or passkey) and issues its tokens.
   * newDevice: the user had sessions before, none from this device label (browser · OS family).
   */
  async signIn(userId: string, method: AuthMethod, client: ClientInfo): Promise<{ tokens: SessionTokens; session: AuthSessionRow; newDevice: boolean }> {
    const history = await this.repo.security.deviceHistory(userId, client.userAgent);
    const sessionId = randomUUID();
    const tokens = await this.issue(userId, sessionId, { method, client });
    const session = (await this.repo.security.getSession(sessionId))!;
    return { tokens, session, newDevice: history.anySession && !history.sameDevice };
  }

  /** Makes sure the session row exists (created on first use, e.g. a refresh family from before the inventory). */
  private async ensureSession(userId: string, sessionId: string, opts: IssueOptions): Promise<AuthSessionRow> {
    const existing = await this.repo.security.getSession(sessionId);
    if (existing) {
      if (existing.revokedAt || existing.userId !== userId) throw sessionRevoked();
      return existing;
    }
    const at = this.now();
    const method = opts.method ?? "legacy";
    return this.repo.security.createSession({
      id: sessionId,
      userId,
      method,
      userAgent: opts.client?.userAgent ?? null,
      ipPrefix: opts.client?.ipPrefix ?? null,
      at,
      // A fresh SMS code or passkey is a recent authentication (step-up window); a passkey is also strong.
      recentAuthAt: method === "sms" || method === "passkey" ? at : null,
      strongAuthAt: method === "passkey" ? at : null,
    });
  }

  async issue(userId: string, familyId: string = randomUUID(), opts: IssueOptions = {}): Promise<SessionTokens> {
    await this.ensureSession(userId, familyId, opts);
    const accessToken = await new SignJWT({ sid: familyId })
      .setProtectedHeader({ alg: "EdDSA", kid: this.publicJwk.kid })
      .setSubject(userId)
      .setIssuer(this.issuer)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setJti(randomUUID())
      .setExpirationTime(`${ACCESS_TTL_S}s`)
      .sign(this.privateKey);
    const refreshToken = randomToken(32);
    await this.repo.createRefreshToken({
      userId,
      familyId,
      tokenHash: sha256Hex(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_S * 1000),
    });
    return { accessToken, refreshToken, tokenType: "Bearer", expiresIn: ACCESS_TTL_S };
  }

  async verifyAccess(token: string): Promise<string> {
    return (await this.verifyAccessSession(token)).userId;
  }

  /** Verifies the signature, then that the session ("sid") is still active. */
  async verifyAccessSession(token: string): Promise<AccessIdentity> {
    let sub: string;
    let sid: unknown;
    try {
      const { payload } = await jwtVerify(token, this.publicKey, { issuer: this.issuer, audience: AUDIENCE, algorithms: ["EdDSA"] });
      if (!payload.sub) throw new Error("no sub");
      sub = payload.sub;
      sid = payload.sid;
    } catch {
      throw unauthorized("Invalid or expired access token");
    }
    // Tokens minted before the session inventory carry no sid: they expire within 15 minutes, and their refresh
    // creates a session row (ensureSession), so they are accepted as they are.
    if (typeof sid !== "string") return { userId: sub, sessionId: null };
    await this.checkSession(sid, sub);
    return { userId: sub, sessionId: sid };
  }

  private async checkSession(sid: string, userId: string): Promise<void> {
    const nowMs = this.now().getTime();
    let entry = this.cache.get(sid);
    if (!entry || nowMs - entry.checkedAt > SESSION_CACHE_TTL_MS) {
      const row = await this.repo.security.getSession(sid);
      if (this.cache.size >= SESSION_CACHE_MAX) this.cache.clear();
      entry = { userId: row?.userId ?? "", revoked: !row || Boolean(row.revokedAt), lastSeenAt: row?.lastSeenAt.getTime() ?? 0, checkedAt: nowMs };
      this.cache.set(sid, entry);
    }
    if (entry.revoked || entry.userId !== userId) throw sessionRevoked();
    if (nowMs - entry.lastSeenAt >= LAST_SEEN_INTERVAL_MS) {
      entry.lastSeenAt = nowMs;
      // Best effort: a failed write must not fail the request.
      await this.repo.security.touchSession(sid, new Date(nowMs)).catch(() => undefined);
    }
  }

  /** Revokes one session: no new access token (refresh family revoked), current ones refused at once here, ≤ 30 s elsewhere. */
  async revokeSession(sessionId: string): Promise<boolean> {
    const done = await this.repo.security.revokeSession(sessionId, this.now());
    await this.repo.revokeRefreshFamily(sessionId);
    this.markRevoked(sessionId);
    return done;
  }

  /** « Déconnecter partout ailleurs »: every session of the user except `keepId` (null: all of them). */
  async revokeOtherSessions(userId: string, keepId: string | null): Promise<string[]> {
    const ids = await this.repo.security.revokeOtherSessions(userId, keepId, this.now());
    for (const id of ids) {
      await this.repo.revokeRefreshFamily(id);
      this.markRevoked(id);
    }
    // Refresh families from before the inventory have no session row: revoke them too.
    await this.repo.revokeUserRefreshTokens(userId, keepId ?? undefined);
    return ids;
  }

  private markRevoked(sessionId: string) {
    const e = this.cache.get(sessionId);
    this.cache.set(sessionId, { userId: e?.userId ?? "", revoked: true, lastSeenAt: e?.lastSeenAt ?? 0, checkedAt: this.now().getTime() });
  }

  /** Records a step-up in the session (passkey: strong). */
  async markRecentAuth(sessionId: string, strong: boolean): Promise<void> {
    await this.repo.security.markAuth(sessionId, this.now(), strong);
  }

  /**
   * Short-lived capability token for one media resource (e.g. "voicemail:<id>"), used in signed URLs
   * so players that cannot send an Authorization header can still fetch audio through the API.
   */
  async signMedia(resource: string, ttlSeconds: number): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Math.floor(Date.now() / 1000 + ttlSeconds) * 1000);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "EdDSA", kid: this.publicJwk.kid })
      .setSubject(resource)
      .setIssuer(this.issuer)
      .setAudience(MEDIA_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.privateKey);
    return { token, expiresAt };
  }

  /** True when `token` is a valid, unexpired media token for exactly `resource`. */
  async verifyMedia(token: string, resource: string): Promise<boolean> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, { issuer: this.issuer, audience: MEDIA_AUDIENCE, algorithms: ["EdDSA"] });
      return payload.sub === resource;
    } catch {
      return false;
    }
  }

  /** Rotates a refresh token. Reusing a rotated token revokes the whole family (theft signal). */
  async refresh(refreshToken: string, client?: ClientInfo): Promise<SessionTokens> {
    const row = await this.repo.findRefreshToken(sha256Hex(refreshToken));
    if (!row) throw unauthorized("Invalid refresh token");
    if (row.revokedAt) {
      await this.repo.revokeRefreshFamily(row.familyId);
      throw unauthorized("Refresh token reuse detected");
    }
    if (row.expiresAt.getTime() <= Date.now()) throw unauthorized("Refresh token expired");
    const session = await this.repo.security.getSession(row.familyId);
    if (session?.revokedAt) throw sessionRevoked();
    const user = await this.repo.getUser(row.userId);
    if (!user || user.status === "deleted" || user.status === "suspended") throw unauthorized("Account unavailable");
    if (!(await this.repo.revokeRefreshToken(row.id))) {
      await this.repo.revokeRefreshFamily(row.familyId);
      throw unauthorized("Refresh token reuse detected");
    }
    return this.issue(row.userId, row.familyId, client ? { client } : {});
  }

  /** Sign-out of this device: the refresh family and its session row. */
  async logout(refreshToken: string): Promise<void> {
    const row = await this.repo.findRefreshToken(sha256Hex(refreshToken));
    if (row) await this.revokeSession(row.familyId);
  }
}
