// Call and voicemail settings (/compte/appels): forwarding, do not disturb, blocked numbers, custom
// voicemail greeting and voicemail by email. Rules come from @mimt/shared (callControls.ts, media.ts);
// the API enforces them again. 9-1-1 is never blocked, forwarded or sent to voicemail.
import {
  DEFAULT_CALL_SETTINGS,
  FORWARDING_TIMEOUT_MAX_S,
  FORWARDING_TIMEOUT_MIN_S,
  GREETING_MAX_S,
  MEDIA_LIMITS,
  WEEKDAYS,
  isValidHhmm,
  planHas,
  type BlockedCallAction,
  type CallSettingsPatch,
  type ForwardingMode,
  type VoicemailSettingsDto,
  type WeeklySchedule,
} from "@mimt/shared";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api, uploadFile } from "../api/client";
import { toErrorKey } from "../api/errors";
import { useSession } from "../auth/SessionProvider";
import { Icon } from "../components/Icon";
import { useStepUp } from "../components/StepUp";
import { Badge, Empty, ErrorNote, Field, Loading, PageHeader } from "../components/ui";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";
import { formatPhone, toDialable } from "../lib/dial";
import { useAsync } from "../lib/useAsync";

export function CallSettings() {
  const { t } = useI18n();
  const { me } = useSession();
  if (!me) return <Loading />;
  return (
    <div className="page">
      <PageHeader
        title={t("settings.title")}
        sub={
          <Link to="/compte" className="muted small">
            {t("settings.backToAccount")}
          </Link>
        }
      />
      <p className="note note--info">{t("settings.emergencyNote")}</p>
      <div className="grid grid--2">
        <ForwardingSection />
        <DndSection />
      </div>
      <div className="grid grid--2">
        <BlocksSection />
        <VoicemailSection />
      </div>
    </div>
  );
}

