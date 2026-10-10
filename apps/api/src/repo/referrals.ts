// Referral program storage (supabase/migrations/0008_referrals_addons.sql). Parity P1 item 3.
import type { ReferralRejectReason, ReferralStatus } from "@mimt/shared";

export interface ReferralCodeRow {
  code: string;
  userId: string;
  createdAt: Date;
}

export interface ReferralRow {
  id: string;
  code: string;
  referrerUserId: string;
  refereeUserId: string;
  status: ReferralStatus;
  rejectReason: ReferralRejectReason | null;
  /** sha256 of the device key the referee redeemed from (never the raw key). */
  deviceKeyHash: string | null;
  /** Stripe card fingerprint of the referee's first paid plan invoice. */
  refereePaymentFingerprint: string | null;
  rewardedAt: Date | null;
  createdAt: Date;
}

export interface ReferralRepository {
  getCodeForUser(userId: string): Promise<ReferralCodeRow | null>;
  /** Null when the code is already taken (the caller retries with another code). */
  createCode(userId: string, code: string): Promise<ReferralCodeRow | null>;
  findCode(code: string): Promise<ReferralCodeRow | null>;

  /** Null when the referee already has a referral (one per referee). */
  createReferral(r: Pick<ReferralRow, "code" | "referrerUserId" | "refereeUserId" | "deviceKeyHash">): Promise<ReferralRow | null>;
  getReferralForReferee(userId: string): Promise<ReferralRow | null>;
  listReferralsByReferrer(userId: string): Promise<ReferralRow[]>;
  /** Moves a pending referral to rewarded/rejected. False when it was no longer pending (webhook retries, races). */
  settleReferral(
    id: string,
    outcome: { status: "rewarded" | "rejected"; rejectReason: ReferralRejectReason | null; refereePaymentFingerprint: string | null; at: Date },
  ): Promise<boolean>;

  /** Device keys attested by this user (attested_devices). */
  listDeviceKeys(userId: string): Promise<string[]>;
  /** Users an attested device key is bound to. */
  findDeviceUsers(deviceKey: string): Promise<string[]>;

  /** Card fingerprints seen on this account's paid Stripe payments. */
  addPaymentFingerprint(accountId: string, fingerprint: string, at: Date): Promise<void>;
  listPaymentFingerprints(accountId: string): Promise<string[]>;
}
