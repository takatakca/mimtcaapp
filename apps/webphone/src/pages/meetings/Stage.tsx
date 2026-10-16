// Chooses the live LiveKit room (lazy chunk) or, in demo mode, a static placeholder that never connects.
import type { MeetingTokenResponse } from "@mimt/shared";
import { lazy, Suspense } from "react";
import { env } from "../../env";
import { Icon } from "../../components/Icon";
import { Loading } from "../../components/ui";
import { useI18n } from "../../i18n/I18nProvider";
import type { JoinChoices } from "./PreJoin";
import type { StageProps } from "./Room";

const Room = lazy(() => import("./Room"));

export function MeetingStage(props: StageProps) {
  if (env.mock) return <DemoStage {...props} />;
  return (
    <Suspense fallback={<Loading />}>
      <Room {...props} />
    </Suspense>
  );
}

const DEMO_PEOPLE = ["Marc Gagnon", "Sophie Lavoie", "Julie Bouchard"];

/** Mode démo: what the room looks like, without a video server. */
function DemoStage({ conn, choices, meetingId, onLeave }: { conn: MeetingTokenResponse; choices: JoinChoices; meetingId: string | null; onLeave: StageProps["onLeave"] }) {
  const { t } = useI18n();
  if (conn.waiting) {
    return (
      <div className="meet-room">
        <div className="meet-lobby" role="status">
          <Icon name="clock" size={40} />
          <h2>{t("meet.room.lobbyTitle")}</h2>
          <p className="muted">{t("meet.room.lobbyText")}</p>
          <p className="meet-lobby__title">{conn.meeting.title}</p>
          <p className="note note--info">{t("meet.room.demo")}</p>
          <button type="button" className="btn btn--ghost" onClick={() => onLeave("left")}>
            {t("meet.room.leave")}
          </button>
        </div>
      </div>
    );
  }
  const me = choices.name || t("meet.room.you");
  const people = [`${me} (${t("meet.room.you")})`, ...DEMO_PEOPLE];
  return (
    <div className="meet-room" role="region" aria-label={t("meet.room.label")}>
      <div className="meet-stage">
        <div className="meet-stage__main">
          <header className="meet-stage__bar">
            <h1 className="meet-stage__title">{conn.meeting.title}</h1>
          </header>
          <p className="note note--info">{t("meet.room.demo")}</p>
          <ul className="meet-demo-grid">
            {people.map((p) => (
              <li key={p} className="meet-demo-tile">
                <span className="meet-demo-tile__avatar" aria-hidden="true">
                  {p
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((w) => w[0])
                    .join("")
                    .toUpperCase()}
                </span>
                <span className="meet-demo-tile__name">{p}</span>
              </li>
            ))}
          </ul>
          <nav className="meet-controls" aria-label={t("meet.room.controls")}>
            <button type="button" className="meet-btn" aria-label={t("meet.device.mic")} disabled>
              <Icon name={choices.audio ? "mic" : "micOff"} />
            </button>
            <button type="button" className="meet-btn" aria-label={t("meet.device.camera")} disabled>
              <Icon name={choices.video ? "video" : "videoOff"} />
            </button>
            <button type="button" className="meet-btn" aria-label={t("meet.room.screen")} disabled>
              <Icon name="screen" />
            </button>
            <button type="button" className="meet-btn" aria-label={t("meet.room.hand")} disabled>
              <Icon name="hand" />
            </button>
            <button type="button" className="btn btn--danger meet-controls__leave" onClick={() => onLeave("left")}>
              <Icon name="hangup" />
              {t("meet.room.leave")}
            </button>
            {conn.role === "host" && meetingId ? (
              <button type="button" className="btn btn--ghost meet-controls__end" onClick={() => onLeave("ended")}>
                {t("meet.room.end")}
              </button>
            ) : null}
          </nav>
        </div>
      </div>
    </div>
  );
}
