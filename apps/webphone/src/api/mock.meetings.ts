// Demo fixtures for Réunions MIMT (VITE_MOCK_API=1). Same routes and rules as apps/api routes/meetings.ts,
// without LiveKit: tokens point to a demo URL and the room page shows a "mode démo" placeholder.
import {
  MEETING_GUEST_LINK_TTL_S,
  MEETING_PARTICIPANT_CAPS,
  type CreateMeetingInvitesRequest,
  type CreateMeetingRequest,
  type CreatedMeetingInvite,
  type GuestJoinRequest,
  type Meeting,
  type MeetingInviteDto,
  type MeetingTokenResponse,
  type UpdateMeetingRequest,
} from "@mimt/shared";

/** Token the room page recognizes: never connects. */
export const DEMO_MEETING_URL = "wss://demo.mimt.invalid";
/** Guest link that works in demo mode: app.mimt.ca/reunion/<this>. */
export const DEMO_GUEST_TOKEN = "demo-invitation-reunion-mimt-0001";

type Handler = (ctx: { params: string[]; query: URLSearchParams; body: unknown; method: string }) => Response;
export type MockRoute = [method: string, pattern: RegExp, handler: Handler, auth?: boolean];

export interface MockHelpers {
  ok: (body: unknown) => Response;
  created: (body: unknown) => Response;
  fail: (status: number, error: string, message?: string) => Response;
  nextId: (prefix: string) => string;
  userId: string;
  displayName: () => string;
  businessId: string;
}

interface State {
  meetings: Meeting[];
  invites: Record<string, MeetingInviteDto[]>;
  /** guest token → meeting id */
  links: Record<string, string>;
}

const APP = "https://app.mimt.ca";
const iso = (d: Date) => d.toISOString();
const at = (days: number, h: number, min = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(h, min, 0, 0);
  return d;
};

function initial(userId: string, businessId: string): State {
  const mk = (p: Partial<Meeting> & Pick<Meeting, "id" | "title">): Meeting => ({
    businessId,
    hostUserId: userId,
    status: "scheduled",
    lobbyEnabled: true,
    scheduledStart: null,
    scheduledEnd: null,
    startedAt: null,
    endedAt: null,
    createdAt: iso(at(-3, 9)),
    joinUrl: `${APP}/reunions/${p.id}`,
    canManage: true,
    maxParticipants: MEETING_PARTICIPANT_CAPS.business!,
    ...p,
  });
  const meetings = [
    mk({ id: "meet-live", title: "Point quotidien de l'équipe", status: "live", startedAt: iso(new Date(Date.now() - 12 * 60_000)), lobbyEnabled: false }),
    mk({ id: "meet-next", title: "Rencontre fournisseur — Torréfaction Saint-Henri", scheduledStart: iso(at(1, 10)), scheduledEnd: iso(at(1, 11)) }),
    mk({ id: "meet-client", title: "Présentation au client Boulangerie Ste-Rose", scheduledStart: iso(at(3, 14, 30)), scheduledEnd: iso(at(3, 15, 30)) }),
    mk({ id: "meet-past", title: "Bilan de septembre", status: "ended", scheduledStart: iso(at(-2, 15)), startedAt: iso(at(-2, 15, 2)), endedAt: iso(at(-2, 15, 48)) }),
  ];
  return {
    meetings,
    invites: {
      "meet-next": [{ id: "inv-1", email: "ventes@torrefaction.example", role: "guest", expiresAt: iso(at(6, 10)), usedAt: null, createdAt: iso(at(-1, 9)) }],
    },
    links: { [DEMO_GUEST_TOKEN]: "meet-next" },
  };
}

let state: State | null = null;

export function resetMeetingsMock(): void {
  state = null;
}

