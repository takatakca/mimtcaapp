// Call recordings (MIMT Affaires): GET /v1/business/:id/recordings. Owners and admins see every
// recording, members their own. Each item carries a signed audio link valid 15 minutes (the player
// cannot send the bearer token); past that, the list is reloaded for fresh links.
import type { BusinessRecordingDto } from "@mimt/shared";
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { Badge, Empty, ErrorNote, Loading } from "../../components/ui";
import { useI18n } from "../../i18n/I18nProvider";
import { formatPhone } from "../../lib/dial";
import { formatDateTime, formatDuration } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useBusiness } from "./shared";

/** The signed link is expired (or about to: 30 s margin). */
export function linkExpired(r: Pick<BusinessRecordingDto, "audioUrlExpiresAt">, now = Date.now()): boolean {
  const at = Date.parse(r.audioUrlExpiresAt);
  return Number.isNaN(at) || at - 30_000 <= now;
}

export function Recordings() {
  const { t, locale } = useI18n();
  const { id } = useBusiness();
  const list = useAsync(() => api.recordings(id), [id]);
  const [now, setNow] = useState(() => Date.now());

  // Re-evaluate link expiry every 30 s so an old link is never handed to the player.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const recordings = list.data?.recordings ?? [];
  const phone = (n: string | null) => (n ? formatPhone(n) : t("voicemail.unknownCaller"));
  const anyExpired = recordings.some((r) => linkExpired(r, now));

  return (
    <section className="card" aria-labelledby="rec-h">
      <h2 id="rec-h" className="card__title">
        {t("biz.nav.recordings")}
      </h2>
      <p className="muted small">{t("rec.intro")}</p>
      <ErrorNote error={list.error} onRetry={list.reload} />
      {list.loading ? <Loading /> : null}
      {list.data && recordings.length === 0 ? <Empty>{t("rec.empty")}</Empty> : null}
      {anyExpired && !list.loading ? (
        <div className="note note--warn" role="status">
          <span>{t("rec.expired")}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={list.reload}>
            {t("rec.refresh")}
          </button>
        </div>
      ) : null}
      <ul className="stack">
        {recordings.map((r) => (
          <li key={r.id} className="card vm">
            <div className="vm__head">
              <div>
                <p className="vm__from">
                  {phone(r.fromNumber)} → {phone(r.toNumber)}{" "}
                  <Badge tone="muted">{t(r.source === "on_demand" ? "rec.onDemand" : "rec.automatic")}</Badge>
                </p>
                <p className="muted small">
                  {formatDateTime(r.createdAt, locale)}
                  {r.durationS ? ` · ${formatDuration(r.durationS)}` : ""}
                  {" · "}
                  {t("rec.deleteAfter", { date: formatDateTime(r.deleteAfter, locale) })}
                </p>
              </div>
            </div>
            {r.summary ? (
              <div className="vm__ai">
                <p className="small">
                  <Badge tone="muted">{t("rec.summary")}</Badge> {r.summary.text}
                </p>
                {r.summary.actionItems.length ? (
                  <ul className="small">
                    {r.summary.actionItems.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {linkExpired(r, now) ? null : (
              <audio className="vm__audio" controls preload="none" src={r.audioUrl} aria-label={t("rec.play", { from: phone(r.fromNumber) })} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
