// MIMT handles (supabase/migrations/0013_user_handles.sql). See packages/shared/src/handles.ts.

export interface HandleRow {
  handle: string;
  userId: string;
  telecomAccountId: string;
  createdAt: Date;
}

export interface HandleRepository {
  forUser(userId: string): Promise<HandleRow | null>;
  find(handle: string): Promise<HandleRow | null>;
  /** Null when the handle is taken or the user already has one. */
  create(row: Omit<HandleRow, "createdAt">): Promise<HandleRow | null>;
}
