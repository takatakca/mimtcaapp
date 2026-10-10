import type {
  Business,
  BusinessHours,
  BusinessMember,
  BusinessRecording,
  CallRecordingPolicy,
  DidRoute,
  Extension,
  IvrMenu,
  RingGroup,
} from "@mimt/shared";
import type { Call } from "./types.js";

/** Shared DTO shapes with real Dates instead of ISO strings. */
type Dated<T, K extends keyof T = never> = Omit<T, "createdAt" | K> & { createdAt: Date };

export type BusinessRow = Dated<Business>;
export type BusinessMemberRow = Dated<BusinessMember> & { invitedBy: string | null; claimedAt: Date | null };
export type ExtensionRow = Dated<Extension>;
export type RingGroupRow = Dated<RingGroup>;
export type IvrMenuRow = Dated<IvrMenu>;
export type DidRouteRow = Dated<DidRoute>;
export type RecordingRow = Dated<BusinessRecording, "deleteAfter"> & {
  recordingSid: string;
  recordingUrl: string | null;
  userId: string | null;
  retentionDays: number;
  deleteAfter: Date;
};
export type { BusinessHours, CallRecordingPolicy };

export interface BusinessSeats {
  businessId: string;
  seats: number;
  stripeSubscriptionId: string | null;
}

export interface UserMinutes {
  userId: string;
  outboundMinutes: number;
  inboundMinutes: number;
}

type NewRow<T> = Omit<T, "id" | "createdAt">;

/** MIMT Affaires (PBX) storage. Reached through `Repository.pbx`; same contract for memory and Postgres. */
export interface PbxRepository {
  createBusiness(b: Omit<NewRow<BusinessRow>, "recordingPolicy"> & { recordingPolicy?: CallRecordingPolicy }): Promise<BusinessRow>;
  getBusiness(id: string): Promise<BusinessRow | null>;
  getBusinessByAccount(telecomAccountId: string): Promise<BusinessRow | null>;
  updateBusiness(id: string, patch: Partial<Pick<BusinessRow, "name" | "mainNumber" | "locale" | "recordingPolicy">>): Promise<BusinessRow>;
  /** Businesses where the user is an active member, with that membership. */
  listBusinessesForUser(userId: string): Promise<Array<{ business: BusinessRow; member: BusinessMemberRow }>>;

  addMember(m: Omit<NewRow<BusinessMemberRow>, "claimedAt">): Promise<BusinessMemberRow>;
  getMember(id: string): Promise<BusinessMemberRow | null>;
  /** Active membership of a user in a business. */
  getMembership(businessId: string, userId: string): Promise<BusinessMemberRow | null>;
  findMemberByEmail(businessId: string, email: string): Promise<BusinessMemberRow | null>;
  listMembers(businessId: string): Promise<BusinessMemberRow[]>;
  updateMember(id: string, patch: Partial<Pick<BusinessMemberRow, "role">>): Promise<BusinessMemberRow>;
  deleteMember(id: string): Promise<boolean>;
  /** Activates every pending invitation for this email (case-insensitive) and links it to the user. */
  claimInvites(userId: string, email: string, at: Date): Promise<BusinessMemberRow[]>;

  createExtension(e: NewRow<ExtensionRow>): Promise<ExtensionRow>;
  getExtension(id: string): Promise<ExtensionRow | null>;
  findExtensionByNumber(businessId: string, number: string): Promise<ExtensionRow | null>;
  listExtensions(businessId: string): Promise<ExtensionRow[]>;
  listExtensionsByUser(userId: string): Promise<ExtensionRow[]>;
  updateExtension(id: string, patch: Partial<Omit<ExtensionRow, "id" | "businessId" | "createdAt">>): Promise<ExtensionRow>;
  /** Also removes the extension from ring groups. */
  deleteExtension(id: string): Promise<boolean>;

  createRingGroup(g: NewRow<RingGroupRow>): Promise<RingGroupRow>;
  getRingGroup(id: string): Promise<RingGroupRow | null>;
  listRingGroups(businessId: string): Promise<RingGroupRow[]>;
  updateRingGroup(id: string, patch: Partial<Omit<RingGroupRow, "id" | "businessId" | "createdAt">>): Promise<RingGroupRow>;
  deleteRingGroup(id: string): Promise<boolean>;

  createIvrMenu(m: NewRow<IvrMenuRow>): Promise<IvrMenuRow>;
  getIvrMenu(id: string): Promise<IvrMenuRow | null>;
  listIvrMenus(businessId: string): Promise<IvrMenuRow[]>;
  updateIvrMenu(id: string, patch: Partial<Omit<IvrMenuRow, "id" | "businessId" | "createdAt">>): Promise<IvrMenuRow>;
  deleteIvrMenu(id: string): Promise<boolean>;

  getHours(businessId: string): Promise<BusinessHours | null>;
  /** Replaces the weekly schedule, targets and custom holidays. */
  putHours(h: BusinessHours): Promise<BusinessHours>;

  /** Insert or re-point the route of a number (unique on phone number). */
  upsertDidRoute(r: NewRow<DidRouteRow>): Promise<DidRouteRow>;
  getDidRoute(id: string): Promise<DidRouteRow | null>;
  getDidRouteByE164(e164: string): Promise<DidRouteRow | null>;
  listDidRoutes(businessId: string): Promise<DidRouteRow[]>;
  deleteDidRoute(id: string): Promise<boolean>;

  /** Idempotent on recordingSid. */
  createRecording(r: NewRow<RecordingRow>): Promise<RecordingRow>;
  getRecording(id: string): Promise<RecordingRow | null>;
  /** Newest first; `userId` limits to that user's calls. */
  listRecordings(businessId: string, opts?: { userId?: string; limit?: number }): Promise<RecordingRow[]>;
  listExpiredRecordings(now: Date, limit: number): Promise<RecordingRow[]>;
  deleteRecording(id: string): Promise<boolean>;

  /** Defaults to 1 seat when nothing is stored. */
  getSeats(businessId: string): Promise<BusinessSeats>;
  setSeats(businessId: string, seats: number, stripeSubscriptionId?: string | null): Promise<BusinessSeats>;

  /** Business CDR, newest first by (startedAt, id); `userId` limits to that user's calls. */
  listBusinessCalls(telecomAccountId: string, opts: { userId?: string; limit: number; before?: { startedAt: Date; id: string } }): Promise<Call[]>;
  countActiveCallsByUser(telecomAccountId: string, userId: string, since: Date): Promise<number>;
  /** PSTN minutes per user since `since` (completed calls, rounded up per call). */
  minutesByUser(telecomAccountId: string, since: Date): Promise<UserMinutes[]>;
}
