// /reunions/:meetingId — signed-in participants: pre-join, then the room; leave or end returns here.
import "../../styles/meetings.css";
import type { MeetingTokenResponse } from "@mimt/shared";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../../api/client";
import { toErrorKey } from "../../api/errors";
import { useSession } from "../../auth/SessionProvider";
import { ErrorNote, Loading, PageHeader } from "../../components/ui";
import { useI18n } from "../../i18n/I18nProvider";
import type { TKey } from "../../i18n/core";
import { useAsync } from "../../lib/useAsync";
import { PreJoin, type JoinChoices } from "./PreJoin";
import { MeetingStage } from "./Stage";

export function MeetingRoom() {
  const { t } = useI18n();
  const { meetingId = "" } = useParams();
  const { me } = useSession();
  const detail = useAsync(() => api.meeting(meetingId), [meetingId]);
  const [conn, setConn] = useState<{ token: MeetingTokenResponse; choices: JoinChoices } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const [left, setLeft] = useState<"left" | "ended" | null>(null);

  const join = async (choices: JoinChoices) => {
    setBusy(true);
    setError(null);
    try {
      const token = await api.meetingToken(meetingId);
      setLeft(null);
      setConn({ token, choices: { ...choices, name: me?.user.displayName ?? "" } });
    } catch (e) {
      setError(toErrorKey(e));
    } finally {
      setBusy(false);
    }
  };

  if (conn) {
    return (
      <div className="page page--wide meet-live">
        <MeetingStage
          conn={conn.token}
          choices={conn.choices}
          meetingId={meetingId}
          onLeave={(reason) => {
            if (reason === "ended" && conn.token.role === "host") void api.endMeeting(meetingId).catch(() => undefined);
            setConn(null);
            setLeft(reason);
            detail.reload();
          }}
        />
      </div>
    );
  }

  const m = detail.data?.meeting;
  const ended = m?.status === "ended" || left === "ended";
  return (
    <div className="page page--wide">
      <PageHeader title={m?.title ?? t("meet.title")} sub={m ? t("meet.cap", { n: m.maxParticipants }) : undefined} />
      <ErrorNote error={detail.error} onRetry={detail.reload} />
      {detail.loading ? <Loading /> : null}
      {left ? (
        <p className="note note--info" role="status">
          {t(left === "ended" ? "meet.room.ended" : "meet.room.left")}
        </p>
      ) : null}
      <ErrorNote error={error} />
      {m && !ended ? <PreJoin askName={false} busy={busy} onJoin={(c) => void join(c)} /> : null}
      {m && ended && !left ? <p className="note note--info">{t("meet.room.ended")}</p> : null}
      <p>
        <Link to="/reunions" className="btn btn--ghost btn--sm">
          {t("meet.room.backToList")}
        </Link>
      </p>
    </div>
  );
}
