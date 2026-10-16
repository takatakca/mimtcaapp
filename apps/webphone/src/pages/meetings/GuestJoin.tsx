// /reunion/:guestToken — public guest page (no MIMT account): meeting name, name + camera/mic preview,
// then the room (lobby first when the host turned it on). The token is only sent in POST bodies.
import "../../styles/meetings.css";
import type { MeetingTokenResponse } from "@mimt/shared";
import { useState } from "react";
import { useParams } from "react-router";
import { api } from "../../api/client";
import { ApiClientError, toErrorKey } from "../../api/errors";
import { DemoBanner, ErrorNote, Loading, Wordmark } from "../../components/ui";
import { env } from "../../env";
import { useI18n } from "../../i18n/I18nProvider";
import type { TKey } from "../../i18n/core";
import { useAsync } from "../../lib/useAsync";
import { LanguageSwitch } from "../LanguageSwitch";
import { PreJoin, type JoinChoices } from "./PreJoin";
import { MeetingStage } from "./Stage";

function linkError(e: unknown): TKey {
  if (e instanceof ApiClientError) {
    if (e.code === "invite_expired") return "meet.guest.expired";
    if (e.code === "meeting_ended") return "meet.guest.ended";
    if (e.code === "invalid_guest_token" || e.status === 404 || e.status === 400) return "meet.guest.invalid";
  }
  return toErrorKey(e);
}

export function GuestJoin() {
  const { t, locale } = useI18n();
  const { guestToken = "" } = useParams();
  const [infoError, setInfoError] = useState<TKey | null>(null);
  const info = useAsync(() => api.guestMeetingInfo(guestToken).catch((e: unknown) => {
    setInfoError(linkError(e));
    throw e;
  }), [guestToken]);
  const [conn, setConn] = useState<{ token: MeetingTokenResponse; choices: JoinChoices } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const [left, setLeft] = useState<"left" | "ended" | null>(null);
  const [name, setName] = useState("");

  const join = async (choices: JoinChoices) => {
    setBusy(true);
    setError(null);
    setName(choices.name);
    try {
      const token = await api.joinMeetingAsGuest({ guestToken, displayName: choices.name });
      setLeft(null);
      setConn({ token, choices });
    } catch (e) {
      setError(linkError(e));
    } finally {
      setBusy(false);
    }
  };

  const m = info.data;
  const ended = m?.status === "ended" || left === "ended";
  return (
    <div className="guest">
      {env.mock ? <DemoBanner /> : null}
      <header className="guest__top">
        <Wordmark />
        <LanguageSwitch />
      </header>
      <main id="main" className="guest__main">
        {conn ? (
          <MeetingStage
            conn={conn.token}
            choices={conn.choices}
            meetingId={null}
            onLeave={(reason) => {
              setConn(null);
              setLeft(reason);
            }}
          />
        ) : (
          <div className="guest__card card">
            {info.loading ? <Loading /> : null}
            {infoError ? (
              <p className="note note--error" role="alert">
                {t(infoError)}
              </p>
            ) : null}
            {m ? (
              <>
                <p className="muted small">{t("meet.guest.invited")}</p>
                <h1 className="guest__title">{m.title}</h1>
                <p className="muted">
                  {m.hostName ? t("meet.guest.host", { name: m.hostName }) : null}
                  {m.scheduledStart ? ` · ${t("meet.guest.when", { when: new Date(m.scheduledStart).toLocaleString(locale, { dateStyle: "long", timeStyle: "short" }) })}` : null}
                </p>
                {m.lobbyEnabled ? <p className="small muted">{t("meet.guest.lobbyNote")}</p> : null}
                {left ? (
                  <p className="note note--info" role="status">
                    {t(left === "ended" ? "meet.room.ended" : "meet.room.left")}
                  </p>
                ) : null}
                <ErrorNote error={error} />
                {ended ? <p className="note note--info">{t("meet.guest.ended")}</p> : <PreJoin askName initialName={name} busy={busy} onJoin={(c) => void join(c)} />}
                <p className="muted small">{t("meet.guest.privacy")}</p>
              </>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
