import type { ConsentKind, Feature, Locale, NumberState, PlanCode } from "@mimt/shared";
import type { PbxRepository } from "./pbxTypes.js";
import type { CatalogRepository } from "./catalog.js";
import type { CallControlsRepository } from "./callControls.js";
import type { MediaRepository } from "./mediaTypes.js";
import type { ReferralRepository } from "./referrals.js";
import type { NumberHoldRepository } from "./numberHolds.js";
import type { HandleRepository } from "./handles.js";
import type { WebPushRepository } from "./webPush.js";
import type { MissionRepository } from "./missions.js";
import type { PointsRepository } from "./points.js";
import type { AffiliateRepository } from "./affiliates.js";
import type { PortInRepository } from "./portIn.js";
import type { MeetingRepository } from "./meetings.js";

export type UserStatus = "active" | "suspended" | "pending_deletion" | "deleted";
export type AccountStatus = "ACTIVE_MANAGED" | "ACTIVE_INDEPENDENT" | "OUTBOUND_SUSPENDED" | "SUSPENDED" | "CLOSED";
export type RiskTier = "new" | "standard" | "trusted" | "high";
export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled" | "incomplete" | "unpaid";
export type { ConsentKind };
export type FraudAction = "block" | "hold" | "suspend" | "alert";
export type CallKind = "pstn" | "app" | "emergency";
export type Direction = "inbound" | "outbound";

export interface User {
  id: string;
  globalUserId: string | null;
  authUserId: string | null;
  locale: Locale;
  displayName: string | null;
  email: string | null;
  phoneE164: string | null;
  phoneVerifiedAt: Date | null;
  deviceVerifiedAt: Date | null;
  status: UserStatus;
  deletionScheduledAt: Date | null;
  createdAt: Date;
}

