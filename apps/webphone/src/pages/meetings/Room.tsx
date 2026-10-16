// The live meeting (LiveKit). Lazy-loaded: livekit-client and its components stay out of the main bundle.
// Video grid, mic/camera/screen share, device choice, participants (lobby admit for the host), chat and
// raise hand over the data channel, leave / end for everyone. Labels are ours (French first).
import "@livekit/components-styles";
import {
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  StartAudio,
  TrackToggle,
  useChat,
  useDataChannel,
  useLocalParticipant,
  useMediaDeviceSelect,
  useParticipantInfo,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { parseParticipantMetadata, type MeetingTokenResponse } from "@mimt/shared";
import { DisconnectReason, RoomEvent, Track, type Participant } from "livekit-client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { toErrorKey } from "../../api/errors";
import { Icon } from "../../components/Icon";
import { ErrorNote } from "../../components/ui";
import { useI18n } from "../../i18n/I18nProvider";
import type { TKey } from "../../i18n/core";
import type { JoinChoices } from "./PreJoin";

export interface StageProps {
  conn: MeetingTokenResponse;
  choices: JoinChoices;
  /** Set for signed-in participants; guests cannot admit nor end. */
  meetingId: string | null;
  onLeave: (reason: "left" | "ended") => void;
}

const HAND_TOPIC = "mimt.hand";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const isWaiting = (p: Participant) => parseParticipantMetadata(p.metadata)?.waiting === true;

export default function Room({ conn, choices, meetingId, onLeave }: StageProps) {
  const { t } = useI18n();
  const ended = useRef(false);
  const publish = !conn.waiting;
  return (
    <LiveKitRoom
      serverUrl={conn.url}
      token={conn.token}
      connect
      audio={publish && choices.audio ? (choices.audioDeviceId ? { deviceId: choices.audioDeviceId } : true) : false}
      video={publish && choices.video ? (choices.videoDeviceId ? { deviceId: choices.videoDeviceId } : true) : false}
      options={{ adaptiveStream: true, dynacast: true }}
      onDisconnected={(reason) => onLeave(ended.current || reason === DisconnectReason.ROOM_DELETED ? "ended" : "left")}
      data-lk-theme="default"
      className="meet-room"
      role="region"
      aria-label={t("meet.room.label")}
    >
      <Stage conn={conn} choices={choices} meetingId={meetingId} onEnded={() => (ended.current = true)} />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}

function Stage({ conn, choices, meetingId, onEnded }: { conn: MeetingTokenResponse; choices: JoinChoices; meetingId: string | null; onEnded: () => void }) {
  const { t } = useI18n();
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const info = useParticipantInfo({ participant: localParticipant });
  const waiting = parseParticipantMetadata(info.metadata)?.waiting ?? conn.waiting;
  const wasWaiting = useRef(conn.waiting);
  const [panel, setPanel] = useState<"none" | "people" | "chat" | "devices">("none");
  const [hands, setHands] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<TKey | null>(null);
  const isHost = conn.role === "host";

  // Admitted: publish what the guest chose in the pre-join screen.
  useEffect(() => {
    if (!wasWaiting.current || waiting) return;
    wasWaiting.current = false;
    void localParticipant.setMicrophoneEnabled(choices.audio, choices.audioDeviceId ? { deviceId: choices.audioDeviceId } : undefined).catch(() => undefined);
    void localParticipant.setCameraEnabled(choices.video, choices.videoDeviceId ? { deviceId: choices.videoDeviceId } : undefined).catch(() => undefined);
  }, [waiting, localParticipant, choices]);

  const { send: sendHand } = useDataChannel(HAND_TOPIC, (msg) => {
    const from = msg.from?.identity;
    if (!from) return;
    try {
      const v = JSON.parse(decoder.decode(msg.payload)) as { raised?: boolean };
      setHands((h) => ({ ...h, [from]: v.raised === true }));
    } catch {
      // Ignore malformed messages.
    }
  });
  const myHand = hands[localParticipant.identity] === true;
  const toggleHand = useCallback(async () => {
    const raised = !myHand;
    setHands((h) => ({ ...h, [localParticipant.identity]: raised }));
    await sendHand(encoder.encode(JSON.stringify({ raised })), { reliable: true }).catch(() => undefined);
  }, [myHand, sendHand, localParticipant.identity]);

  const end = async () => {
    if (!meetingId || !window.confirm(t("meet.room.endConfirm"))) return;
    try {
      onEnded();
      await api.endMeeting(meetingId);
      await room.disconnect();
    } catch (e) {
      setError(toErrorKey(e));
    }
  };

  if (waiting) {
    return (
      <div className="meet-lobby" role="status">
        <Icon name="clock" size={40} />
        <h2>{t("meet.room.lobbyTitle")}</h2>
        <p className="muted">{t("meet.room.lobbyText")}</p>
        <p className="meet-lobby__title">{conn.meeting.title}</p>
        <button type="button" className="btn btn--ghost" onClick={() => void room.disconnect()}>
          {t("meet.room.leave")}
        </button>
      </div>
    );
  }

  return (
    <div className={`meet-stage${panel !== "none" ? " has-panel" : ""}`}>
      <div className="meet-stage__main">
        <header className="meet-stage__bar">
          <h1 className="meet-stage__title">{conn.meeting.title}</h1>
          <StartAudio label={t("meet.room.startAudio")} className="btn btn--ghost btn--sm" />
        </header>
        <ErrorNote error={error} />
        <VideoGrid hands={hands} />
        <nav className="meet-controls" aria-label={t("meet.room.controls")}>
          <TrackToggle source={Track.Source.Microphone} className="meet-btn" aria-label={t("meet.device.mic")} showIcon />
          <TrackToggle source={Track.Source.Camera} className="meet-btn" aria-label={t("meet.device.camera")} showIcon />
          {typeof navigator !== "undefined" && navigator.mediaDevices && "getDisplayMedia" in navigator.mediaDevices ? (
            <TrackToggle source={Track.Source.ScreenShare} className="meet-btn" aria-label={t("meet.room.screen")} showIcon captureOptions={{ audio: true }} />
          ) : null}
          <button type="button" className={`meet-btn${myHand ? " is-active" : ""}`} aria-pressed={myHand} aria-label={myHand ? t("meet.room.handDown") : t("meet.room.hand")} onClick={() => void toggleHand()}>
            <Icon name="hand" />
          </button>
          <PanelButton panel={panel} setPanel={setPanel} which="people" icon="users" label={t("meet.room.participants", { n: room.numParticipants || 1 })} />
          <PanelButton panel={panel} setPanel={setPanel} which="chat" icon="chat" label={t("meet.room.chat")} />
          <PanelButton panel={panel} setPanel={setPanel} which="devices" icon="settings" label={t("meet.room.devices")} />
          <button type="button" className="btn btn--danger meet-controls__leave" onClick={() => void room.disconnect()}>
            <Icon name="hangup" />
            {t("meet.room.leave")}
          </button>
          {isHost && meetingId ? (
            <button type="button" className="btn btn--ghost meet-controls__end" onClick={() => void end()}>
              {t("meet.room.end")}
            </button>
          ) : null}
        </nav>
      </div>
      {panel !== "none" ? (
        <aside className="meet-panel" aria-label={panel === "people" ? t("meet.room.participants", { n: room.numParticipants || 1 }) : panel === "chat" ? t("meet.room.chat") : t("meet.room.devices")}>
          <button type="button" className="icon-btn meet-panel__close" aria-label={t("meet.close")} onClick={() => setPanel("none")}>
            <Icon name="close" />
          </button>
          {panel === "people" ? <People hands={hands} isHost={isHost} meetingId={meetingId} onError={setError} /> : null}
          {panel === "chat" ? <ChatPanel /> : null}
          {panel === "devices" ? <Devices /> : null}
        </aside>
      ) : null}
    </div>
  );
}

function PanelButton({ panel, setPanel, which, icon, label }: { panel: string; setPanel: (p: "none" | "people" | "chat" | "devices") => void; which: "people" | "chat" | "devices"; icon: "users" | "chat" | "settings"; label: string }) {
  return (
    <button type="button" className={`meet-btn${panel === which ? " is-active" : ""}`} aria-pressed={panel === which} aria-label={label} onClick={() => setPanel(panel === which ? "none" : which)}>
      <Icon name={icon} />
    </button>
  );
}

function VideoGrid({ hands }: { hands: Record<string, boolean> }) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged], onlySubscribed: false },
  );
  // Guests still in the lobby are not shown in the grid.
  const visible = tracks.filter((tr) => !isWaiting(tr.participant));
  return (
    <div className="meet-grid">
      <GridLayout tracks={visible}>
        <TileWithHand hands={hands} />
      </GridLayout>
    </div>
  );
}

