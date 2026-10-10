import { randomUUID } from "node:crypto";
import type { ReferralCodeRow, ReferralRepository, ReferralRow } from "./referrals.js";

type DeviceRow = { deviceKey: string; userId: string };

/** In-memory referral storage (tests, local dev). Device rows come from MemoryRepository.devices. */
export class MemoryReferralRepository implements ReferralRepository {
  codes = new Map<string, ReferralCodeRow>();
  referrals = new Map<string, ReferralRow>();
  fingerprints: Array<{ accountId: string; fingerprint: string; at: Date }> = [];

  constructor(private readonly devices: () => Iterable<DeviceRow>) {}

  async getCodeForUser(userId: string) {
    const row = [...this.codes.values()].find((c) => c.userId === userId);
    return row ? { ...row } : null;
  }
  async createCode(userId: string, code: string) {
    if (this.codes.has(code) || (await this.getCodeForUser(userId))) return null;
    const row = { code, userId, createdAt: new Date() };
    this.codes.set(code, row);
    return { ...row };
  }
  async findCode(code: string) {
    const row = this.codes.get(code);
    return row ? { ...row } : null;
  }

  async createReferral(r: Pick<ReferralRow, "code" | "referrerUserId" | "refereeUserId" | "deviceKeyHash">) {
    if ([...this.referrals.values()].some((x) => x.refereeUserId === r.refereeUserId)) return null;
    const row: ReferralRow = {
      ...r,
      id: randomUUID(),
      status: "pending",
      rejectReason: null,
      refereePaymentFingerprint: null,
      rewardedAt: null,
      createdAt: new Date(),
    };
    this.referrals.set(row.id, row);
    return { ...row };
  }
  async getReferralForReferee(userId: string) {
    const row = [...this.referrals.values()].find((x) => x.refereeUserId === userId);
    return row ? { ...row } : null;
  }
  async listReferralsByReferrer(userId: string) {
    return [...this.referrals.values()]
      .filter((x) => x.referrerUserId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((x) => ({ ...x }));
  }
  async settleReferral(id: string, o: Parameters<ReferralRepository["settleReferral"]>[1]) {
    const row = this.referrals.get(id);
    if (!row || row.status !== "pending") return false;
    row.status = o.status;
    row.rejectReason = o.rejectReason;
    row.refereePaymentFingerprint = o.refereePaymentFingerprint;
    row.rewardedAt = o.status === "rewarded" ? o.at : null;
    return true;
  }

  async listDeviceKeys(userId: string) {
    return [...this.devices()].filter((d) => d.userId === userId).map((d) => d.deviceKey);
  }
  async findDeviceUsers(deviceKey: string) {
    return [...new Set([...this.devices()].filter((d) => d.deviceKey === deviceKey).map((d) => d.userId))];
  }

  async addPaymentFingerprint(accountId: string, fingerprint: string, at: Date) {
    if (this.fingerprints.some((f) => f.accountId === accountId && f.fingerprint === fingerprint)) return;
    this.fingerprints.push({ accountId, fingerprint, at });
  }
  async listPaymentFingerprints(accountId: string) {
    return this.fingerprints.filter((f) => f.accountId === accountId).map((f) => f.fingerprint);
  }
}