/** Saves a call-settings patch with PATCH /v1/me, then refreshes the session's copy. */
function useSaveCallSettings() {
  const { refreshMe } = useSession();
  // A new forwarding number is a sensitive action: the API may ask for a recent confirmation (docs/MIMT-SECURITY.md).
  const { guard, dialog } = useStepUp();
  const [status, setStatus] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (patch: CallSettingsPatch): Promise<boolean> => {
    setBusy(true);
    setStatus(null);
    try {
      await guard(() => api.updateMe(patch));
      await refreshMe();
      setStatus("settings.saved");
      return true;
    } catch (e) {
      setStatus(toErrorKey(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { status, busy, save, dialog };
}

function SaveStatus({ status }: { status: TKey | null }) {
  const { t } = useI18n();
  if (!status) return null;
  if (status === "settings.saved")
    return (
      <span className="ok-text" role="status">
        {t(status)}
      </span>
    );
  return <ErrorNote error={status} />;
}

function ForwardingSection() {
  const { t } = useI18n();
  const { me } = useSession();
  const current = (me?.callSettings ?? DEFAULT_CALL_SETTINGS).forwarding;
  const allowed = me ? planHas(me.account.plan, "call_forwarding") : false;
  const [mode, setMode] = useState<ForwardingMode>(current.mode);
  const [target, setTarget] = useState(current.target ? formatPhone(current.target) : "");
  const [timeoutS, setTimeoutS] = useState(String(current.timeoutS));
  const [fieldError, setFieldError] = useState<TKey | null>(null);
  const { status, busy, save, dialog } = useSaveCallSettings();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFieldError(null);
    let dest: string | null = null;
    if (target.trim()) {
      dest = toDialable(target);
      if (!dest || dest === "911") return setFieldError("settings.forwarding.invalidTarget");
    }
    if (mode !== "off" && !dest) return setFieldError("settings.forwarding.targetRequired");
    const seconds = Number(timeoutS);
    if (mode === "no_answer" && !(Number.isInteger(seconds) && seconds >= FORWARDING_TIMEOUT_MIN_S && seconds <= FORWARDING_TIMEOUT_MAX_S)) {
      return setFieldError("settings.forwarding.invalidTimeout");
    }
    await save({ forwarding: { mode, target: dest, ...(mode === "no_answer" ? { timeoutS: seconds } : {}) } });
  };

  return (
    <section className="card" aria-labelledby="fwd-h">
      <h2 id="fwd-h" className="card__title">
        {t("settings.forwarding.title")} {!allowed ? <Badge tone="muted">{t("settings.premium")}</Badge> : null}
      </h2>
      <p className="muted small">{t("settings.forwarding.intro")}</p>
      {!allowed ? <p className="note note--info">{t("settings.forwarding.planHint")}</p> : null}
      <form className="stack" onSubmit={submit} noValidate>
        <Field id="fwd-mode" label={t("settings.forwarding.mode")}>
          <select id="fwd-mode" className="input" value={mode} disabled={!allowed} onChange={(e) => setMode(e.target.value as ForwardingMode)}>
            <option value="off">{t("settings.forwarding.off")}</option>
            <option value="always">{t("settings.forwarding.always")}</option>
            <option value="no_answer">{t("settings.forwarding.noAnswer")}</option>
          </select>
        </Field>
        {mode !== "off" ? (
          <Field id="fwd-target" label={t("settings.forwarding.target")} hint={t("settings.forwarding.targetHint")}>
            <input id="fwd-target" className="input" type="tel" inputMode="tel" value={target} onChange={(e) => setTarget(e.target.value)} />
          </Field>
        ) : null}
        {mode === "no_answer" ? (
          <Field
            id="fwd-timeout"
            label={t("settings.forwarding.timeout")}
            hint={t("settings.forwarding.timeoutHint", { min: FORWARDING_TIMEOUT_MIN_S, max: FORWARDING_TIMEOUT_MAX_S })}
          >
            <input
              id="fwd-timeout"
              className="input"
              type="number"
              min={FORWARDING_TIMEOUT_MIN_S}
              max={FORWARDING_TIMEOUT_MAX_S}
              value={timeoutS}
              onChange={(e) => setTimeoutS(e.target.value)}
            />
          </Field>
        ) : null}
        {fieldError ? <p className="note note--error">{t(fieldError)}</p> : null}
        <div className="row row--wrap">
          <button type="submit" className="btn btn--primary btn--sm" disabled={busy || !allowed}>
            {t("common.save")}
          </button>
          <SaveStatus status={status} />
        </div>
      </form>
      {dialog}
    </section>
  );
}

/** The page edits one nightly range applied to every day; anything else set elsewhere shows as-is until saved. */
function everyDay(from: string, to: string): WeeklySchedule {
  return Object.fromEntries(WEEKDAYS.map((d) => [d, [{ open: from, close: to }]])) as WeeklySchedule;
}

function DndSection() {
  const { t } = useI18n();
  const { me } = useSession();
  const current = (me?.callSettings ?? DEFAULT_CALL_SETTINGS).dnd;
  const first = current.schedule ? WEEKDAYS.map((d) => current.schedule?.[d]?.[0]).find(Boolean) : undefined;
  const [enabled, setEnabled] = useState(current.enabled);
  const [scheduled, setScheduled] = useState(current.schedule !== null);
  const [from, setFrom] = useState(first?.open ?? "22:00");
  const [to, setTo] = useState(first?.close ?? "07:00");
  const [fieldError, setFieldError] = useState<TKey | null>(null);
  const { status, busy, save } = useSaveCallSettings();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFieldError(null);
    if (enabled && scheduled && (!isValidHhmm(from) || !isValidHhmm(to) || from === to)) return setFieldError("settings.dnd.invalidHours");
    await save({ dnd: { enabled, schedule: enabled && scheduled ? everyDay(from, to) : null } });
  };

  return (
    <section className="card" aria-labelledby="dnd-h">
      <h2 id="dnd-h" className="card__title">
        {t("settings.dnd.title")} {current.enabled ? <Badge tone="warn">{t("settings.dnd.on")}</Badge> : null}
      </h2>
      <p className="muted small">{t("settings.dnd.intro")}</p>
      <form className="stack" onSubmit={submit} noValidate>
        <label className="switch-row">
          <span className="switch-row__label">{t("settings.dnd.enable")}</span>
          <input type="checkbox" role="switch" className="switch" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        </label>
        {enabled ? (
          <>
            <label className="check">
              <input type="checkbox" checked={scheduled} onChange={(e) => setScheduled(e.target.checked)} />
              <span>{t("settings.dnd.scheduled")}</span>
            </label>
            {scheduled ? (
              <div className="row row--wrap">
                <Field id="dnd-from" label={t("settings.dnd.from")}>
                  <input id="dnd-from" className="input" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
                </Field>
                <Field id="dnd-to" label={t("settings.dnd.to")}>
                  <input id="dnd-to" className="input" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
                </Field>
              </div>
            ) : null}
            <p className="field__hint">{scheduled ? t("settings.dnd.scheduleHint") : t("settings.dnd.alwaysHint")}</p>
          </>
        ) : null}
        {fieldError ? <p className="note note--error">{t(fieldError)}</p> : null}
        <div className="row row--wrap">
          <button type="submit" className="btn btn--primary btn--sm" disabled={busy}>
            {t("common.save")}
          </button>
          <SaveStatus status={status} />
        </div>
      </form>
    </section>
  );
}

function BlocksSection() {
  const { t, locale } = useI18n();
  const { me } = useSession();
  const blocks = useAsync(() => api.blocks(), []);
  const action = (me?.callSettings ?? DEFAULT_CALL_SETTINGS).blockedCallAction;
  const actionSave = useSaveCallSettings();
  const [number, setNumber] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const dest = toDialable(number);
    if (dest === "911") return setError("error.cannotBlockEmergency");
    if (!dest) return setError("settings.blocks.invalidNumber");
    setBusy(true);
    setError(null);
    try {
      await api.blockNumber({ number: dest, label: label.trim() || null });
      setNumber("");
      setLabel("");
      blocks.reload();
    } catch (err) {
      setError(toErrorKey(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.unblock(id);
      blocks.reload();
    } catch (err) {
      setError(toErrorKey(err));
    }
  };

  const list = blocks.data?.blocks ?? [];
  return (
    <section className="card" aria-labelledby="blocks-h">
      <h2 id="blocks-h" className="card__title">
        {t("settings.blocks.title")}
      </h2>
      <p className="muted small">{t("settings.blocks.intro")}</p>
      <Field id="blocked-action" label={t("settings.blocks.action")}>
        <select
          id="blocked-action"
          className="input"
          value={action}
          disabled={actionSave.busy}
          onChange={(e) => void actionSave.save({ blockedCallAction: e.target.value as BlockedCallAction })}
        >
          <option value="reject">{t("settings.blocks.reject")}</option>
          <option value="voicemail">{t("settings.blocks.voicemail")}</option>
        </select>
      </Field>
      <SaveStatus status={actionSave.status} />
      <ErrorNote error={blocks.error} onRetry={blocks.reload} />
      {blocks.loading && !blocks.data ? <Loading /> : null}
      {blocks.data && list.length === 0 ? <Empty>{t("settings.blocks.empty")}</Empty> : null}
      {list.length > 0 ? (
        <ul className="list list--compact" aria-label={t("settings.blocks.listLabel")}>
          {list.map((b) => (
            <li key={b.id} className="list__row">
              <span className="list__main">
                <span className="list__title">{formatPhone(b.e164)}</span>
                <span className="list__sub">
                  {b.label ? `${b.label} · ` : ""}
                  {new Date(b.createdAt).toLocaleDateString(locale)}
                </span>
              </span>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => void remove(b.id)}
                aria-label={t("settings.blocks.unblockNumber", { number: formatPhone(b.e164) })}
              >
                {t("settings.blocks.unblock")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form className="stack" onSubmit={add} noValidate>
        <Field id="block-number" label={t("settings.blocks.number")}>
          <input id="block-number" className="input" type="tel" inputMode="tel" value={number} onChange={(e) => setNumber(e.target.value)} />
        </Field>
        <Field id="block-label" label={t("settings.blocks.label")}>
          <input id="block-label" className="input" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        {error ? <p className="note note--error">{t(error)}</p> : null}
        <div>
          <button type="submit" className="btn btn--primary btn--sm" disabled={busy || !number.trim()}>
            {t("settings.blocks.add")}
          </button>
        </div>
      </form>
    </section>
  );
}

/** Normalizes the browser's audio type to one MEDIA_LIMITS.greeting accepts, or null. */
export function greetingContentType(file: Pick<File, "type" | "name">): string | null {
  const type = file.type === "audio/x-wav" || file.type === "audio/wave" ? "audio/wav" : file.type === "audio/mp3" ? "audio/mpeg" : file.type;
  if ((MEDIA_LIMITS.greeting.contentTypes as readonly string[]).includes(type)) return type;
  if (!type && /\.mp3$/i.test(file.name)) return "audio/mpeg";
  if (!type && /\.wav$/i.test(file.name)) return "audio/wav";
  return null;
}

function VoicemailSection() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<VoicemailSettingsDto | null>(null);
  const [status, setStatus] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    api
      .voicemailSettings()
      .then(setSettings)
      .catch((e: unknown) => setStatus(toErrorKey(e)));
  }, []);

  const run = async (fn: () => Promise<VoicemailSettingsDto | void>, done: TKey) => {
    setBusy(true);
    setStatus(null);
    try {
      const next = await fn();
      if (next) setSettings(next);
      setStatus(done);
    } catch (e) {
      setStatus(toErrorKey(e));
    } finally {
      setBusy(false);
    }
  };

  const upload = (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    const contentType = greetingContentType(file);
    if (!contentType) return setStatus("settings.vm.badType");
    if (file.size > MEDIA_LIMITS.greeting.maxBytes) return setStatus("settings.vm.tooBig");
    void run(async () => {
      const up = await api.createUpload({ purpose: "greeting", contentType, sizeBytes: file.size });
      await uploadFile(up, file);
      const next = await api.setGreeting({ mediaId: up.mediaId });
      setFile(null);
      return next;
    }, "settings.vm.greetingSaved");
  };

  if (!settings) {
    return (
      <section className="card" aria-labelledby="vm-h">
        <h2 id="vm-h" className="card__title">
          {t("settings.vm.title")}
        </h2>
        {status ? <ErrorNote error={status} /> : <Loading />}
      </section>
    );
  }

  const done = status === "settings.vm.greetingSaved" || status === "settings.vm.greetingReset" || status === "settings.vm.calling" || status === "settings.saved";
  return (
    <section className="card" aria-labelledby="vm-h">
      <h2 id="vm-h" className="card__title">
        {t("settings.vm.title")}
      </h2>

      <h3>{t("settings.vm.greeting")}</h3>
      {!settings.available.greeting ? (
        <p className="note note--info">{t("settings.vm.greetingPlanHint")}</p>
      ) : (
        <>
          <p className="muted small">
            {settings.greeting ? t("settings.vm.greetingCustom") : t("settings.vm.greetingDefault")}
          </p>
          {settings.greeting?.url ? <audio controls preload="none" src={settings.greeting.url} aria-label={t("settings.vm.greetingListen")} /> : null}
          <form className="stack" onSubmit={upload}>
            <Field id="greeting-file" label={t("settings.vm.upload")} hint={t("settings.vm.uploadHint", { seconds: GREETING_MAX_S })}>
              <input id="greeting-file" className="input" type="file" accept="audio/mpeg,audio/wav,.mp3,.wav" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Field>
            <div className="row row--wrap">
              <button type="submit" className="btn btn--primary btn--sm" disabled={busy || !file}>
                {t("settings.vm.uploadButton")}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void run(() => api.recordGreetingByCall().then(() => undefined), "settings.vm.calling")}>
                <Icon name="phone" size={16} /> {t("settings.vm.recordByCall")}
              </button>
              {settings.greeting ? (
                <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void run(() => api.resetGreeting(), "settings.vm.greetingReset")}>
                  {t("settings.vm.reset")}
                </button>
              ) : null}
            </div>
          </form>
        </>
      )}

      <h3>{t("settings.vm.email")}</h3>
      {!settings.available.email ? (
        <p className="note note--info">{t("settings.vm.emailPlanHint")}</p>
      ) : (
        <label className="switch-row">
          <span>
            <span className="switch-row__label">{t("settings.vm.emailToggle")}</span>
            <span className="field__hint">{settings.email ? t("settings.vm.emailTo", { address: settings.email }) : t("settings.vm.noEmail")}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={settings.emailEnabled}
            disabled={busy || (!settings.email && !settings.emailEnabled)}
            onChange={(e) => {
              const emailEnabled = e.target.checked;
              void run(() => api.updateVoicemailSettings({ emailEnabled }), "settings.saved");
            }}
          />
        </label>
      )}
      {status ? (
        done ? (
          <p className="ok-text" role="status">
            {t(status)}
          </p>
        ) : (
          <ErrorNote error={status} />
        )
      ) : null}
    </section>
  );
}
