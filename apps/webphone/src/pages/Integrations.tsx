// Compte › Intégrations (/compte/integrations): the « Google Agenda » card (API apps/api/src/routes/calendar.ts; spec,
// data flow and Law 25 notes: docs/MIMT-CALENDAR.md; Google sends the browser back here with ?gc=ok|error) and the
// « Partenaires » card: MIMT Connect account links the person approved, each access (scope) revocable on its own,
// the consent receipt, the partner's access log, and the person's own availability for the partner's hunt groups,
// which wins over the partner's setting (docs/MIMT-CONNECT.md « Consentement »).
import {
  PARTNER_AVAILABILITY_STATUSES,
  PARTNER_SCOPE_TEXT,
  SUBSCRIPTION_ADD_ONS,
  formatCad,
  type CalendarSettings,
  type GoogleCalendarStatusResponse,
  type MyPartnerLinkDto,
  type PartnerAccessLogResponse,
  type PartnerAvailabilityStatus,
  type PartnerScope,
} from "@mimt/shared";
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
      <PartnersCard />
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

function PartnersCard() {
  const { t, lang, locale } = useI18n();
  const L = lang === "en" ? "en" : "fr";
  // 404: the PARTNERS kill switch is off on the server: « bientôt ».
  const links = useAsync(
    () => api.myPartnerLinks().catch((e: unknown) => (e instanceof ApiClientError && e.status === 404 ? null : Promise.reject(e))),
    [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const [message, setMessage] = useState<TKey | null>(null);
  const [logs, setLogs] = useState<Record<string, PartnerAccessLogResponse | undefined>>({});

  const act = async (fn: () => Promise<void>, done: TKey) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
      setMessage(done);
      links.reload();
    } catch (e) {
      setError(toErrorKey(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = (id: string, partner: string) => {
    if (!window.confirm(t("partners.revokeConfirm", { partner }))) return;
    void act(() => api.revokePartnerLink(id), "partners.revoked");
  };

  const revokeScope = (l: MyPartnerLinkDto, scope: PartnerScope) => {
    const label = PARTNER_SCOPE_TEXT[scope][L].label;
    const key: TKey =
      l.scopes.length === 1 ? "partners.scopes.revokeLastConfirm" : l.requiredScopes.includes(scope) ? "partners.scopes.revokeRequiredConfirm" : "partners.scopes.revokeConfirm";
    if (!window.confirm(t(key, { partner: l.partnerName, scope: label }))) return;
    void act(async () => {
      const res = await api.revokePartnerScope(l.id, scope);
      if (res.unlinked) setLogs((prev) => ({ ...prev, [l.id]: undefined }));
    }, l.scopes.length === 1 ? "partners.revoked" : "partners.scopes.revoked");
  };

  const toggleLog = async (id: string) => {
    if (logs[id]) {
      setLogs((prev) => ({ ...prev, [id]: undefined }));
      return;
    }
    setError(null);
    try {
      const log = await api.partnerAccessLog(id);
      setLogs((prev) => ({ ...prev, [id]: log }));
    } catch (e) {
      setError(toErrorKey(e));
    }
  };

  const setStatus = (id: string, value: string) =>
    void act(() => api.setPartnerAvailability(id, { status: value === "" ? null : (value as PartnerAvailabilityStatus) }).then(() => undefined), "partners.availability.saved");

  const date = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const scopeList = (scopes: PartnerScope[]) => (scopes.length ? scopes.map((s) => PARTNER_SCOPE_TEXT[s][L].label).join(", ") : t("partners.receipt.none"));
  const list = links.data?.links;
  return (
    <section className="card" aria-labelledby="partners-h">
      <h2 id="partners-h" className="card__title">
        <Icon name="link" size={20} /> {t("partners.title")}
      </h2>
      <p className="muted small">{t("partners.lead")}</p>
      {links.loading ? <Loading /> : null}
      {links.data === null ? <p className="note note--info">{t("partners.soon")}</p> : null}
      {list && !list.length ? <p className="muted">{t("partners.empty")}</p> : null}
      {list?.length ? (
        <ul className="stack">
          {list.map((l) => {
            const log = logs[l.id];
            return (
              <li key={l.id} className="stack">
                <strong>{t("partners.item", { partner: l.partnerName, externalId: l.externalId })}</strong>
                {l.partnerLegalName && l.privacyContactEmail ? (
                  <span className="muted small">{t("partners.legalName", { name: l.partnerLegalName, contact: l.privacyContactEmail })}</span>
                ) : null}
                <span className="muted small">
                  {l.lineNumber ? t("partners.line", { number: l.lineNumber }) : t("partners.noLine")} ·{" "}
                  {t("partners.since", { date: new Date(l.createdAt).toLocaleDateString(locale) })}
                </span>
                {!l.consentCurrent ? <p className="note note--info">{t("partners.outdated")}</p> : null}

                <div className="stack">
                  <strong>{t("partners.scopes.title")}</strong>
                  <ul className="stack">
                    {l.scopes.map((s) => (
                      <li key={s} className="stack">
                        <span>
                          {PARTNER_SCOPE_TEXT[s][L].label} {l.requiredScopes.includes(s) ? <Badge tone="warn">{t("partnerLink.required")}</Badge> : null}
                        </span>
                        <span className="muted small">{PARTNER_SCOPE_TEXT[s][L].sees}</span>
                        {l.purposes[s] ? <span className="muted small">{t("partners.scopes.purpose", { purpose: l.purposes[s]! })}</span> : null}
                        <div>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={busy}
                            aria-label={`${t("partners.scopes.revoke")} : ${PARTNER_SCOPE_TEXT[s][L].label}`}
                            onClick={() => revokeScope(l, s)}
                          >
                            {t("partners.scopes.revoke")}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>

                {l.receipt ? (
                  <details className="details">
                    <summary>{t("partners.receipt.title")}</summary>
                    <div className="stack small">
                      <span>
                        {t(`partners.receipt.action.${l.receipt.action}`)} · {t("partners.receipt.when", { date: date(l.receipt.createdAt) })}
                      </span>
                      <span>{t("partners.receipt.scopes", { list: scopeList(l.receipt.scopes) })}</span>
                      <span>{t("partners.receipt.version", { version: l.receipt.consentVersion, set: String(l.receipt.scopeSetVersion) })}</span>
                      {l.receipt.termsVersion ? <span>{t("partners.receipt.terms", { version: l.receipt.termsVersion })}</span> : null}
                      <span>
                        {t("partners.receipt.device", {
                          device: l.receipt.device ?? t("partners.receipt.unknown"),
                          network: l.receipt.network ?? t("partners.receipt.unknown"),
                        })}
                      </span>
                    </div>
                  </details>
                ) : null}

                <div className="field">
                  <label htmlFor={`avail-${l.id}`}>{t("partners.availability.label")}</label>
                  <select id={`avail-${l.id}`} className="input" value={l.userStatus ?? ""} disabled={busy} onChange={(e) => setStatus(l.id, e.target.value)}>
                    <option value="">{t("partners.availability.partner")}</option>
                    {PARTNER_AVAILABILITY_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t(`partners.availability.${s}`)}
                      </option>
                    ))}
                  </select>
                  <span className="muted small">
                    {t("partners.availability.now", { status: t(`partners.availability.${l.effectiveStatus}`) })} · {t("partners.availability.hint")}
                  </span>
                </div>

                <div>
                  <button type="button" className="btn btn--ghost btn--sm" aria-expanded={Boolean(log)} onClick={() => void toggleLog(l.id)}>
                    {log ? t("partners.log.hide") : t("partners.log.show")}
                  </button>
                </div>
                {log ? (
                  <div className="stack" aria-label={t("partners.log.title")}>
                    <strong>{t("partners.log.title")}</strong>
                    <span className="muted small">{t("partners.log.lead", { days: String(log.retentionDays) })}</span>
                    {log.entries.length ? (
                      <ul className="stack small">
                        {log.entries.map((e, i) => (
                          <li key={`${e.at}-${i}`}>
                            {date(e.at)} · {PARTNER_SCOPE_TEXT[e.scope][L].label} · <code>{e.route}</code>{" "}
                            {e.outcome === "denied" ? <Badge tone="error">{t("partners.log.denied")}</Badge> : <Badge tone="muted">{t("partners.log.allowed")}</Badge>}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="muted small">{t("partners.log.empty")}</span>
                    )}
                  </div>
                ) : null}

                <div>
                  <button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={() => revoke(l.id, l.partnerName)}>
                    {t("partners.revoke")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {message ? (
        <p className="ok-text" role="status">
          {t(message)}
        </p>
      ) : null}
      <ErrorNote error={error ?? links.error} />
    </section>
  );
}
