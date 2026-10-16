// Réunions MIMT (video meetings on LiveKit). Contract: packages/shared/src/meetings.ts. Docs: docs/MIMT-VIDEO.md.
//
// Access: the host, members of the meeting's business, and users invited by user id can see and join a
// meeting. Only the host or an owner/admin of that business manages it (edit, invite, admit, end).
// Guests join with a link token bound to one meeting (only its SHA-256 is stored), may wait in a lobby,
// and are rate-limited. Without LIVEKIT_* every route answers 503 not_configured.

import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  MEETING_DISPLAY_NAME_MAX,
  MEETING_GUEST_IDENTITY_PREFIX,
  MEETING_GUEST_LINK_TTL_S,
  MEETING_MAX_DURATION_S,
  MEETING_MAX_INVITES_PER_REQUEST,
  MEETING_PARTICIPANT_CAPS,
  MEETING_TITLE_MAX,
  MEETING_TOKEN_TTL_S,
  participantCap,
  type CreateMeetingInvitesResponse,
  type GuestMeetingInfoResponse,
  type Meeting,
  type MeetingDetailResponse,
  type MeetingInviteDto,
  type MeetingParticipantMetadata,
  type MeetingRole,
  type MeetingsResponse,
  type MeetingTokenResponse,
} from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser, type UserContext } from "../auth/guard.js";
import { badRequest, conflict, forbidden, HttpError, notConfigured, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { isAdmin } from "../pbx/access.js";
import type { MeetingInviteRow, MeetingRow } from "../repo/meetings.js";
import { getFeatures } from "../services/accounts.js";
import { VideoParticipantNotFoundError, type VideoGateway } from "../video/gateway.js";

/** LiveKit closes a room this long after the last participant leaves. */
const EMPTY_ROOM_TIMEOUT_S = 5 * 60;
const GUEST_RATE = { capacity: 10, windowSeconds: 60 };

const DateTime = z.iso.datetime({ offset: true }).nullable().optional();
const Title = z.string().trim().min(1).max(MEETING_TITLE_MAX);
const CreateBody = z.object({ title: Title, businessId: z.uuid().optional(), scheduledStart: DateTime, scheduledEnd: DateTime, lobbyEnabled: z.boolean().optional() });
const UpdateBody = z.object({ title: Title.optional(), scheduledStart: DateTime, scheduledEnd: DateTime, lobbyEnabled: z.boolean().optional() });
const InvitesBody = z.object({ emails: z.array(z.email().max(254)).max(MEETING_MAX_INVITES_PER_REQUEST).optional() });
const GuestToken = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/, "invalid guest token");
const GuestJoinBody = z.object({ guestToken: GuestToken, displayName: z.string().trim().min(1).max(MEETING_DISPLAY_NAME_MAX) });
const GuestInfoBody = z.object({ guestToken: GuestToken });
const AdmitBody = z.object({ identity: z.string().startsWith(MEETING_GUEST_IDENTITY_PREFIX).max(128) });

export const hashGuestToken = (token: string) => createHash("sha256").update(token).digest("hex");
const newRoomName = () => `mimt-${randomBytes(16).toString("hex")}`;
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const metadata = (m: MeetingParticipantMetadata) => JSON.stringify(m);
/** Control characters out of names shown to other participants. */
const cleanName = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MEETING_DISPLAY_NAME_MAX);

function video(deps: AppDeps): VideoGateway {
  if (!deps.video) throw notConfigured("Video meetings");
  return deps.video;
}

interface MeetingPlan {
  allowed: boolean;
  cap: number;
}

/** Plan of the account behind the meeting: the business account, or the host's own account. */
async function meetingPlan(deps: AppDeps, m: Pick<MeetingRow, "businessId" | "hostUserId">): Promise<MeetingPlan> {
  const accountId = m.businessId ? (await deps.repo.pbx.getBusiness(m.businessId))?.telecomAccountId : (await deps.repo.getAccountByOwner(m.hostUserId))?.id;
  if (!accountId) return { allowed: false, cap: 0 };
  const { plan, features } = await getFeatures(deps.repo, accountId);
  const allowed = features.has("video_meetings");
  return { allowed, cap: allowed ? (participantCap(plan) ?? MEETING_PARTICIPANT_CAPS.premium!) : 0 };
}

