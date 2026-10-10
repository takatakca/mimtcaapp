import type { PortInAddress, PortInCustomerType, PortInNumberStatus, PortInStatus } from "@mimt/shared";

// Number port-in storage (supabase/migrations/0009_port_in.sql). Reached through `Repository.portIns`.

export interface PortInRow {
  id: string;
  telecomAccountId: string;
  userId: string;
  businessId: string | null;
  kind: "consumer" | "business";
  status: PortInStatus;
  currentCarrier: string;
  customerType: PortInCustomerType;
  customerName: string;
  authorizedName: string;
  authorizedEmail: string;
  serviceAddress: PortInAddress;
  /** MessageCipher ciphertext. Never returned by the API, never logged. */
  accountNumberEncrypted: string;
  pinEncrypted: string | null;
  temporaryNumber: string | null;
  keepTemporaryNumber: boolean;
  desiredDate: string | null;
  feeCents: number;
  loaVersion: string | null;
  loaSignedName: string | null;
  loaSignedAt: Date | null;
  loaSignedIp: string | null;
  loaUserAgent: string | null;
  loaSha256: string | null;
  /** Twilio port-in request SID. */
  carrierRef: string | null;
  statusReason: string | null;
  completedAt: Date | null;
  canceledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PortInNumberRow {
  id: string;
  portInId: string;
  e164: string;
  status: PortInNumberStatus;
  focDate: string | null;
  rejectionReason: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PortInWithNumbers {
  request: PortInRow;
  numbers: PortInNumberRow[];
}

export type NewPortIn = Omit<
  PortInRow,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "status"
  | "loaVersion"
  | "loaSignedName"
  | "loaSignedAt"
  | "loaSignedIp"
  | "loaUserAgent"
  | "loaSha256"
  | "carrierRef"
  | "statusReason"
  | "completedAt"
  | "canceledAt"
>;

/** Thrown when a number already has an open port (unique open e164). */
export class PortInNumberTakenError extends Error {
  constructor(readonly e164: string) {
    super("number already has an open port-in");
    this.name = "PortInNumberTakenError";
  }
}

export interface PortInRepository {
  /** Inserts the request and its numbers (status pending) atomically. */
  create(r: NewPortIn, numbers: string[]): Promise<PortInWithNumbers>;
  get(id: string): Promise<PortInWithNumbers | null>;
  getByCarrierRef(carrierRef: string): Promise<PortInWithNumbers | null>;
  /** Newest first. */
  listByAccounts(telecomAccountIds: string[]): Promise<PortInWithNumbers[]>;
  update(id: string, patch: Partial<Omit<PortInRow, "id" | "createdAt" | "telecomAccountId" | "userId">>): Promise<PortInRow>;
  updateNumber(id: string, patch: Partial<Pick<PortInNumberRow, "status" | "focDate" | "rejectionReason" | "completedAt">>): Promise<PortInNumberRow>;
  /** The open (not settled) port of a number, if any. */
  findOpenNumber(e164: string): Promise<PortInNumberRow | null>;
}
