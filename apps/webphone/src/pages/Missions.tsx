// /missions — « Missions MIMT ». Read-only view of GET /v1/missions: the API grants each reward itself when it sees
// the event (no button here claims anything). Each mission links to where it is completed. Sharing is rewarded only
// through the referral program (a friend who subscribes), never for a like, a review or a post.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { REFERRAL_POINTS, type MissionDto, type ReferralsResponse } from "@mimt/shared";
import { api } from "../api/client";
import { toErrorKey } from "../api/errors";
import { Icon } from "../components/Icon";
import { Badge, ErrorNote, Loading, PageHeader } from "../components/ui";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";
import { celebrationsOf, celebrateMission, missionLabel, missionProgress, missionTarget } from "../lib/missions";
import { formatPoints } from "../lib/points";
import { useAsync } from "../lib/useAsync";

const STATUS_KEY: Record<MissionDto["status"], TKey> = { todo: "mission.status.todo", pending: "mission.status.pending", done: "mission.status.done" };
const STATUS_TONE = { todo: "muted", pending: "warn", done: "ok" } as const;

function rewardText(m: MissionDto, t: (k: TKey, v?: Record<string, string | number>) => string, lang: "fr" | "en"): string {
  if (m.rewardKind === "points") return t("mission.reward.points", { points: formatPoints(m.points, lang) });
  if (m.rewardKind === "minutes") return t("mission.reward.minutes", { minutes: m.minutes });
  return t(m.rewardKind === "premium_month" ? "mission.reward.premium_month" : "mission.reward.free_month");
}

export function Missions() {
  const { t, lang } = useI18n();
  const data = useAsync(() => api.missions(), []);

  useEffect(() => {
    // Grants made elsewhere (webhooks, SMS sign-in) are celebrated here too, once per browser.
    if (data.data?.enabled) celebrationsOf(data.data.missions).forEach(celebrateMission);
  }, [data.data]);

  if (data.loading && !data.data) return <Loading />;
  if (!data.data) return <ErrorNote error={data.error} onRetry={data.reload} />;
  const r = data.data;
  const progress = missionProgress(r.missions);

  return (
    <div className="page">
      <PageHeader title={t("mission.title")} sub={t("mission.lead")} />
      {r.enabled ? null : <p className="note note--warn">{t("mission.off")}</p>}

      <section className="card" aria-labelledby="mission-progress-h">
        <h2 id="mission-progress-h" className="card__title">
          {t("mission.progress", { done: progress.done, total: progress.total })}
        </h2>
        <div className="usage__track mission-progress" role="progressbar" aria-label={t("mission.progressLabel")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
          <div className="usage__fill" style={{ width: `${progress.percent}%` }} />
        </div>
        <p className="mission-earned">{t("mission.earned", { points: formatPoints(r.totalPoints ?? 0, lang), cap: formatPoints(r.capPoints ?? 0, lang) })}</p>
        <p className="muted small">{t("mission.bucket.outbound")}</p>
        {r.totalMinutes > 0 ? <p className="muted small">{t("mission.bucket.on_net", { minutes: r.totalMinutes })}</p> : null}
        <Link to="/points" className="btn btn--ghost btn--sm">
          {t("mission.wallet")}
        </Link>
      </section>

      <ul className="mission-list">
        {r.missions.map((m) => (
          <MissionItem key={m.id} mission={m} />
        ))}
      </ul>

      <InviteFriend />

      <section className="card mission-rules" aria-labelledby="mission-rules-h">
        <h2 id="mission-rules-h" className="card__title">
          {t("mission.rules.title")}
        </h2>
        <ul>
          <li>{t("mission.rules.noPurchase")}</li>
          <li>{t("mission.rules.noChance")}</li>
          <li>{t("mission.rules.noCash")}</li>
          <li>{t("mission.rules.currentMonth")}</li>
          <li>{t("mission.rules.once")}</li>
          <li>{t("mission.rules.noSocial")}</li>
        </ul>
      </section>
    </div>
  );
}

function MissionItem({ mission: m }: { mission: MissionDto }) {
  const { t, lang } = useI18n();
  const target = missionTarget(m.id, lang);
  const label = missionLabel(m.id, lang);
  return (
    <li className={`mission mission--${m.status}`}>
      <span className="mission__check" aria-hidden="true">
        {m.status === "todo" ? <Icon name="sparkle" size={18} /> : "✓"}
      </span>
      <div className="mission__body">
        <p className="mission__label">
          {label} <Badge tone={STATUS_TONE[m.status]}>{t(STATUS_KEY[m.status])}</Badge>
        </p>
        <p className="mission__reward">
          {rewardText(m, t, lang)}
          {m.needsPurchase ? <span className="muted small"> · {t("mission.needsPurchase")}</span> : null}
        </p>
        <p className="muted small">{m.status === "pending" ? t("mission.pendingHint") : t(`mission.hint.${m.id}` as TKey)}</p>
      </div>
      {m.status === "todo" && target ? (
        target.external ? (
          <a className="btn btn--primary btn--sm" href={target.to} target="_blank" rel="noopener noreferrer" aria-label={`${t("mission.go")} : ${label}`}>
            {t("mission.go")}
          </a>
        ) : target.to.startsWith("#") ? (
          <a className="btn btn--primary btn--sm" href={target.to} aria-label={`${t("mission.go")} : ${label}`}>
            {t("mission.go")}
          </a>
        ) : (
          <Link className="btn btn--primary btn--sm" to={target.to} aria-label={`${t("mission.go")} : ${label}`}>
            {t("mission.go")}
          </Link>
        )
      ) : null}
    </li>
  );
}

/** « Inviter un ami »: the existing referral code, shared with navigator.share or copied. No reward for sharing itself. */
function InviteFriend() {
  const { t } = useI18n();
  const [ref, setRef] = useState<ReferralsResponse | null>(null);
  const [error, setError] = useState<TKey | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api.referrals().then(setRef, (e: unknown) => setError(toErrorKey(e)));
  }, []);

  const share = async () => {
    if (!ref) return;
    const text = t("mission.invite.text", { code: ref.code });
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "MIMT", text, url: ref.shareUrl });
        return;
      } catch (e) {
        if ((e as DOMException)?.name === "AbortError") return;
      }
    }
    await copy();
  };
  const copy = async () => {
    if (!ref) return;
    try {
      await navigator.clipboard.writeText(ref.shareUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="card" id="inviter" aria-labelledby="invite-h">
      <h2 id="invite-h" className="card__title">
        {t("mission.invite.title")}
      </h2>
      <p>{t("mission.invite.lead", { points: REFERRAL_POINTS })}</p>
      {ref ? (
        <>
          <p>
            <strong>{t("mission.invite.code", { code: ref.code })}</strong>
          </p>
          <div className="row row--wrap">
            <button type="button" className="btn btn--primary" onClick={() => void share()}>
              <Icon name="link" size={16} /> {t("mission.invite.share")}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => void copy()}>
              <Icon name="copy" size={16} /> {t("mission.invite.copy")}
            </button>
          </div>
          <p className="muted small mission-share-url">{ref.shareUrl}</p>
          {copied ? (
            <p className="ok-text" role="status">
              {t("mission.invite.copied")}
            </p>
          ) : null}
        </>
      ) : null}
      <ErrorNote error={error} />
    </section>
  );
}