function meetingDto(deps: AppDeps, m: MeetingRow, canManage: boolean, cap: number): Meeting {
  return {
    id: m.id,
    businessId: m.businessId,
    hostUserId: m.hostUserId,
    title: m.title,
    status: m.status,
    lobbyEnabled: m.lobbyEnabled,
    scheduledStart: iso(m.scheduledStart),
    scheduledEnd: iso(m.scheduledEnd),
    startedAt: iso(m.startedAt),
    endedAt: iso(m.endedAt),
    createdAt: m.createdAt.toISOString(),
    joinUrl: `${deps.config.APP_BASE_URL.replace(/\/$/, "")}/reunions/${m.id}`,
    canManage,
    maxParticipants: cap,
  };
}

const inviteDto = (i: MeetingInviteRow): MeetingInviteDto => ({
  id: i.id,
  email: i.email,
  role: i.role,
  expiresAt: i.expiresAt.toISOString(),
  usedAt: iso(i.usedAt),
  createdAt: i.createdAt.toISOString(),
});

interface MeetingAccess extends UserContext {
  meeting: MeetingRow;
  canManage: boolean;
}

/** Not allowed to see it → 404 (no existence leak). */
async function meetingAccess(deps: AppDeps, req: FastifyRequest): Promise<MeetingAccess> {
  const id = z.object({ id: z.uuid() }).safeParse(req.params);
  if (!id.success) throw notFound();
  const ctx = await loadContext(deps, req);
  const meeting = await deps.repo.meetings.get(id.data.id);
  if (!meeting) throw notFound();
  const isHost = meeting.hostUserId === ctx.user.id;
  const member = meeting.businessId ? await deps.repo.pbx.getMembership(meeting.businessId, ctx.user.id) : null;
  if (!isHost && !member && !(await deps.repo.meetings.isInvited(meeting.id, ctx.user.id))) throw notFound();
  return { ...ctx, meeting, canManage: isHost || (member !== null && isAdmin(member)) };
}

function requireManage(a: MeetingAccess) {
  if (!a.canManage) throw forbidden("meeting_host_required", "Only the host or a business admin can do this");
}

function checkSchedule(start: Date | null, end: Date | null) {
  if (start && end && end <= start) throw badRequest("invalid_schedule", "scheduledEnd must be after scheduledStart");
}

const toDate = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(v));

/** Ends the meeting everywhere: SFU room closed, status ended, one "ended" event. */
async function endMeeting(deps: AppDeps, m: MeetingRow, userId: string | null): Promise<MeetingRow> {
  if (deps.video) await deps.video.deleteRoom(m.roomName);
  if (m.status === "ended") return m;
  const after = await deps.repo.meetings.update(m.id, { status: "ended", endedAt: deps.now() });
  await deps.repo.meetings.addEvent({ meetingId: m.id, type: "ended", userId, at: deps.now() });
  return after;
}

/** Ended, or past the 4-hour limit (then ended now). */
async function assertJoinable(deps: AppDeps, m: MeetingRow): Promise<void> {
  if (m.status === "ended") throw conflict("meeting_ended", "This meeting has ended");
  if (m.startedAt && deps.now().getTime() - m.startedAt.getTime() >= MEETING_MAX_DURATION_S * 1000) {
    await endMeeting(deps, m, null);
    throw conflict("meeting_ended", "This meeting reached its maximum duration");
  }
}

/** Remaining token lifetime: 1 h, or less when the meeting is close to its 4-hour limit. */
function tokenTtlS(deps: AppDeps, m: MeetingRow): number {
  if (!m.startedAt) return MEETING_TOKEN_TTL_S;
  const left = Math.floor((m.startedAt.getTime() + MEETING_MAX_DURATION_S * 1000 - deps.now().getTime()) / 1000);
  return Math.max(60, Math.min(MEETING_TOKEN_TTL_S, left));
}

