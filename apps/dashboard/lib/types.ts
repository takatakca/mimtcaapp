/** Response shapes of the read-only /v1/admin/* endpoints (apps/api/src/routes/adminDashboard.ts). */

export interface Overview {
  signups7d: number;
  signups30d: number;
  activeUsers: number;
  mrrCents: number;
  calls30d: number;
  messages30d: number;
  voicemails30d: number;
}

export interface DashboardUser {
  id: string;
  email: string | null;
  phoneE164: string | null;
  displayName: string | null;
  status: string;
  createdAt: string;
  phoneVerifiedAt: string | null;
  account: {
    id: string;
    kind: string;
    status: string;
    plan: string;
    planSource: string | null;
    numbers: string[];
  } | null;
}

export interface UsageAccount {
  accountId: string;
  ownerUserId: string;
  kind: string;
  status: string;
  plan: string;
  usage: { minutesOut: number; minutesIn: number; smsOut: number; smsIn: number; spendCad: number };
  caps: { outboundMinutes: number; inboundMinutes: number; messages: number };
  entitlements: Array<{ feature: string; limit: number | null }>;
}

export interface UsageResponse {
  period: string;
  accounts: UsageAccount[];
  topTalkers: Array<{ accountId: string; minutes: number }>;
  e911Gaps: Array<{ accountId: string; ownerUserId: string; missingAddress: boolean; missingAck: boolean }>;
  numberInventory: Array<{ areaCode: string; count: number }>;
  page: { limit: number; offset: number };
}

export interface RevenueSub {
  id: string;
  telecomAccountId: string;
  kind: string;
  code: string;
  status: string;
  source: string;
  currentPeriodEnd: string | null;
}

export interface RevenueResponse {
  mrrCents: number;
  byPlanSource: Array<{ kind: string; plan: string; source: string; count: number }>;
  trials: RevenueSub[];
  dunning: RevenueSub[];
  affiliatePayoutsPending: Array<{
    id: string;
    affiliateId: string;
    commissionCents: number;
    reversedCents: number;
    status: string;
    payableAt: string;
  }>;
  pointsLiability: number;
}

export interface FraudResponse {
  events: Array<{
    id: string;
    telecomAccountId: string | null;
    rule: string;
    score: number;
    action: string;
    at: string;
  }>;
  byRule: Record<string, number>;
  byAction: Record<string, number>;
  otpFailureRate: number | null;
}

export interface SupportResponse {
  unverifiedUsers: Array<{
    id: string;
    email: string | null;
    phoneE164: string | null;
    displayName: string | null;
    createdAt: string;
  }>;
  e911Gaps: Array<{ accountId: string; ownerUserId: string; missingAddress: boolean; missingAck: boolean }>;
  recentAudit: Array<{ actorUserId: string | null; action: string; targetType?: string; targetId?: string; at: string }>;
  userAudit: Array<{ actorUserId: string | null; action: string; targetType?: string; targetId?: string; at: string }>;
}

export const cad = (cents: number): string =>
  new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" }).format(cents / 100);

export const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
};