export interface RefreshToken {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface TelecomAccount {
  id: string;
  ownerUserId: string;
  workspaceId: string | null;
  businessId: string | null;
  kind: "consumer" | "business";
  status: AccountStatus;
  riskTier: RiskTier;
  twilioSubaccountSid: string | null;
  stripeCustomerId: string | null;
  intlCreditCents: number;
  createdAt: Date;
}

export interface Subscription {
  id: string;
  telecomAccountId: string;
  /** "plan": code is a PlanCode. "addon": code is an ADD_ONS key. */
  kind: "plan" | "addon";
  code: string;
  quantity: number;
  stripeSubscriptionId: string | null;
  status: SubscriptionStatus;
  source: "stripe" | "iap_apple" | "iap_google" | "takatak" | "manual";
  currentPeriodEnd: Date | null;
  createdAt: Date;
}

export interface Entitlement {
  telecomAccountId: string;
  feature: Feature;
  limit: number | null;
  source: string;
}

export interface PhoneNumber {
  id: string;
  e164: string;
  twilioSid: string | null;
  telecomAccountId: string | null;
  kind: "local" | "toll_free";
  state: NumberState;
  lastActivityAt: Date;
  stateChangedAt: Date;
  quarantineUntil: Date | null;
  warningsSent: number[];
  createdAt: Date;
}

export interface E911Address {
  id: string;
  telecomAccountId: string;
  phoneNumberId: string | null;
  customerName: string;
  street: string;
  unit: string | null;
  city: string;
  province: string;
  postalCode: string;
  country: "CA";
  validatedAt: Date | null;
  providerRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface E911Acknowledgement {
  id: string;
  userId: string;
  noticeVersion: string;
  acceptedAt: Date;
  ip: string | null;
  appVersion: string | null;
  userAgent: string | null;
}

export interface Call {
  id: string;
  twilioCallSid: string;
  telecomAccountId: string | null;
  userId: string | null;
  direction: Direction;
  kind: CallKind;
  fromNumber: string;
  toNumber: string;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  durationS: number | null;
  price: number | null;
  priceUnit: string | null;
  ratedCad: number | null;
  usageApplied: boolean;
}

export interface Message {
  id: string;
  twilioSid: string | null;
  telecomAccountId: string;
  direction: Direction;
  ourNumber: string;
  peer: string;
  bodyEncrypted: string;
  bodyFingerprint: string;
  status: string;
  segments: number;
  numMedia: number;
  price: number | null;
  priceUnit: string | null;
  errorCode: string | null;
  createdAt: Date;
}

export interface Conversation {
  peer: string;
  ourNumber: string;
  lastMessageId: string;
  lastMessageAt: Date;
  lastBodyEncrypted: string;
  lastDirection: Direction;
}

export interface Voicemail {
  id: string;
  telecomAccountId: string;
  phoneNumberId: string;
  callSid: string;
  recordingSid: string;
  fromNumber: string | null;
  audioUrl: string | null;
  audioPath: string | null;
  durationS: number | null;
  transcript: string | null;
  transcriptLang: string | null;
  listenedAt: Date | null;
  createdAt: Date;
}

export type PushPlatform = "ios" | "android";
export type PushKind = "messages";

/** Native device push token (APNs / FCM). A token belongs to one user at a time. */
export interface PushToken {
  id: string;
  userId: string;
  platform: PushPlatform;
  kind: PushKind;
  token: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Consent {
  id: string;
  userId: string;
  kind: ConsentKind;
  granted: boolean;
  version: string;
  source: string;
  ip: string | null;
  at: Date;
}

export interface Usage {
  telecomAccountId: string;
  /** "YYYY-MM" (month) or "YYYY-MM-DD" (day). */
  period: string;
  minutesOut: number;
  minutesIn: number;
  smsOut: number;
  /** Inbound SMS segments and MMS: Twilio bills receiving too, so they count in the plan's messages. */
  smsIn: number;
  /** Outbound MMS (within smsOut). */
  mmsOut: number;
  /** App-to-app call minutes (free plan fair use; paid plans count them in minutesOut). */
  minutesOnNet: number;
  bonusMinutesOut: number;
  /** Bonus app-to-app minutes (free plan's own pool, e.g. Missions MIMT). */
  bonusMinutesOnNet: number;
  /** Bonus texts (MIMT Points rewards): raise the plan's `messages` cap this period. */
  bonusMessages: number;
  spendCad: number;
  intlSpendCad: number;
}

export const emptyUsage = (telecomAccountId: string, period: string): Usage => ({
  telecomAccountId,
  period,
  minutesOut: 0,
  minutesIn: 0,
  smsOut: 0,
  smsIn: 0,
  mmsOut: 0,
  minutesOnNet: 0,
  bonusMinutesOut: 0,
  bonusMinutesOnNet: 0,
  bonusMessages: 0,
  spendCad: 0,
  intlSpendCad: 0,
});

/** Messages counted against a plan's `messages` cap: sent and received. */
export const messagesUsed = (u: Pick<Usage, "smsOut" | "smsIn">) => u.smsOut + u.smsIn;

export type UsageDelta =Partial<Omit<Usage, "telecomAccountId" | "period">>;

export interface FraudEvent {
  id: string;
  telecomAccountId: string | null;
  rule: string;
  score: number;
  action: FraudAction;
  details: Record<string, unknown>;
  at: Date;
}

export interface Handoff {
  id: string;
  tokenHash: string;
  globalUserId: string;
  workspaceId: string;
  businessId: string | null;
  planHint: PlanCode | null;
  locale: Locale;
  jti: string;
  expiresAt: Date;
  claimedAt: Date | null;
  claimedByUserId: string | null;
  createdAt: Date;
}

export interface OutboxEvent {
  id: string;
  eventType: "entitlement.updated" | "telecom_account.status_changed" | "phone_number.assigned";
  payload: Record<string, unknown>;
  attempts: number;
  /** null once retries are exhausted (dead letter). */
  nextAttemptAt: Date | null;
  deliveredAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}

export interface AuditEntry {
  actorUserId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string | null;
  meta?: Record<string, unknown>;
  /** Defaults to the database clock. Set it when the time matters to a later count (free-tier claims). */
  at?: Date;
}

type New<T, Optional extends keyof T = never> = Omit<T, "id" | "createdAt" | Optional> & Partial<Pick<T, Optional>>;

/** Files an account purge left outside the database: storage objects, Twilio media and voicemail recordings. */
export interface PurgeResult {
  mediaPaths: string[];
  twilioMediaUrls: string[];
  recordingSids: string[];
}

export interface Repository {
  /** MIMT Affaires (business PBX) storage: src/repo/pbxTypes.ts. */
  readonly pbx: PbxRepository;
  /** Catalog / internet + mobile resale storage: src/repo/catalog.ts. */
  readonly catalog: CatalogRepository;
  /** Consumer call blocking, forwarding and do not disturb: src/repo/callControls.ts. */
  readonly callControls: CallControlsRepository;
  /** MMS media, voicemail greeting/settings, email outbox: src/repo/mediaTypes.ts. */
  readonly media: MediaRepository;
  /** Referral codes, referrals and payment fingerprints: src/repo/referrals.ts. */
  readonly referrals: ReferralRepository;
  /** Number picker holds: src/repo/numberHolds.ts. */
  readonly numberHolds: NumberHoldRepository;
  /** MIMT handles (@nom): src/repo/handles.ts. */
  readonly handles: HandleRepository;
  /** Web Push subscriptions and server keys: src/repo/webPush.ts. */
  readonly webPush: WebPushRepository;
  /** « Missions MIMT » reward ledger: src/repo/missions.ts. */
  readonly missions: MissionRepository;
  /** « MIMT Points » ledger, redemptions and campaigns: src/repo/points.ts. */
  readonly points: PointsRepository;
  /** « Programme d'agents affiliés »: applications, attribution, commission ledger: src/repo/affiliates.ts. */
  readonly affiliates: AffiliateRepository;
  /** Number port-in (landline/VoIP into MIMT) storage: src/repo/portIn.ts. */
  readonly portIns: PortInRepository;
  /** Réunions MIMT (video meetings) storage: src/repo/meetings.ts. */
  readonly meetings: MeetingRepository;
  ping(): Promise<void>;
  /** Names of applied migrations (Postgres only; absent in memory). Lets /readyz report schema drift. */
  appliedMigrations?(): Promise<string[]>;
  close(): Promise<void>;

