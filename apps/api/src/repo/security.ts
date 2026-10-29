// Session inventory, passkeys and business strong-auth policy (supabase/migrations/0022_security_sessions.sql).
import type { AuthMethod } from "@mimt/shared";

export interface AuthSessionRow {
  /** = refresh-token family id = "sid" claim of the access tokens. */
  id: string;
  userId: string;
  method: AuthMethod;
  /** Coarse label (lib/clientInfo.ts), never the raw user agent. */
  userAgent: string | null;
  /** /24 or /48 network, never the full address. */
  ipPrefix: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  recentAuthAt: Date | null;
  strongAuthAt: Date | null;
  revokedAt: Date | null;
}

export interface NewAuthSession {
  id: string;
  userId: string;
  method: AuthMethod;
  userAgent: string | null;
  ipPrefix: string | null;
  at: Date;
  recentAuthAt: Date | null;
  strongAuthAt: Date | null;
}

export interface PasskeyRow {
  id: string;
  userId: string;
  /** base64url credential id. */
  credentialId: string;
  /** base64url COSE public key. */
  publicKey: string;
  counter: number;
  transports: string[];
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface SecurityRepository {
  /** Inserts the session; when the id exists already, returns the stored row unchanged. */
  createSession(s: NewAuthSession): Promise<AuthSessionRow>;
  getSession(id: string): Promise<AuthSessionRow | null>;
  /** Sessions not revoked, most recently seen first. */
  listActiveSessions(userId: string): Promise<AuthSessionRow[]>;
  /** For "new device" detection: does the user have any earlier session, and one with this device label? */
  deviceHistory(userId: string, userAgent: string): Promise<{ anySession: boolean; sameDevice: boolean }>;
  touchSession(id: string, at: Date): Promise<void>;
  /** Records a step-up: recent_auth_at = at, and strong_auth_at = at when `strong`. */
  markAuth(id: string, at: Date, strong: boolean): Promise<void>;
  /** True when the session was active and is now revoked. */
  revokeSession(id: string, at: Date): Promise<boolean>;
  /** Revokes every active session of the user except `keepId`; returns the revoked ids. */
  revokeOtherSessions(userId: string, keepId: string | null, at: Date): Promise<string[]>;
  /** Deletes sessions revoked before `before`, or not seen since `before`. Returns how many. */
  pruneSessions(before: Date): Promise<number>;

  addPasskey(p: Omit<PasskeyRow, "id" | "createdAt" | "lastUsedAt"> & { createdAt: Date }): Promise<PasskeyRow>;
  listPasskeys(userId: string): Promise<PasskeyRow[]>;
  findPasskeyByCredentialId(credentialId: string): Promise<PasskeyRow | null>;
  updatePasskeyUse(id: string, counter: number, at: Date): Promise<void>;
  /** True when a row of this user was deleted. */
  deletePasskey(id: string, userId: string): Promise<boolean>;

  getBusinessPolicy(businessId: string): Promise<{ requireStrongAuth: boolean }>;
  setBusinessPolicy(businessId: string, requireStrongAuth: boolean, updatedBy: string, at: Date): Promise<void>;
}