function TileWithHand({ hands }: { hands: Record<string, boolean> }) {
  const { t } = useI18n();
  return (
    <ParticipantTile>
      <HandBadge hands={hands} label={t("meet.room.handRaised")} />
    </ParticipantTile>
  );
}

function HandBadge({ hands, label }: { hands: Record<string, boolean>; label: string }) {
  const info = useParticipantInfo();
  if (!info.identity || !hands[info.identity]) return null;
  return (
    <span className="meet-hand" role="img" aria-label={label}>
      ✋
    </span>
  );
}

function People({ hands, isHost, meetingId, onError }: { hands: Record<string, boolean>; isHost: boolean; meetingId: string | null; onError: (k: TKey) => void }) {
  const { t } = useI18n();
  const participants = useParticipants();
  const [busy, setBusy] = useState<string | null>(null);
  const waiting = participants.filter(isWaiting);
  const inRoom = participants.filter((p) => !isWaiting(p));
  const admit = async (p: Participant) => {
    if (!meetingId) return;
    setBusy(p.identity);
    try {
      await api.admitToMeeting(meetingId, { identity: p.identity });
    } catch (e) {
      onError(toErrorKey(e));
    } finally {
      setBusy(null);
    }
  };
  const role = (p: Participant) => parseParticipantMetadata(p.metadata)?.role;
  return (
    <div className="meet-people">
      {isHost && waiting.length > 0 ? (
        <>
          <h2 className="small-title">{t("meet.room.waiting", { n: waiting.length })}</h2>
          <ul className="list list--compact">
            {waiting.map((p) => (
              <li key={p.identity} className="list__row">
                <span className="list__main">{p.name || p.identity}</span>
                <button type="button" className="btn btn--primary btn--sm" disabled={busy === p.identity} aria-label={t("meet.room.admitWho", { name: p.name || p.identity })} onClick={() => void admit(p)}>
                  {t("meet.room.admit")}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h2 className="small-title">{t("meet.room.participants", { n: inRoom.length })}</h2>
      <ul className="list list--compact">
        {inRoom.map((p) => (
          <li key={p.identity} className="list__row">
            <span className="list__main">
              <span className="list__title">
                {p.name || p.identity}
                {p.isLocal ? ` (${t("meet.room.you")})` : ""}
              </span>
              <span className="list__sub">{role(p) === "host" ? t("meet.room.host") : role(p) === "guest" ? t("meet.room.guest") : ""}</span>
            </span>
            <span className="row">
              {hands[p.identity] ? (
                <span role="img" aria-label={t("meet.room.handRaised")}>
                  ✋
                </span>
              ) : null}
              <Icon name={p.isMicrophoneEnabled ? "mic" : "micOff"} title={p.isMicrophoneEnabled ? t("meet.mic.on") : t("meet.mic.off")} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChatPanel() {
  const { t, locale } = useI18n();
  const { chatMessages, send, isSending } = useChat();
  const [text, setText] = useState("");
  const id = useId();
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [chatMessages.length]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const msg = text.trim();
    if (!msg) return;
    setText("");
    await send(msg).catch(() => setText(msg));
  };
  return (
    <div className="meet-chat">
      <h2 className="small-title">{t("meet.room.chat")}</h2>
      {chatMessages.length === 0 ? <p className="muted small">{t("meet.room.noMessages")}</p> : null}
      <ol className="meet-chat__list" ref={listRef} aria-live="polite">
        {chatMessages.map((m) => (
          <li key={m.id} className="meet-chat__msg">
            <span className="meet-chat__from">
              {m.from?.isLocal ? t("meet.room.you") : (m.from?.name ?? m.from?.identity ?? "")}
              <time className="muted small"> {new Date(m.timestamp).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</time>
            </span>
            <span>{m.message}</span>
          </li>
        ))}
      </ol>
      <form className="meet-chat__form" onSubmit={submit}>
        <label htmlFor={id} className="sr-only">
          {t("meet.room.chatLabel")}
        </label>
        <input id={id} className="input" value={text} maxLength={1000} placeholder={t("meet.room.chatPlaceholder")} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="icon-btn" disabled={isSending || !text.trim()} aria-label={t("meet.room.send")}>
          <Icon name="send" />
        </button>
      </form>
    </div>
  );
}

function Devices() {
  const { t } = useI18n();
  return (
    <div className="meet-devices">
      <h2 className="small-title">{t("meet.room.devices")}</h2>
      <DeviceSelect kind="audioinput" label={t("meet.device.mic")} />
      <DeviceSelect kind="videoinput" label={t("meet.device.camera")} />
      <DeviceSelect kind="audiooutput" label={t("meet.device.speaker")} />
    </div>
  );
}

function DeviceSelect({ kind, label }: { kind: MediaDeviceKind; label: string }) {
  const { t } = useI18n();
  const id = useId();
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind });
  const options = useMemo(() => devices.filter((d) => d.deviceId), [devices]);
  if (options.length === 0) return null;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="input" value={activeDeviceId} onChange={(e) => void setActiveMediaDevice(e.target.value)}>
        {options.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || t("meet.device.unnamed", { n: i + 1 })}
          </option>
        ))}
      </select>
    </div>
  );
}
