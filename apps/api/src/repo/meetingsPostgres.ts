import type postgres from "postgres";
import type { MeetingEventRow, MeetingInviteRow, MeetingRepository, MeetingRow, NewMeeting, NewMeetingEvent, NewMeetingInvite } from "./meetings.js";

type Sql = postgres.Sql<{}>;
type Row = Record<string, any>;

const defined = (o: object): Row => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

function first<T>(rows: readonly unknown[]): T {
  const row = rows[0];
  if (!row) throw new Error("expected a row");
  return row as T;
}

/** bigint identity comes back as a string from postgres.js. */
const event = (r: Row): MeetingEventRow => ({ ...(r as MeetingEventRow), id: Number(r.id) });

/** Meetings storage on Postgres (0010_meetings.sql). Shares the connection pool of PostgresRepository. */
export class PostgresMeetingRepository implements MeetingRepository {
  constructor(private readonly sql: Sql) {}

  async create(m: NewMeeting) {
    return first<MeetingRow>(await this.sql`insert into meetings ${this.sql(defined(m))} returning *`);
  }

  async get(id: string) {
    const rows = await this.sql`select * from meetings where id = ${id}`;
    return (rows[0] as MeetingRow | undefined) ?? null;
  }

  async getByRoomName(roomName: string) {
    const rows = await this.sql`select * from meetings where room_name = ${roomName}`;
    return (rows[0] as MeetingRow | undefined) ?? null;
  }

  async listForUser(userId: string, businessIds: string[], limit = 100) {
    return (await this.sql`select * from meetings m
      where m.host_user_id = ${userId}
         or m.business_id = any(${businessIds}::uuid[])
         or exists (select 1 from meeting_invites i where i.meeting_id = m.id and i.user_id = ${userId})
      order by m.created_at desc, m.id desc limit ${limit}`) as unknown as MeetingRow[];
  }

  async update(id: string, patch: Parameters<MeetingRepository["update"]>[1]) {
    const cols = defined(patch);
    if (Object.keys(cols).length === 0) return first<MeetingRow>(await this.sql`select * from meetings where id = ${id}`);
    return first<MeetingRow>(await this.sql`update meetings set ${this.sql(cols)} where id = ${id} returning *`);
  }

  async createInvite(i: NewMeetingInvite) {
    return first<MeetingInviteRow>(await this.sql`insert into meeting_invites ${this.sql(defined(i))} returning *`);
  }

  async listInvites(meetingId: string) {
    return (await this.sql`select * from meeting_invites where meeting_id = ${meetingId} order by created_at, id`) as unknown as MeetingInviteRow[];
  }

  async getInviteByTokenHash(hash: string) {
    const rows = await this.sql`select * from meeting_invites where guest_token_hash = ${hash}`;
    return (rows[0] as MeetingInviteRow | undefined) ?? null;
  }

  async markInviteUsed(id: string, at: Date) {
    await this.sql`update meeting_invites set used_at = ${at} where id = ${id} and used_at is null`;
  }

  async isInvited(meetingId: string, userId: string) {
    const rows = await this.sql`select 1 from meeting_invites where meeting_id = ${meetingId} and user_id = ${userId} limit 1`;
    return rows.length > 0;
  }

  async addEvent(e: NewMeetingEvent) {
    return event(first<Row>(await this.sql`insert into meeting_events ${this.sql(defined(e))} returning *`));
  }

  async listEvents(meetingId: string) {
    return ((await this.sql`select * from meeting_events where meeting_id = ${meetingId} order by id`) as unknown as Row[]).map(event);
  }
}
