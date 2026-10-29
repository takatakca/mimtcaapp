// Compte › Intégrations (/compte/integrations): the « Google Agenda » card. API: apps/api/src/routes/calendar.ts;
// spec, data flow and Law 25 notes: docs/MIMT-CALENDAR.md. Google sends the browser back here with ?gc=ok|error.
import { SUBSCRIPTION_ADD_ONS, formatCad, type CalendarSettings, type GoogleCalendarStatusResponse } from "@mimt/shared";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api } from "../api/client";
import { ApiClientError, toErrorKey } from "../api/errors";
import { Icon } from "../components/Icon";
import { useStepUp } from "../components/StepUp";
import { Badge, ErrorNote, Loading, PageHeader } from "../components/ui";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";
import { useAsync } from "../lib/useAsync";

type Toggle = keyof Pick<CalendarSettings, "syncCalls" | "syncMissedCalls" | "syncVoicemails" | "syncSummaries">;
const TOGGLES: Array<[Toggle, TKey]> = [
  ["syncCalls", "calendar.syncCalls"],
  ["syncMissedCalls", "calendar.syncMissedCalls"],
  ["syncVoicemails", "calendar.syncVoicemails"],
  ["syncSummaries", "calendar.syncSummaries"],
];

const RETURN_ERRORS: Record<string, TKey> = { denied: "calendar.error.denied", scope: "calendar.error.scope" };

export function Integrations() {
  const { t } = useI18n();
  return (
    <div className="page">
      <PageHeader
        title={t("integrations.title")}
        sub={t("integrations.lead")}
        actions={
          <Link to="/compte" className="btn btn--ghost btn--sm">
            {t("account.title")}
          </Link>
        }
      />
      <GoogleCalendarCard />
    </div>
  );
}

function GoogleCalendarCard() {
  const { t, lang, locale } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { guard, dialog } = useStepUp();
  // 404: the CALENDAR kill switch is off on the server: « bientôt ».
  const status = useAsync(
    () => api.googleCalendar().catch((e: unknown) => (e instanceof ApiClientError && e.status === 404 ? null : Promise.reject(e))),
    [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const [message, setMessage] = useState<TKey | null>(null);

  const gc = params.get("gc");
  const returned: { tone: "ok" | "error"; key: TKey } | null =
    gc === "ok" ? { tone: "ok", key: "calendar.ok" } : gc === "error" ? { tone: "error", key: RETURN_ERRORS[params.get("reason") ?? ""] ?? "calendar.error.generic" } : null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setError(toErrorKey(e));
    } finally {
      setBusy(false);
    }
  };

  const connect = () =>
    run(async () => {
      const { authUrl } = await guard(() => api.googleCalendarConnect());
      // Demo mode answers a same-origin path; the real API answers Google's consent page.
      if (authUrl.startsWith("/")) {
        navigate(authUrl);
        status.reload();
      } else window.location.assign(authUrl);
    });
  const disconnect = () => {
    if (!window.confirm(t("calendar.disconnectConfirm"))) return;
    void run(async () => {
      await guard(() => api.disconnectGoogleCalendar());
      setMessage("calendar.disconnected");
      status.reload();
    });
  };
  const save = (patch: Partial<CalendarSettings>) =>
    run(async () => {
      const next = await api.updateGoogleCalendar(patch);
      status.setData(() => next);
      setMessage("calendar.saved");
    });
  const buy = () =>
    run(async () => {
      const { checkoutUrl } = await api.checkout({ addon: "google_calendar", interval: "month", quantity: 1 });
      window.location.assign(checkoutUrl);
    });

  const s: GoogleCalendarStatusResponse | null | undefined = status.data;
  const price = formatCad(SUBSCRIPTION_ADD_ONS.google_calendar.monthlyPriceCents, lang);

  return (
    <section className="card" aria-labelledby="gcal-h">
      <h2 id="gcal-h" className="card__title">
        <Icon name="calendar" size={20} /> {t("calendar.title")}{" "}
        {s?.connected ? <Badge tone={s.status === "needs_reconnect" ? "warn" : "ok"}>{t(s.status === "needs_reconnect" ? "calendar.needsReconnect" : "calendar.connected")}</Badge> : null}
        {s && !s.configured ? <Badge tone="muted">{t("calendar.notConfigured")}</Badge> : null}
      </h2>
      <p className="muted small">{t("calendar.lead")}</p>
      {returned && !message ? (
        <p className={returned.tone === "ok" ? "ok-text" : "note note--warn"} role="status">
          {t(returned.key)}
        </p>
      ) : null}
      {status.loading ? <Loading /> : null}
      {s === null ? <p className="note note--info">{t("calendar.soon")}</p> : null}
      {s && !s.configured ? <p className="note note--info">{t("calendar.notConfiguredHint")}</p> : null}

      {s && s.configured && !s.entitled ? (
        <div className="stack">
          <p>
            <strong>{t(s.trialAvailable ? "calendar.offer" : "calendar.offerNoTrial", { price })}</strong>
          </p>
          {s.canBuy ? (
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void buy()}>
              {t(s.trialAvailable ? "calendar.startTrial" : "calendar.buy")}
            </button>
          ) : (
            <>
              <p className="muted small">{t("calendar.choosePlan")}</p>
              <Link to="/compte" className="btn btn--ghost">
                {t("calendar.seePlans")}
              </Link>
            </>
          )}
        </div>
      ) : null}

      {s && s.configured && s.entitled && !s.connected ? (
        <div className="stack">
          <p className="field__hint">{t("calendar.privacy")}</p>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void connect()}>
            {t("calendar.connect")}
          </button>
        </div>
      ) : null}

      {s?.connected ? (
        <div className="stack">
          {s.email ? <p>{t("calendar.account", { address: s.email })}</p> : null}
          <p className="muted small">
            {t("calendar.target")}
            {s.lastSyncAt ? ` · ${t("calendar.lastSync", { date: new Date(s.lastSyncAt).toLocaleString(locale) })}` : ""}
          </p>
          {s.status === "needs_reconnect" ? (
            <>
              <p className="note note--warn">{t("calendar.needsReconnectHint")}</p>
              <button type="button" className="btn btn--primary" disabled={busy || !s.entitled} onClick={() => void connect()}>
                {t("calendar.reconnect")}
              </button>
            </>
          ) : null}
          <fieldset className="stack">
            <legend className="switch-row__label">{t("calendar.settings")}</legend>
            {TOGGLES.map(([key, label]) => (
              <label key={key} className="switch-row">
                <span className="switch-row__label">{t(label)}</span>
                <input type="checkbox" role="switch" className="switch" checked={s.settings[key]} disabled={busy} onChange={(e) => void save({ [key]: e.target.checked })} />
              </label>
            ))}
            <label className="check">
              <input type="checkbox" checked={s.settings.includeContent} disabled={busy} onChange={(e) => void save({ includeContent: e.target.checked })} />
              <span>{t("calendar.includeContent")}</span>
            </label>
            <p className="field__hint">{t("calendar.includeContentHint")}</p>
          </fieldset>
          <button type="button" className="btn btn--danger" disabled={busy} onClick={disconnect}>
            {t("calendar.disconnect")}
          </button>
        </div>
      ) : null}

      {message ? (
        <p className="ok-text" role="status">
          {t(message)}
        </p>
      ) : null}
      <ErrorNote error={error ?? status.error} />
      {dialog}
    </section>
  );
}
