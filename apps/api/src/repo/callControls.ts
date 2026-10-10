import type { CallSettings } from "@mimt/shared";

/** A blocked number (supabase/migrations/0006_blocks_forwarding.sql). */
export interface BlockedNumber {
  id: string;
  telecomAccountId: string;
  e164: string;
  label: string | null;
  createdAt: Date;
}

/** Consumer call controls storage: blocks, forwarding and do not disturb. */
export interface CallControlsRepository {
  listBlocks(accountId: string): Promise<BlockedNumber[]>;
  /** Idempotent: returns the existing row (created=false) when the number is already blocked. */
  addBlock(input: { telecomAccountId: string; e164: string; label: string | null }): Promise<{ block: BlockedNumber; created: boolean }>;
  /** Removes by row id; true when a row of this account was deleted. */
  removeBlock(accountId: string, id: string): Promise<boolean>;
  isBlocked(accountId: string, e164: string): Promise<boolean>;

  /** Stored settings, or DEFAULT_CALL_SETTINGS when the account never changed them. */
  getCallSettings(accountId: string): Promise<CallSettings>;
  saveCallSettings(accountId: string, settings: CallSettings): Promise<CallSettings>;
}
