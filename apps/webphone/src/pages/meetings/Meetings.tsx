// Réunions MIMT: list, instant meeting, schedule, guest links (copy or email). The room is /reunions/:id.
import "../../styles/meetings.css";
import type { CreatedMeetingInvite, Meeting } from "@mimt/shared";
import { useId, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../../api/client";
import { ApiClientError, toErrorKey } from "../../api/errors";
import { useSession } from "../../auth/SessionProvider";
import { Icon } from "../../components/Icon";
import { Badge, Empty, ErrorNote, Field, Loading, PageHeader } from "../../components/ui";
import { useI18n } from "../../i18n/I18nProvider";
import type { TKey } from "../../i18n/core";
import { useAsync } from "../../lib/useAsync";
import { copyText, formatMeetingWhen, localInputToIso, meetingScopes, parseEmails, splitMeetings } from "./shared";

const STATUS: Record<Meeting["status"], { key: TKey; tone: "ok" | "info" | "muted" }> = {
  live: { key: "meet.status.live", tone: "ok" },
  scheduled: { key: "meet.status.scheduled", tone: "info" },
  ended: { key: "meet.status.ended", tone: "muted" },
};
const DURATIONS: Array<[number, TKey]> = [
  [30, "meet.form.d30"],
  [60, "meet.form.d60"],
  [90, "meet.form.d90"],
  [120, "meet.form.d120"],
  [240, "meet.form.d240"],
];

export function Meetings() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { me, businesses } = useSession();
  const scopes = meetingScopes(me, businesses);
  const list = useAsync(() => api.meetings(), []);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);
  const notConfigured = list.error === "error.notConfigured";
  const defaultScope = scopes.adminOf[0]?.business.id ?? "";

  const add = (m: Meeting) => list.setData((d) => ({ meetings: [m, ...(d?.meetings ?? [])] }));

  const instant = async () => {
    setBusy(true);
    setError(null);
    try {
      const m = await api.createMeeting({
        title: t("meet.instantTitle", { name: me?.user.displayName ?? "MIMT" }),
        ...(scopes.personal || !defaultScope ? {} : { businessId: defaultScope }),
        lobbyEnabled: true,
      });
      add(m);
      navigate(`/reunions/${m.id}`);
    } catch (e) {
      setError(toErrorKey(e));
    } finally {
      setBusy(false);
    }
  };

  const { upcoming, past } = splitMeetings(list.data?.meetings ?? []);
  return (
    <div className="page meet-page">
      <PageHeader
        title={t("meet.title")}
        sub={t("meet.sub")}
        actions={
          scopes.any && !notConfigured ? (
            <>
              <button type="button" className="btn btn--ghost" onClick={() => setFormOpen((o) => !o)} aria-expanded={formOpen}>
                <Icon name="clock" />
                {t("meet.schedule")}
              </button>
              <button type="button" className="btn btn--primary" onClick={() => void instant()} disabled={busy}>
                <Icon name="video" />
                {t("meet.instant")}
              </button>
            </>
          ) : null
        }
      />
      {notConfigured ? <p className="note note--info">{t("meet.notConfigured")}</p> : <ErrorNote error={list.error} onRetry={list.reload} />}
      {!scopes.any && !notConfigured ? <p className="note note--info">{t("meet.notIncluded")}</p> : null}
      <ErrorNote error={error} />
      {formOpen ? (
        <ScheduleForm
          scopes={scopes}
          onCancel={() => setFormOpen(false)}
          onCreated={(m) => {
            add(m);
            setFormOpen(false);
          }}
        />
      ) : null}
      {list.loading ? <Loading /> : null}
      {list.data ? (
        <>
          <section aria-labelledby="meet-up">
            <h2 id="meet-up" className="small-title">
              {t("meet.upcoming")}
            </h2>
            {upcoming.length === 0 ? <Empty>{t("meet.empty")}</Empty> : null}
            <ul className="stack">
              {upcoming.map((m) => (
                <MeetingCard key={m.id} meeting={m} businessName={businesses.find((b) => b.business.id === m.businessId)?.business.name ?? null} />
              ))}
            </ul>
          </section>
          {past.length > 0 ? (
            <section aria-labelledby="meet-past">
              <h2 id="meet-past" className="small-title">
                {t("meet.past")}
              </h2>
              <ul className="stack">
                {past.map((m) => (
                  <MeetingCard key={m.id} meeting={m} businessName={businesses.find((b) => b.business.id === m.businessId)?.business.name ?? null} />
                ))}
              </ul>
            </section>
          ) : null}
          <p className="muted small">{t("meet.noRecording")}</p>
        </>
      ) : null}
    </div>
  );
}

