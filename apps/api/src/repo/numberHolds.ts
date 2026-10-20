// Number picker holds (supabase/migrations/0012_number_holds.sql). See packages/shared/src/numberSearch.ts.
import type { NumberHoldStatus } from "@mimt/shared";

export interface NumberHoldRow {
  id: string;
  e164: string;
  /** sha256 of the hold token (never the token). */
  tokenHash: string;
  /** Salted sha256 of the visitor IP (abuse limits only). */
  ipHash: string;
  status: NumberHoldStatus;
  telecomAccountId: string | null;
  checkoutSessionId: string | null;
  expiresAt: Date;
  createdAt: Date;
}

export const LIVE_HOLD_STATES: ReadonlySet<NumberHoldStatus> = new Set(["held", "checkout"]);

export interface NumberHoldRepository {
  /** Expires stale live holds on this number, then takes a new one. Null when someone else holds it. */
  create(h: { e164: string; tokenHash: string; ipHash: string; expiresAt: Date; now: Date }): Promise<NumberHoldRow | null>;
  get(id: string): Promise<NumberHoldRow | null>;
  /** Numbers among `e164s` with a live, unexpired hold. */
  liveHeld(e164s: readonly string[], now: Date): Promise<Set<string>>;
  /** Live, unexpired holds taken from this IP hash. */
  liveByIp(ipHash: string, now: Date): Promise<NumberHoldRow[]>;
  /** Holds created from this IP hash since `since` (any status). */
  countByIpSince(ipHash: string, since: Date): Promise<number>;
  /** held → checkout, bound to an account and a Stripe session. False when the hold is no longer live. */
  startCheckout(id: string, p: { telecomAccountId: string; checkoutSessionId: string; expiresAt: Date; now: Date }): Promise<boolean>;
  /** Moves a live hold to a final state. False when it was not live (retries, races). */
  finish(id: string, status: Extract<NumberHoldStatus, "converted" | "released" | "failed" | "expired">): Promise<boolean>;
}