async function assertCapacity(v: VideoGateway, m: MeetingRow, cap: number, identity: string) {
  let present;
  try {
    present = await v.listParticipants(m.roomName);
  } catch {
    throw new HttpError(502, "video_unavailable", "The video service did not answer; try again");
  }
  if (present.filter((p) => p.identity !== identity).length >= cap) throw conflict("meeting_full", `This meeting is full (${cap} participants)`);
}

async function markLive(deps: AppDeps, m: MeetingRow, userId: string | null): Promise<MeetingRow> {
  if (m.status !== "scheduled") return m;
  const after = await deps.repo.meetings.update(m.id, { status: "live", startedAt: m.startedAt ?? deps.now() });
  await deps.repo.meetings.addEvent({ meetingId: m.id, type: "started", userId, at: deps.now() });
  return after;
}

async function issueToken(
  deps: AppDeps,
  m: MeetingRow,
  cap: number,
  p: { identity: string; name: string; role: MeetingRole; waiting: boolean; admin: boolean },
): Promise<MeetingTokenResponse> {
  const v = video(deps);
  const ttlS = tokenTtlS(deps, m);
  await v.ensureRoom(m.roomName, { maxParticipants: cap, emptyTimeoutS: EMPTY_ROOM_TIMEOUT_S });
  const token = await v.createToken({
    room: m.roomName,
    identity: p.identity,
    name: p.name,
    ttlS,
    metadata: metadata({ role: p.role, waiting: p.waiting }),
    canPublish: !p.waiting,
    canSubscribe: !p.waiting,
    canPublishData: !p.waiting,
    roomAdmin: p.admin,
  });
  return {
    url: v.url,
    token,
    identity: p.identity,
    expiresAt: new Date(deps.now().getTime() + ttlS * 1000).toISOString(),
    role: p.role,
    canPublish: !p.waiting,
    waiting: p.waiting,
    meeting: { id: m.id, title: m.title, status: m.status, lobbyEnabled: m.lobbyEnabled, maxParticipants: cap },
  };
}

/** French first, then English. The link is a capability for one meeting: do not log it. */
export function renderMeetingInviteEmail(input: { title: string; hostName: string | null; link: string; scheduledStart: Date | null; expiresAt: Date }) {
  const host = input.hostName ?? "Un utilisateur MIMT";
  const hostEn = input.hostName ?? "A MIMT user";
  const when = input.scheduledStart?.toLocaleString("fr-CA", { timeZone: "America/Toronto", dateStyle: "long", timeStyle: "short" });
  const whenEn = input.scheduledStart?.toLocaleString("en-CA", { timeZone: "America/Toronto", dateStyle: "long", timeStyle: "short" });
  const expires = input.expiresAt.toLocaleDateString("fr-CA", { timeZone: "America/Toronto" });
  const fr = [
    `${host} vous invite à la réunion vidéo « ${input.title} ».`,
    ...(when ? [`Date : ${when} (heure de l'Est)`] : []),
    "",
    `Rejoindre dans votre navigateur (aucune installation; lien valide jusqu'au ${expires}) :`,
    input.link,
    "",
    "Ce lien donne accès à la réunion : ne le transférez pas. Aucune réunion n'est enregistrée.",
  ];
  const en = [
    `${hostEn} invites you to the video meeting "${input.title}".`,
    ...(whenEn ? [`When: ${whenEn} (Eastern time)`] : []),
    "Join in your browser with the link above (nothing to install). Do not forward it: it gives access to the meeting. Meetings are not recorded.",
  ];
  return {
    subject: `Invitation : ${input.title} · Réunions MIMT / MIMT Meetings`,
    text: [...fr, "", "—", "", ...en].join("\n"),
  };
}

