// « MIMT Connect » (docs/MIMT-CONNECT.md), owner only: GET /v1/business/:id/partner and the key / webhook routes.
// A key and a webhook secret are shown once, right after they are made; afterwards only the key's prefix is listed.
// The business becomes a partner on MIMT's side (admin): until then the API answers 404 and this page says so.
import type { PartnerApiKeyCreated, PartnerCallBilling, PartnerOverviewResponse } from "@mimt/shared";
import { useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { ApiClientError, toErrorKey } from "../../api/errors";
import { useStepUp } from "../../components/StepUp";
import { Badge, Empty, ErrorNote, Field, Loading } from "../../components/ui";
import { useI18n } from "../../i18n/I18nProvider";
import type { TKey } from "../../i18n/core";
import { formatPhone } from "../../lib/dial";
import { formatDateTime, formatDuration } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useBusiness } from "./shared";

const BILLING: Record<PartnerCallBilling, { key: TKey; tone: "info" | "ok" | "warn" | "muted" }> = {
  billed: { key: "partner.billing.billed", tone: "ok" },
  partial: { key: "partner.billing.partial", tone: "warn" },
  unbilled: { key: "partner.billing.unbilled", tone: "warn" },
  free: { key: "partner.billing.free", tone: "muted" },
  pending: { key: "partner.billing.pending", tone: "info" },
};

/** The overview, or null when the business is not a partner (404). */
async function loadPartner(id: string): Promise<PartnerOverviewResponse | null> {
  try {
    return await api.partner(id);
  } catch (e) {
    if (e instanceof ApiClientError && e.status === 404) return null;
    throw e;
  }
}

/** A value shown once, with a copy button. */
function ShownOnce({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="note note--warn" role="status">
      <p className="small">{label}</p>
      <code className="mono" style={{ wordBreak: "break-all" }}>
        {value}
      </code>{" "}
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => void navigator.clipboard?.writeText(value).then(() => setCopied(true), () => undefined)}
      >
        {copied ? t("partner.copied") : t("partner.copy")}
      </button>
    </div>
  );
}