  createUser(u: New<User, "authUserId" | "email" | "phoneE164" | "phoneVerifiedAt" | "deviceVerifiedAt" | "deletionScheduledAt" | "status">): Promise<User>;
  getUser(id: string): Promise<User | null>;
  findUserByGlobalId(globalUserId: string): Promise<User | null>;
  findUserByPhone(e164: string): Promise<User | null>;
  updateUser(id: string, patch: Partial<Omit<User, "id" | "createdAt">>): Promise<User>;
  /** Users whose deletion request is due (status pending_deletion, deletionScheduledAt ≤ now), oldest first. */
  listUsersDueForDeletion(now: Date, limit: number): Promise<User[]>;
  /**
   * Account deletion (jobs/accountDeletion.ts): deletes the user's personal data in one transaction and anonymises
   * the user row (status "deleted"). Keeps only what the law requires: subscriptions and usage (billing), call
   * records, 9-1-1 notice acceptances, audit and fraud logs, the mission reward ledger (hashed, anti-abuse), the closed account row and MIMT's own phone numbers.
   * Returns the files left to delete outside the database.
   */
  purgeUserData(userId: string, accountId: string | null): Promise<PurgeResult>;

  createRefreshToken(t: New<RefreshToken, "revokedAt">): Promise<RefreshToken>;
  findRefreshToken(tokenHash: string): Promise<RefreshToken | null>;
  revokeRefreshToken(id: string): Promise<boolean>;
  revokeRefreshFamily(familyId: string): Promise<void>;
  revokeUserRefreshTokens(userId: string): Promise<void>;