export function meetingMockRoutes(h: MockHelpers): MockRoute[] {
  const s = () => (state ??= initial(h.userId, h.businessId));
  const find = (id: string | undefined) => s().meetings.find((m) => m.id === id);
  const token = (m: Meeting, identity: string, role: MeetingTokenResponse["role"], waiting: boolean): MeetingTokenResponse => {
    if (m.status === "scheduled") Object.assign(m, { status: "live", startedAt: iso(new Date()) });
    return {
      url: DEMO_MEETING_URL,
      token: "demo",
      identity,
      expiresAt: iso(new Date(Date.now() + 3600_000)),
      role,
      canPublish: !waiting,
      waiting,
      meeting: { id: m.id, title: m.title, status: m.status, lobbyEnabled: m.lobbyEnabled, maxParticipants: m.maxParticipants },
    };
  };
  const guest = (body: unknown) => {
    const t = (body as { guestToken?: string } | undefined)?.guestToken ?? "";
    const m = find(s().links[t]);
    return m ?? null;
  };

  return [
    ["GET", /^\/v1\/meetings$/, () => h.ok({ meetings: s().meetings })],
    ["POST", /^\/v1\/meetings$/, ({ body }) => {
      const b = (body ?? {}) as CreateMeetingRequest;
      const title = (b.title ?? "").trim();
      if (!title) return h.fail(400, "invalid_request", "title");
      if (b.scheduledStart && b.scheduledEnd && b.scheduledEnd <= b.scheduledStart) return h.fail(400, "invalid_schedule");
      const id = h.nextId("meet");
      const m: Meeting = {
        id,
        businessId: b.businessId ?? null,
        hostUserId: h.userId,
        title,
        status: "scheduled",
        lobbyEnabled: b.lobbyEnabled ?? true,
        scheduledStart: b.scheduledStart ?? null,
        scheduledEnd: b.scheduledEnd ?? null,
        startedAt: null,
        endedAt: null,
        createdAt: iso(new Date()),
        joinUrl: `${APP}/reunions/${id}`,
        canManage: true,
        maxParticipants: MEETING_PARTICIPANT_CAPS.business!,
      };
      s().meetings.unshift(m);
      return h.created(m);
    }],
    ["POST", /^\/v1\/meetings\/join\/guest\/info$/, ({ body }) => {
      const m = guest(body);
      if (!m) return h.fail(404, "invalid_guest_token");
      return h.ok({ title: m.title, hostName: h.displayName(), status: m.status, lobbyEnabled: m.lobbyEnabled, scheduledStart: m.scheduledStart });
    }, false],
    ["POST", /^\/v1\/meetings\/join\/guest$/, ({ body }) => {
      const m = guest(body);
      if (!m) return h.fail(404, "invalid_guest_token");
      if (m.status === "ended") return h.fail(409, "meeting_ended");
      const name = ((body as GuestJoinRequest).displayName ?? "").trim();
      if (!name) return h.fail(400, "invalid_request", "displayName");
      return h.ok(token(m, h.nextId("guest"), "guest", m.lobbyEnabled));
    }, false],
    ["GET", /^\/v1\/meetings\/([^/]+)$/, ({ params }) => {
      const m = find(params[0]);
      return m ? h.ok({ meeting: m, invites: s().invites[m.id] ?? [] }) : h.fail(404, "not_found");
    }],
    ["PATCH", /^\/v1\/meetings\/([^/]+)$/, ({ params, body }) => {
      const m = find(params[0]);
      if (!m) return h.fail(404, "not_found");
      if (m.status === "ended") return h.fail(409, "meeting_ended");
      const b = (body ?? {}) as UpdateMeetingRequest;
      Object.assign(m, Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)));
      return h.ok(m);
    }],
    ["POST", /^\/v1\/meetings\/([^/]+)\/invites$/, ({ params, body }) => {
      const m = find(params[0]);
      if (!m) return h.fail(404, "not_found");
      if (m.status === "ended") return h.fail(409, "meeting_ended");
      const emails = [...new Set(((body ?? {}) as CreateMeetingInvitesRequest).emails?.map((e) => e.trim().toLowerCase()) ?? [])];
      const now = new Date();
      const out: CreatedMeetingInvite[] = (emails.length ? emails : [null]).map((email) => {
        const tok = `demo-${h.nextId("lien")}-${Math.random().toString(36).slice(2, 12)}`;
        s().links[tok] = m.id;
        // Demo: no email provider, like a server without EMAIL_PROVIDER.
        return { id: h.nextId("inv"), email, role: "guest", expiresAt: iso(new Date(now.getTime() + MEETING_GUEST_LINK_TTL_S * 1000)), usedAt: null, createdAt: iso(now), link: `${APP}/reunion/${tok}`, emailed: false };
      });
      s().invites[m.id] = [...(s().invites[m.id] ?? []), ...out.map(({ link: _l, emailed: _e, ...dto }) => dto)];
      return h.created({ invites: out });
    }],
    ["POST", /^\/v1\/meetings\/([^/]+)\/token$/, ({ params }) => {
      const m = find(params[0]);
      if (!m) return h.fail(404, "not_found");
      if (m.status === "ended") return h.fail(409, "meeting_ended");
      return h.ok(token(m, h.userId, m.canManage ? "host" : "participant", false));
    }],
    ["POST", /^\/v1\/meetings\/([^/]+)\/admit$/, ({ params, body }) => {
      const m = find(params[0]);
      if (!m) return h.fail(404, "not_found");
      return h.ok({ admitted: (body as { identity?: string }).identity ?? "" });
    }],
    ["POST", /^\/v1\/meetings\/([^/]+)\/end$/, ({ params }) => {
      const m = find(params[0]);
      if (!m) return h.fail(404, "not_found");
      if (m.status !== "ended") Object.assign(m, { status: "ended", endedAt: iso(new Date()) });
      return h.ok(m);
    }],
  ];
}
