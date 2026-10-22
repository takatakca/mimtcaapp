// Web Push subscriptions and server keys (supabase/migrations/0014_web_push.sql).

export interface WebPushSubscriptionRow {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: Date;
}

export interface WebPushRepository {
  /** Same endpoint again (or from another user after a sign-out): it moves to this user. */
  upsert(s: Omit<WebPushSubscriptionRow, "id" | "createdAt">): Promise<WebPushSubscriptionRow>;
  listForUser(userId: string): Promise<WebPushSubscriptionRow[]>;
  deleteByEndpoint(endpoint: string): Promise<void>;
  /** Encrypted server secret by name, or null. */
  getKey(name: string): Promise<string | null>;
  /** Stores the value unless one exists already; returns the value that won (first writer wins). */
  putKeyOnce(name: string, valueEncrypted: string): Promise<string>;
}