  createAccount(a: New<TelecomAccount, "workspaceId" | "businessId" | "twilioSubaccountSid" | "stripeCustomerId" | "intlCreditCents">): Promise<TelecomAccount>;
  getAccount(id: string): Promise<TelecomAccount | null>;
  getAccountByOwner(userId: string): Promise<TelecomAccount | null>;
  findAccountByStripeCustomer(customerId: string): Promise<TelecomAccount | null>;
  updateAccount(id: string, patch: Partial<Omit<TelecomAccount, "id" | "createdAt">>): Promise<TelecomAccount>;
  addIntlCredit(id: string, cents: number): Promise<number>;

  listSubscriptions(accountId: string): Promise<Subscription[]>;
  upsertSubscription(s: New<Subscription>): Promise<Subscription>;
  /** The row of a Stripe subscription or store purchase (`ios:<originalTransactionId>`, `android:<token>`). */
  findSubscriptionByExternalId(externalId: string): Promise<Subscription | null>;

  listEntitlements(accountId: string): Promise<Entitlement[]>;
  replaceEntitlements(accountId: string, source: string, items: Array<{ feature: Feature; limit: number | null }>): Promise<void>;

  createNumber(n: New<PhoneNumber, "quarantineUntil" | "warningsSent">): Promise<PhoneNumber>;
  getNumber(id: string): Promise<PhoneNumber | null>;
  getNumberByE164(e164: string): Promise<PhoneNumber | null>;
  listNumbersByAccount(accountId: string): Promise<PhoneNumber[]>;
  listNumbersInStates(states: NumberState[]): Promise<PhoneNumber[]>;
  updateNumber(id: string, patch: Partial<Omit<PhoneNumber, "id" | "createdAt">>): Promise<PhoneNumber>;
  purgeNumberContent(numberId: string, e164: string): Promise<void>;

  upsertE911Address(a: New<E911Address, "updatedAt">): Promise<E911Address>;
  getE911Address(accountId: string): Promise<E911Address | null>;
  addE911Ack(a: Omit<E911Acknowledgement, "id">): Promise<E911Acknowledgement>;
  getLatestE911Ack(userId: string): Promise<E911Acknowledgement | null>;
  listE911Acks(userId: string): Promise<E911Acknowledgement[]>;

  upsertCall(c: New<Call, "endedAt" | "durationS" | "price" | "priceUnit" | "ratedCad" | "usageApplied">): Promise<Call>;
  getCallBySid(sid: string): Promise<Call | null>;
  updateCall(id: string, patch: Partial<Omit<Call, "id">>): Promise<Call>;
  countActiveCalls(accountId: string, since: Date): Promise<number>;
  listCalls(accountId: string, limit: number): Promise<Call[]>;
  /** Newest first by (startedAt, id); `before` is an exclusive keyset cursor. */
  listCallsPage(accountId: string, opts: { limit: number; before?: { startedAt: Date; id: string } }): Promise<Call[]>;

  createMessage(m: New<Message, "price" | "priceUnit" | "errorCode">): Promise<Message>;
  updateMessageBySid(sid: string, patch: Partial<Pick<Message, "status" | "segments" | "price" | "priceUnit" | "errorCode">>): Promise<Message | null>;
  listConversations(accountId: string): Promise<Conversation[]>;
  listMessages(accountId: string, peer: string, opts: { limit: number; before?: { createdAt: Date; id: string } }): Promise<Message[]>;
  countOutboundSince(accountId: string, since: Date): Promise<number>;
  countFingerprintRecipientsSince(accountId: string, fingerprint: string, since: Date): Promise<number>;
  hasOutboundTo(accountId: string, peer: string, before: Date): Promise<boolean>;
  countNewRecipientsSince(accountId: string, since: Date): Promise<number>;