export async function meetingRoutes(app: FastifyInstance, deps: AppDeps) {
  const auth = { preHandler: requireUser(deps) };
  const { repo } = deps;

  app.post("/v1/meetings", auth, async (req, reply) => {
    video(deps);
    const body = parse(CreateBody, req.body);
    const ctx = await loadContext(deps, req);
    if (body.businessId) {
      const business = await repo.pbx.getBusiness(body.businessId);
      const member = business ? await repo.pbx.getMembership(business.id, ctx.user.id) : null;
      if (!business || !member) throw notFound();
      if (!isAdmin(member)) throw forbidden("business_role_required", "Requires the admin role");
    }
    const draft = { businessId: body.businessId ?? null, hostUserId: ctx.user.id };
    const plan = await meetingPlan(deps, draft);
    if (!plan.allowed) throw forbidden("plan_required", "Video meetings need Premium, Affaires or Affaires Pro");
    const scheduledStart = toDate(body.scheduledStart) ?? null;
    const scheduledEnd = toDate(body.scheduledEnd) ?? null;
    checkSchedule(scheduledStart, scheduledEnd);
    const m = await repo.meetings.create({ ...draft, title: body.title, roomName: newRoomName(), scheduledStart, scheduledEnd, lobbyEnabled: body.lobbyEnabled ?? true });
    await repo.audit({ actorUserId: ctx.user.id, action: "meeting.created", targetType: "meeting", targetId: m.id, ip: req.ip });
    return reply.code(201).send(meetingDto(deps, m, true, plan.cap));
  });

  app.get("/v1/meetings", auth, async (req): Promise<MeetingsResponse> => {
    video(deps);
    const ctx = await loadContext(deps, req);
    const memberships = await repo.pbx.listBusinessesForUser(ctx.user.id);
    const list = await repo.meetings.listForUser(ctx.user.id, memberships.map((b) => b.business.id));
    const plans = new Map<string, MeetingPlan>();
    const out: Meeting[] = [];
    for (const m of list) {
      const key = m.businessId ?? `user:${m.hostUserId}`;
      if (!plans.has(key)) plans.set(key, await meetingPlan(deps, m));
      const admin = memberships.some((b) => b.business.id === m.businessId && isAdmin(b.member));
      out.push(meetingDto(deps, m, m.hostUserId === ctx.user.id || admin, plans.get(key)!.cap));
    }
    return { meetings: out };
  });

  app.get("/v1/meetings/:id", auth, async (req): Promise<MeetingDetailResponse> => {
    video(deps);
    const a = await meetingAccess(deps, req);
    const plan = await meetingPlan(deps, a.meeting);
    const invites = a.canManage ? (await repo.meetings.listInvites(a.meeting.id)).map(inviteDto) : [];
    return { meeting: meetingDto(deps, a.meeting, a.canManage, plan.cap), invites };
  });

  app.patch("/v1/meetings/:id", auth, async (req): Promise<Meeting> => {
    video(deps);
    const a = await meetingAccess(deps, req);
    requireManage(a);
    const body = parse(UpdateBody, req.body);
    if (a.meeting.status === "ended") throw conflict("meeting_ended", "This meeting has ended");
    const scheduledStart = toDate(body.scheduledStart);
    const scheduledEnd = toDate(body.scheduledEnd);
    checkSchedule(scheduledStart === undefined ? a.meeting.scheduledStart : scheduledStart, scheduledEnd === undefined ? a.meeting.scheduledEnd : scheduledEnd);
    const m = await repo.meetings.update(a.meeting.id, { title: body.title, scheduledStart, scheduledEnd, lobbyEnabled: body.lobbyEnabled });
    return meetingDto(deps, m, true, (await meetingPlan(deps, m)).cap);
  });

  app.post("/v1/meetings/:id/invites", auth, async (req, reply) => {
    video(deps);
    const a = await meetingAccess(deps, req);
    requireManage(a);
    const body = parse(InvitesBody, req.body ?? {});
    if (a.meeting.status === "ended") throw conflict("meeting_ended", "This meeting has ended");
    const emails = [...new Set((body.emails ?? []).map((e) => e.trim().toLowerCase()))];
    const base = deps.config.APP_BASE_URL.replace(/\/$/, "");
    const expiresAt = new Date(deps.now().getTime() + MEETING_GUEST_LINK_TTL_S * 1000);
    const out: CreateMeetingInvitesResponse["invites"] = [];
    let emailed = 0;
    for (const email of emails.length ? emails : [null]) {
      const token = randomBytes(32).toString("base64url");
      const invite = await repo.meetings.createInvite({ meetingId: a.meeting.id, email, userId: null, role: "guest", guestTokenHash: hashGuestToken(token), expiresAt });
      const link = `${base}/reunion/${token}`;
      let sent = false;
      if (email && deps.email) {
        try {
          const msg = renderMeetingInviteEmail({ title: a.meeting.title, hostName: a.user.displayName, link, scheduledStart: a.meeting.scheduledStart, expiresAt });
          await deps.email.send({ to: email, ...msg });
          sent = true;
          emailed++;
        } catch {
          // No provider (or it failed): the host copies the link instead.
        }
      }
      out.push({ ...inviteDto(invite), link, emailed: sent });
    }
    req.log.info({ meetingId: a.meeting.id, invites: out.length, emailed }, "meeting invites created");
    await repo.audit({ actorUserId: a.user.id, action: "meeting.invited", targetType: "meeting", targetId: a.meeting.id, ip: req.ip, meta: { count: out.length, emailed } });
    return reply.code(201).send({ invites: out } satisfies CreateMeetingInvitesResponse);
  });

  app.post("/v1/meetings/:id/token", auth, async (req): Promise<MeetingTokenResponse> => {
    const v = video(deps);
    const a = await meetingAccess(deps, req);
    await assertJoinable(deps, a.meeting);
    const plan = await meetingPlan(deps, a.meeting);
    if (!plan.allowed) throw forbidden("plan_required", "Video meetings need Premium, Affaires or Affaires Pro");
    const identity = a.user.id;
    await assertCapacity(v, a.meeting, plan.cap, identity);
    const m = await markLive(deps, a.meeting, a.user.id);
    return issueToken(deps, m, plan.cap, {
      identity,
      name: cleanName(a.user.displayName ?? "") || "Participant",
      role: a.canManage ? "host" : "participant",
      waiting: false,
      admin: a.canManage,
    });
  });

  /** Guest link check before joining (title for the join page). Rate-limited like the join. */
  app.post("/v1/meetings/join/guest/info", async (req): Promise<GuestMeetingInfoResponse> => {
    video(deps);
    const { meeting } = await guestInvite(deps, req, parse(GuestInfoBody, req.body).guestToken);
    const host = await repo.getUser(meeting.hostUserId);
    return { title: meeting.title, hostName: host?.displayName ?? null, status: meeting.status, lobbyEnabled: meeting.lobbyEnabled, scheduledStart: iso(meeting.scheduledStart) };
  });

  app.post("/v1/meetings/join/guest", async (req): Promise<MeetingTokenResponse> => {
    const v = video(deps);
    const body = parse(GuestJoinBody, req.body);
    const name = cleanName(body.displayName);
    if (!name) throw badRequest("invalid_request", "displayName is required");
    const { invite, meeting } = await guestInvite(deps, req, body.guestToken);
    await assertJoinable(deps, meeting);
    const plan = await meetingPlan(deps, meeting);
    if (!plan.allowed) throw forbidden("meeting_unavailable", "This meeting is not available");
    const identity = `${MEETING_GUEST_IDENTITY_PREFIX}${invite.id.slice(0, 8)}-${randomBytes(4).toString("hex")}`;
    await assertCapacity(v, meeting, plan.cap, identity);
    await repo.meetings.markInviteUsed(invite.id, deps.now());
    return issueToken(deps, meeting, plan.cap, { identity, name, role: "guest", waiting: meeting.lobbyEnabled, admin: false });
  });

  app.post("/v1/meetings/:id/admit", auth, async (req) => {
    const v = video(deps);
    const a = await meetingAccess(deps, req);
    requireManage(a);
    const { identity } = parse(AdmitBody, req.body);
    if (a.meeting.status === "ended") throw conflict("meeting_ended", "This meeting has ended");
    try {
      await v.updateParticipant(a.meeting.roomName, identity, {
        metadata: metadata({ role: "guest", waiting: false }),
        permission: { canPublish: true, canSubscribe: true, canPublishData: true },
      });
    } catch (e) {
      if (e instanceof VideoParticipantNotFoundError) throw notFound("participant_not_found", "This guest is no longer in the meeting");
      throw new HttpError(502, "video_unavailable", "The video service did not answer; try again");
    }
    await repo.meetings.addEvent({ meetingId: a.meeting.id, type: "admitted", identity, userId: a.user.id, at: deps.now() });
    return { admitted: identity };
  });

  app.post("/v1/meetings/:id/end", auth, async (req): Promise<Meeting> => {
    video(deps);
    const a = await meetingAccess(deps, req);
    requireManage(a);
    const m = await endMeeting(deps, a.meeting, a.user.id);
    await repo.audit({ actorUserId: a.user.id, action: "meeting.ended", targetType: "meeting", targetId: m.id, ip: req.ip });
    return meetingDto(deps, m, true, (await meetingPlan(deps, m)).cap);
  });

  // --------------------------------------------------------------------------- LiveKit webhook

  // Own scope: the body is kept raw; LiveKit signs its SHA-256 in the Authorization JWT.
  await app.register(async (scope) => {
    scope.removeContentTypeParser("application/json");
    const raw = (_req: unknown, body: string, done: (err: Error | null, body?: unknown) => void) => done(null, body);
    scope.addContentTypeParser("application/json", { parseAs: "string" }, raw);
    scope.addContentTypeParser("application/webhook+json", { parseAs: "string" }, raw);

    scope.post("/webhooks/livekit", async (req, reply) => {
      if (!deps.video) return reply.code(503).send({ error: "not_configured", message: "Video meetings are not configured on this server" });
      const body = typeof req.body === "string" ? req.body : "";
      let ev;
      try {
        ev = await deps.video.receiveWebhook(body, req.headers.authorization);
      } catch {
        req.log.warn({ path: "/webhooks/livekit" }, "rejected LiveKit webhook with bad signature");
        return reply.code(401).send({ error: "invalid_signature", message: "Invalid LiveKit signature" });
      }
      const m = ev.room ? await repo.meetings.getByRoomName(ev.room) : null;
      if (!m) return reply.code(200).send({ ignored: true });
      const now = deps.now();
      const userId = ev.identity && !ev.identity.startsWith(MEETING_GUEST_IDENTITY_PREFIX) && z.uuid().safeParse(ev.identity).success ? ev.identity : null;
      switch (ev.event) {
        case "room_started":
          if (m.status !== "ended") await markLive(deps, m, null);
          break;
        case "room_finished":
          if (m.status !== "ended") {
            await repo.meetings.update(m.id, { status: "ended", endedAt: now });
            await repo.meetings.addEvent({ meetingId: m.id, type: "ended", at: now });
          }
          break;
        case "participant_joined": {
          const live = m.status === "scheduled" ? await markLive(deps, m, null) : m;
          await repo.meetings.addEvent({ meetingId: m.id, type: "joined", identity: ev.identity, userId, at: now });
          if (live.startedAt && now.getTime() - live.startedAt.getTime() >= MEETING_MAX_DURATION_S * 1000) await endMeeting(deps, live, null);
          break;
        }
        case "participant_left":
        case "participant_connection_aborted":
          await repo.meetings.addEvent({ meetingId: m.id, type: "left", identity: ev.identity, userId, at: now });
          break;
        default:
          break;
      }
      return reply.code(200).send({ ok: true });
    });
  });
}

/** Looks up a guest link: rate-limited per IP, bound to its one meeting, 410 once expired. */
async function guestInvite(deps: AppDeps, req: FastifyRequest, token: string): Promise<{ invite: MeetingInviteRow; meeting: MeetingRow }> {
  if (!(await deps.rateLimiter.take(`meeting-guest:${req.ip}`, GUEST_RATE))) throw new HttpError(429, "rate_limited", "Too many attempts; wait a minute");
  const invite = await deps.repo.meetings.getInviteByTokenHash(hashGuestToken(token));
  if (!invite || invite.role !== "guest") throw notFound("invalid_guest_token", "This invitation link is not valid");
  if (invite.expiresAt.getTime() <= deps.now().getTime()) throw new HttpError(410, "invite_expired", "This invitation link has expired");
  const meeting = await deps.repo.meetings.get(invite.meetingId);
  if (!meeting) throw notFound("invalid_guest_token", "This invitation link is not valid");
  return { invite, meeting };
}