function ScheduleForm({ scopes, onCancel, onCreated }: { scopes: ReturnType<typeof meetingScopes>; onCancel: () => void; onCreated: (m: Meeting) => void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState(scopes.personal ? "" : (scopes.adminOf[0]?.business.id ?? ""));
  const [start, setStart] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [lobby, setLobby] = useState(true);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [error, setError] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setTitleError(t("meet.form.titleRequired"));
    setTitleError(null);
    setBusy(true);
    setError(null);
    const scheduledStart = localInputToIso(start);
    try {
      const m = await api.createMeeting({
        title: title.trim(),
        ...(scope ? { businessId: scope } : {}),
        scheduledStart,
        scheduledEnd: scheduledStart ? new Date(new Date(scheduledStart).getTime() + minutes * 60_000).toISOString() : null,
        lobbyEnabled: lobby,
      });
      onCreated(m);
    } catch (err) {
      setError(toErrorKey(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card form-grid meet-form" onSubmit={submit} noValidate aria-labelledby="meet-form-h">
      <h2 id="meet-form-h" className="card__title">
        {t("meet.form.title")}
      </h2>
      <Field id="meet-title" label={t("meet.form.name")} error={titleError}>
        <input id="meet-title" className="input" value={title} maxLength={120} placeholder={t("meet.form.namePlaceholder")} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      {scopes.adminOf.length > 0 ? (
        <Field id="meet-scope" label={t("meet.form.for")}>
          <select id="meet-scope" className="input" value={scope} onChange={(e) => setScope(e.target.value)}>
            {scopes.personal ? <option value="">{t("meet.form.personal")}</option> : null}
            {scopes.adminOf.map((b) => (
              <option key={b.business.id} value={b.business.id}>
                {b.business.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field id="meet-start" label={t("meet.form.start")} hint={t("meet.form.startHint")}>
        <input id="meet-start" className="input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
      </Field>
      <Field id="meet-duration" label={t("meet.form.duration")}>
        <select id="meet-duration" className="input" value={minutes} disabled={!start} onChange={(e) => setMinutes(Number(e.target.value))}>
          {DURATIONS.map(([n, key]) => (
            <option key={n} value={n}>
              {t(key)}
            </option>
          ))}
        </select>
      </Field>
      <label className="switch-row meet-form__lobby">
        <span className="switch-row__label">{t("meet.form.lobby")}</span>
        <input type="checkbox" className="switch" checked={lobby} onChange={(e) => setLobby(e.target.checked)} />
      </label>
      <ErrorNote error={error} />
      <div className="form-grid__actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {t("meet.form.create")}
        </button>
      </div>
    </form>
  );
}

function MeetingCard({ meeting: m, businessName }: { meeting: Meeting; businessName: string | null }) {
  const { t, locale } = useI18n();
  const [panel, setPanel] = useState<"none" | "link" | "email">("none");
  const [links, setLinks] = useState<CreatedMeetingInvite[]>([]);
  const [msg, setMsg] = useState<{ key: TKey; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const when = formatMeetingWhen(m, locale);
  const status = STATUS[m.status];
  const ended = m.status === "ended";

  const guestLink = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const { invites } = await api.inviteToMeeting(m.id, {});
      setLinks(invites);
      setPanel("link");
      const copied = await copyText(invites[0]!.link);
      setMsg({ key: copied ? "meet.linkCopied" : "meet.linkReady", ok: true });
    } catch (e) {
      setMsg({ key: toErrorKey(e), ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`card meet-card${m.status === "live" ? " meet-card--live" : ""}`}>
      <div className="meet-card__head">
        <div className="meet-card__main">
          <p className="meet-card__title">{m.title}</p>
          <p className="muted small">
            {when ?? t("meet.noDate")}
            {" · "}
            {businessName ?? t("meet.personal")}
            {" · "}
            {t("meet.cap", { n: m.maxParticipants })}
          </p>
        </div>
        <span className="row">
          <Badge tone={status.tone}>{t(status.key)}</Badge>
          {m.lobbyEnabled && !ended ? <Badge tone="muted">{t("meet.lobbyOn")}</Badge> : null}
        </span>
      </div>
      {!ended ? (
        <div className="row row--wrap meet-card__actions">
          <Link to={`/reunions/${m.id}`} className="btn btn--primary btn--sm" aria-label={t("meet.joinNamed", { title: m.title })}>
            <Icon name="video" size={18} />
            {t("meet.join")}
          </Link>
          {m.canManage ? (
            <>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => void guestLink()} disabled={busy}>
                <Icon name="link" size={18} />
                {t("meet.copyLink")}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPanel(panel === "email" ? "none" : "email")} aria-expanded={panel === "email"}>
                <Icon name="messages" size={18} />
                {t("meet.inviteByEmail")}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {msg ? (
        <p className={msg.ok ? "ok-text small" : "note note--error"} role="status">
          {t(msg.key)}
        </p>
      ) : null}
      {panel === "link" && links[0] ? <LinkRow invite={links[0]} /> : null}
      {panel === "email" ? <EmailInvite meeting={m} onDone={(inv) => setLinks(inv)} links={links} onClose={() => setPanel("none")} /> : null}
    </li>
  );
}

function LinkRow({ invite }: { invite: CreatedMeetingInvite }) {
  const { t } = useI18n();
  const id = useId();
  const [copied, setCopied] = useState(false);
  return (
    <div className="meet-link">
      <label htmlFor={id} className="sr-only">
        {invite.email ? `${t("meet.linkLabel")} · ${invite.email}` : t("meet.linkLabel")}
      </label>
      {invite.email ? (
        <span className="meet-link__email small">
          {invite.email} · {invite.emailed ? <span className="ok-text">{t("meet.invite.emailed")}</span> : <span className="muted">{t("meet.invite.notEmailed")}</span>}
        </span>
      ) : null}
      <span className="row">
        <input id={id} className="input meet-link__input" readOnly value={invite.link} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => void copyText(invite.link).then(setCopied)}>
          <Icon name="copy" size={18} />
          {copied ? "✓" : t("meet.copy")}
        </button>
      </span>
    </div>
  );
}

function EmailInvite({ meeting, links, onDone, onClose }: { meeting: Meeting; links: CreatedMeetingInvite[]; onDone: (i: CreatedMeetingInvite[]) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [raw, setRaw] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);
  const sent = links.filter((l) => l.email);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const { valid, invalid } = parseEmails(raw);
    if (invalid.length) return setFieldError(t("meet.invite.invalid", { list: invalid.join(", ") }));
    if (!valid.length) return setFieldError(t("meet.invite.none"));
    setFieldError(null);
    setBusy(true);
    setError(null);
    try {
      const res = await api.inviteToMeeting(meeting.id, { emails: valid });
      onDone(res.invites);
      setRaw("");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.key : "error.generic");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="meet-invite" onSubmit={submit} noValidate aria-label={t("meet.inviteFor", { title: meeting.title })}>
      <Field id={`inv-${meeting.id}`} label={t("meet.invite.emails")} error={fieldError}>
        <textarea id={`inv-${meeting.id}`} className="input" rows={3} value={raw} onChange={(e) => setRaw(e.target.value)} />
      </Field>
      <ErrorNote error={error} />
      <div className="row row--end">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
          {t("meet.close")}
        </button>
        <button type="submit" className="btn btn--primary btn--sm" disabled={busy}>
          {t("meet.invite.send")}
        </button>
      </div>
      {sent.map((l) => (
        <LinkRow key={l.id} invite={l} />
      ))}
    </form>
  );
}