  createVoicemail(v: New<Voicemail, "audioPath" | "transcript" | "transcriptLang" | "listenedAt">): Promise<Voicemail>;
  updateVoicemailByRecordingSid(sid: string, patch: Partial<Pick<Voicemail, "transcript" | "transcriptLang" | "audioPath">>): Promise<Voicemail | null>;
  listVoicemails(accountId: string): Promise<Voicemail[]>;
  getVoicemail(id: string): Promise<Voicemail | null>;
  markVoicemailListened(id: string, at: Date): Promise<void>;
  /** True when a row was deleted. */
  deleteVoicemail(id: string): Promise<boolean>;

  /** Insert or move the token to this user/platform/kind (unique on token). */
  upsertPushToken(t: { userId: string; platform: PushPlatform; kind: PushKind; token: string }): Promise<PushToken>;
  listPushTokens(userId: string): Promise<PushToken[]>;
  deletePushTokensForUser(userId: string): Promise<void>;

  addConsent(c: Omit<Consent, "id">): Promise<Consent>;
  listConsents(userId: string): Promise<Consent[]>;

  addUsage(accountId: string, periods: string[], delta: UsageDelta): Promise<void>;
  getUsage(accountId: string, period: string): Promise<Usage>;
  /**
   * Free-tier cost guard: summed usage of every account WITHOUT a live paid plan (no active/trialing/past_due plan
   * other than "free"; manual grants past their end do not count) for one period ("YYYY-MM").
   */
  freePlanUsage(period: string, now: Date): Promise<{ spendCad: number; smsOut: number }>;
  /** Free-tier cost guard: audit rows "number.claimed" with meta.plan = "free" at or after `since`. */
  countFreeNumberClaimsSince(since: Date): Promise<number>;
  /** Free-tier cost guard: numbers in state active/locked/grace held by accounts without a live paid plan (same rule as freePlanUsage). */
  countActiveFreeNumbers(now: Date): Promise<number>;

  addFraudEvent(e: Omit<FraudEvent, "id" | "at">): Promise<FraudEvent>;
  listFraudEvents(accountId: string): Promise<FraudEvent[]>;

  createHandoff(h: New<Handoff, "claimedAt" | "claimedByUserId">): Promise<Handoff>;
  findHandoffByTokenHash(tokenHash: string): Promise<Handoff | null>;
  /** Atomically marks the handoff claimed. False if it was already claimed. */
  claimHandoff(id: string, userId: string, at: Date): Promise<boolean>;

  /** Records a single-use identifier (JWT jti, Stripe event id). False if already seen. */
  useOnce(key: string, expiresAt: Date): Promise<boolean>;

  /** Binds an attested device to this user. "taken" when another user already has it. */
  bindDevice(input: { platform: "ios" | "android"; deviceKey: string; userId: string; verifiedAt: Date }): Promise<"ok" | "taken">;
  /** Inserts a verified ad reward. False when the transaction was already stored. */
  grantAdReward(input: { userId: string; transactionId: string; minutes: number; createdAt: Date }): Promise<boolean>;
  countAdRewardsSince(userId: string, since: Date): Promise<number>;
  /** Marks the oldest unclaimed reward as claimed. */
  claimAdReward(userId: string, at: Date): Promise<{ transactionId: string; minutes: number } | null>;

  setOptOut(ourNumber: string, peer: string, optedOut: boolean): Promise<void>;
  isOptedOut(ourNumber: string, peer: string): Promise<boolean>;

  enqueueOutbox(eventType: OutboxEvent["eventType"], payload: Record<string, unknown>): Promise<OutboxEvent>;
  listDueOutbox(now: Date, limit: number): Promise<OutboxEvent[]>;
  markOutboxDelivered(id: string, at: Date): Promise<void>;
  markOutboxFailed(id: string, error: string, nextAttemptAt: Date | null): Promise<void>;

  audit(entry: AuditEntry): Promise<void>;
}
