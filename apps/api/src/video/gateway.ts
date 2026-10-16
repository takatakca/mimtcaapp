// Video SFU behind a small interface so tests use a fake (test/meetings.test.ts) and the SFU can change.
// Production: LiveKit (livekit-server-sdk), self-hosted on Coolify or LiveKit Cloud (docs/MIMT-VIDEO.md).
// The API secret signs tokens and verifies webhooks here only; it is never returned nor logged.

import { AccessToken, RoomServiceClient, WebhookReceiver, type VideoGrant } from "livekit-server-sdk";
import type { Config } from "../config.js";

export interface VideoTokenRequest {
  room: string;
  identity: string;
  name: string;
  ttlS: number;
  /** JSON (MeetingParticipantMetadata). */
  metadata: string;
  canPublish: boolean;
  canSubscribe: boolean;
  canPublishData: boolean;
  /** Host: can mute/remove others through the SFU. */
  roomAdmin: boolean;
}

export interface VideoParticipant {
  identity: string;
  name: string;
  metadata: string;
}

export interface VideoPermissions {
  canPublish: boolean;
  canSubscribe: boolean;
  canPublishData: boolean;
}

export interface VideoWebhookEvent {
  event: string;
  room: string | null;
  identity: string | null;
  /** Seconds since epoch reported by the SFU (0 when absent). */
  createdAt: number;
}

export class VideoParticipantNotFoundError extends Error {
  constructor() {
    super("participant not found");
    this.name = "VideoParticipantNotFoundError";
  }
}

export interface VideoGateway {
  /** wss:// URL clients connect to. */
  readonly url: string;
  createToken(req: VideoTokenRequest): Promise<string>;
  /** Creates the room if needed with a server-side participant cap and empty timeout. */
  ensureRoom(room: string, opts: { maxParticipants: number; emptyTimeoutS: number }): Promise<void>;
  /** Empty when the room does not exist (nobody joined yet). */
  listParticipants(room: string): Promise<VideoParticipant[]>;
  /** Throws VideoParticipantNotFoundError when the identity is not in the room. */
  updateParticipant(room: string, identity: string, update: { metadata: string; permission: VideoPermissions }): Promise<void>;
  /** Disconnects everyone. No error when the room does not exist. */
  deleteRoom(room: string): Promise<void>;
  /** Verifies the Authorization header (JWT signed with the API secret + body SHA-256). Throws when invalid. */
  receiveWebhook(body: string, authorization: string | undefined): Promise<VideoWebhookEvent>;
}

export const videoConfigured = (c: Config) => Boolean(c.LIVEKIT_URL && c.LIVEKIT_API_KEY && c.LIVEKIT_API_SECRET);

const isNotFound = (e: unknown) => {
  const err = e as { status?: number; code?: string; message?: string } | null;
  return err?.status === 404 || err?.code === "not_found" || /not.?found|does not exist/i.test(err?.message ?? "");
};

/** LiveKit server API (REST/Twirp) + token signing + webhook verification. */
export class LiveKitVideoGateway implements VideoGateway {
  private readonly rooms: RoomServiceClient;
  private readonly receiver: WebhookReceiver;

  constructor(
    readonly url: string,
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {
    // The server API is HTTPS on the same host as the wss:// signaling URL.
    this.rooms = new RoomServiceClient(url.replace(/^ws(s?):\/\//, "http$1://"), apiKey, apiSecret);
    this.receiver = new WebhookReceiver(apiKey, apiSecret);
  }

  async createToken(req: VideoTokenRequest) {
    const at = new AccessToken(this.apiKey, this.apiSecret, { identity: req.identity, name: req.name, ttl: req.ttlS, metadata: req.metadata });
    const grant: VideoGrant = {
      room: req.room,
      roomJoin: true,
      roomCreate: false,
      roomList: false,
      roomRecord: false,
      roomAdmin: req.roomAdmin,
      canPublish: req.canPublish,
      canSubscribe: req.canSubscribe,
      canPublishData: req.canPublishData,
      canUpdateOwnMetadata: false,
    };
    at.addGrant(grant);
    return at.toJwt();
  }

  async ensureRoom(room: string, opts: { maxParticipants: number; emptyTimeoutS: number }) {
    await this.rooms.createRoom({ name: room, maxParticipants: opts.maxParticipants, emptyTimeout: opts.emptyTimeoutS });
  }

  async listParticipants(room: string) {
    try {
      const list = await this.rooms.listParticipants(room);
      return list.map((p) => ({ identity: p.identity, name: p.name, metadata: p.metadata }));
    } catch (e) {
      if (isNotFound(e)) return [];
      throw e;
    }
  }

  async updateParticipant(room: string, identity: string, update: { metadata: string; permission: VideoPermissions }) {
    try {
      await this.rooms.updateParticipant(room, identity, { metadata: update.metadata, permission: update.permission });
    } catch (e) {
      if (isNotFound(e)) throw new VideoParticipantNotFoundError();
      throw e;
    }
  }

  async deleteRoom(room: string) {
    try {
      await this.rooms.deleteRoom(room);
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
  }

  async receiveWebhook(body: string, authorization: string | undefined) {
    if (!authorization) throw new Error("missing authorization");
    const ev = await this.receiver.receive(body, authorization);
    return {
      event: ev.event,
      room: ev.room?.name || null,
      identity: ev.participant?.identity || null,
      createdAt: Number(ev.createdAt ?? 0),
    };
  }
}

export function createVideoGateway(config: Config): VideoGateway | null {
  if (!videoConfigured(config)) return null;
  return new LiveKitVideoGateway(config.LIVEKIT_URL!, config.LIVEKIT_API_KEY!, config.LIVEKIT_API_SECRET!);
}