export function Partner() {
  const { t, locale } = useI18n();
  const { id } = useBusiness();
  const data = useAsync(() => loadPartner(id), [id]);
  const [label, setLabel] = useState("");
  const [newKey, setNewKey] = useState<PartnerApiKeyCreated | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [rotateSecret, setRotateSecret] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [msg, setMsg] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);
  // Keys and the webhook secret need a recent passkey or SMS confirmation (API: 403 step_up_required).
  const { guard, dialog } = useStepUp();

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      data.reload();
    } catch (e) {
      setMsg(toErrorKey(e));
    } finally {
      setBusy(false);
    }
  }

  const createKey = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setNewKey(await guard(() => api.createPartnerKey(id, label.trim() || null)));
      setLabel("");
    });
  };
  const rotateKey = (keyId: string) => void run(async () => setNewKey(await guard(() => api.rotatePartnerKey(id, keyId))));
  const revokeKey = (keyId: string) => {
    if (!window.confirm(t("partner.keys.revokeConfirm"))) return;
    void run(() => api.revokePartnerKey(id, keyId));
  };
  const saveWebhook = (e: FormEvent, remove = false) => {
    e.preventDefault();
    const target = remove ? null : (url ?? data.data?.partner.webhookUrl ?? "").trim() || null;
    void run(async () => {
      const res = await guard(() => api.setPartnerWebhook(id, target, rotateSecret));
      setSecret(res.secret);
      setRotateSecret(false);
      setUrl(null);
      setMsg("partner.webhook.saved");
    });
  };

  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorNote error={data.error} onRetry={data.reload} />;
  const view = data.data;
  if (!view) {
    return (
      <section className="card">
        <h2 className="card__title">{t("partner.title")}</h2>
        <p className="muted small">{t("partner.lead")}</p>
        <p className="note note--info">{t("partner.notPartner")}</p>
      </section>
    );
  }
  const { partner, apiKeys, calls } = view;

  return (
    <div className="stack">
      {dialog}
      <section className="card" aria-labelledby="pt-credits">
        <h2 id="pt-credits" className="card__title">
          {t("partner.title")} · {t("partner.credits.title")}
        </h2>
        <p className="muted small">{t("partner.lead")}</p>
        {partner.status === "suspended" ? <p className="note note--error">{t("partner.suspended")}</p> : null}
        <p className="list__title">{t("partner.credits.balance", { credits: partner.balance.toLocaleString(locale) })}</p>
        <p className="muted small">{t("partner.credits.rate", { credits: partner.creditPerMinute })}</p>
        {partner.balance === 0 ? <p className="note note--warn">{t("partner.credits.empty")}</p> : null}
      </section>

      <section className="card" aria-labelledby="pt-keys">
        <h2 id="pt-keys" className="card__title">
          {t("partner.keys.title")}
        </h2>
        <p className="muted small">{t("partner.keys.lead")}</p>
        {newKey ? <ShownOnce label={t("partner.keys.shownOnce")} value={newKey.key} /> : null}
        {apiKeys.length === 0 ? <Empty>{t("partner.keys.empty")}</Empty> : null}
        <ul className="list">
          {apiKeys.map((k) => (
            <li key={k.id} className="list__row">
              <span className="list__main">
                <span className="list__title">
                  <code className="mono">{k.prefix}…</code> {k.label ?? ""}{" "}
                  <Badge tone={k.revokedAt ? "muted" : "ok"}>{t(k.revokedAt ? "partner.keys.revoked" : "partner.keys.active")}</Badge>
                </span>
                <span className="list__sub">
                  {formatDateTime(k.createdAt, locale)} ·{" "}
                  {k.lastUsedAt ? t("partner.keys.lastUsed", { date: formatDateTime(k.lastUsedAt, locale) }) : t("partner.keys.neverUsed")}
                </span>
              </span>
              {k.revokedAt ? null : (
                <span className="row">
                  <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => rotateKey(k.id)}>
                    {t("partner.keys.rotate")}
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => revokeKey(k.id)}>
                    {t("partner.keys.revoke")}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
        <form className="form-grid" onSubmit={createKey} noValidate>
          <Field id="pt-key-label" label={t("partner.keys.label")}>
            <input id="pt-key-label" className="input" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <div className="form-grid__actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {t("partner.keys.create")}
            </button>
          </div>
        </form>
      </section>

      <section className="card" aria-labelledby="pt-hook">
        <h2 id="pt-hook" className="card__title">
          {t("partner.webhook.title")}
        </h2>
        <p className="muted small">{t("partner.webhook.lead")}</p>
        {secret ? <ShownOnce label={t("partner.webhook.secret")} value={secret} /> : null}
        <form className="form-grid" onSubmit={(e) => saveWebhook(e)} noValidate>
          <Field id="pt-hook-url" label={t("partner.webhook.url")}>
            <input
              id="pt-hook-url"
              className="input"
              type="url"
              inputMode="url"
              placeholder="https://"
              value={url ?? partner.webhookUrl ?? ""}
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>
          <label className="row small">
            <input type="checkbox" checked={rotateSecret} onChange={(e) => setRotateSecret(e.target.checked)} /> {t("partner.webhook.rotate")}
          </label>
          <div className="form-grid__actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {t("partner.webhook.save")}
            </button>
            {partner.webhookUrl ? (
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={(e) => saveWebhook(e, true)}>
                {t("partner.webhook.remove")}
              </button>
            ) : null}
          </div>
        </form>
        {msg ? (
          <p className={msg === "partner.webhook.saved" ? "ok-text" : "note note--error"} role="status">
            {t(msg)}
          </p>
        ) : null}
      </section>

      <section className="card" aria-labelledby="pt-calls">
        <h2 id="pt-calls" className="card__title">
          {t("partner.calls.title")}
        </h2>
        {calls.length === 0 ? <Empty>{t("partner.calls.empty")}</Empty> : null}
        <ul className="list">
          {calls.map((c) => (
            <li key={c.id} className="list__row">
              <span className="list__main">
                <span className="list__title">
                  {formatPhone(c.from)} · {c.externalId ? `${t("partner.calls.member")} ${c.externalId}` : t("partner.calls.nobody")}
                </span>
                <span className="list__sub">
                  {formatDateTime(c.startedAt, locale)}
                  {c.huntGroup ? ` · ${c.huntGroup}` : ""}
                  {c.durationS ? ` · ${formatDuration(c.durationS)}` : ""}
                  {" · "}
                  {t("partner.calls.credits", { credits: c.credits })}
                </span>
              </span>
              <Badge tone={BILLING[c.billing].tone}>{t(BILLING[c.billing].key)}</Badge>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
