// Compte › Administration (/compte/admin), MIMT staff only: read-only Twilio checks and the import of a number that
// already exists in the API's Twilio account. API: apps/api/src/routes/adminTwilio.ts.
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import type { ImportNumberResponse } from "../api/admin";
import { ApiClientError, toErrorKey } from "../api/errors";
import { useStepUp } from "../components/StepUp";
import { Badge, ErrorNote, Loading, PageHeader } from "../components/ui";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";
import { useAsync } from "../lib/useAsync";

const ALLOWED_COUNTRIES = new Set(["CA", "US"]);

export function AdminTwilio() {
  const { t } = useI18n();
  const diag = useAsync(
    () => api.twilioDiagnostics().catch((e: unknown) => (e instanceof ApiClientError && e.status === 403 ? null : Promise.reject(e))),
    [],
  );
  const d = diag.data;

  return (
    <div className="page">
      <PageHeader
        title={t("admin.title")}
        sub={t("admin.lead")}
        actions={
          <Link to="/compte" className="btn btn--ghost btn--sm">
            {t("account.title")}
          </Link>
        }
      />
      {diag.loading ? <Loading /> : null}
      <ErrorNote error={diag.error} onRetry={diag.reload} />
      {d === null ? <p className="note">{t("admin.forbidden")}</p> : null}
      {d ? (
        <div className="stack">
          <ImportCard onDone={diag.reload} />
          <section className="card" aria-labelledby="adm-acct">
            <h2 id="adm-acct" className="card__title">
              {t("admin.account")}
            </h2>
            <p>
              {d.accountName ?? "—"} · …{d.accountSidEnd} · {d.accountStatus ?? "—"} · {d.accountType ?? "—"}
            </p>
            {d.balance ? (
              <p>
                {t("admin.balance")} : {d.balance.amount} {d.balance.currency}
              </p>
            ) : null}

            <h3>{t("admin.twimlApp")}</h3>
            {!d.twimlApp?.configured ? (
              <p className="note note--warn">{t("admin.twimlMissing")}</p>
            ) : d.twimlApp.voiceUrl === d.expected.outboundUrl ? (
              <Badge tone="ok">{t("admin.ok")}</Badge>
            ) : (
              <p className="note note--warn">
                {t("admin.twimlWrong")} <code>{d.expected.outboundUrl}</code>
              </p>
            )}

            <h3>{t("admin.countries")}</h3>
            <p>{d.voiceCountries.join(", ") || "—"}</p>
            {d.voiceCountries.some((c) => !ALLOWED_COUNTRIES.has(c)) ? <p className="note note--warn">{t("admin.countriesWarn")}</p> : null}

            <h3>{t("admin.triggers")}</h3>
            {d.usageTriggers.length ? (
              <ul>
                {d.usageTriggers.map((tr) => (
                  <li key={`${tr.name}-${tr.usageCategory}`}>
                    {tr.name} · {tr.usageCategory} · {tr.triggerValue} {tr.recurring ? `(${tr.recurring})` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="note note--warn">{t("admin.triggersNone")}</p>
            )}
          </section>

          <section className="card" aria-labelledby="adm-nums">
            <h2 id="adm-nums" className="card__title">
              {t("admin.numbers")}
            </h2>
            <ul className="list">
              {d.numbers.map((n) => (
                <li key={n.e164}>
                  <strong>{n.e164}</strong>{" "}
                  {n.voiceUrl === d.expected.voiceUrl ? <Badge tone="ok">{t("admin.ok")}</Badge> : <Badge tone="muted">{t("admin.differs")}</Badge>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function ImportCard({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { guard, dialog } = useStepUp();
  const [e164, setE164] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const [done, setDone] = useState<ImportNumberResponse | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    guard(() => api.importNumber(e164.trim()))
      .then((res) => {
        setDone(res);
        onDone();
      })
      .catch((err: unknown) => setError(toErrorKey(err)))
      .finally(() => setBusy(false));
  };

  return (
    <section className="card" aria-labelledby="adm-import">
      {dialog}
      <h2 id="adm-import" className="card__title">
        {t("admin.import.title")}
      </h2>
      <p className="muted">{t("admin.import.lead")}</p>
      <form className="form-grid" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="adm-e164">{t("admin.import.label")}</label>
          <input id="adm-e164" className="input" inputMode="tel" autoComplete="off" value={e164} onChange={(ev) => setE164(ev.target.value)} placeholder="+15799996789" />
        </div>
        <button type="submit" className="btn btn--primary" disabled={busy || !/^\+1\d{10}$/.test(e164.trim())}>
          {t("admin.import.submit")}
        </button>
      </form>
      <ErrorNote error={error} />
      {done ? (
        <div role="status">
          <p className="note">{t("admin.import.done")}</p>
          {done.warnings.length ? (
            <ul>
              {done.warnings.map((w) => (
                <li key={w}>{t(`admin.warn.${w}` as TKey)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
