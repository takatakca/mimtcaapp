import { AI_CONSENT_KIND, PLANS, formatCad, type AiStatusResponse, type E911NoticeResponse, type PaidPlanCode, type UserConsentKind } from "@mimt/shared";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api/client";
import { ApiClientError, toErrorKey } from "../api/errors";
import { useSession } from "../auth/SessionProvider";
import { Icon } from "../components/Icon";
import { Badge, ErrorNote, Field, Loading, PageHeader, UsageBar } from "../components/ui";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";
import { PROVINCES, normalizePostalCode } from "../lib/address";
import { formatPhone } from "../lib/dial";
import { usageRows } from "../lib/usage";

import { useAsync } from "../lib/useAsync";

const USAGE_LABEL: Record<"outboundMinutes" | "inboundMinutes" | "outboundSms", TKey> = {
  outboundMinutes: "account.usageOutMin",
  inboundMinutes: "account.usageInMin",
  outboundSms: "account.usageSms",
};

export function Account() {
  const { t, lang, setLang } = useI18n();
  const { me, signOut } = useSession();
  if (!me) return <Loading />;
  const plan = PLANS[me.account.plan];
  const rows = usageRows(me.account.plan, me.usage);
  const upgrades: PaidPlanCode[] = me.account.plan === "free" ? ["lock", "premium"] : me.account.plan === "lock" ? ["premium"] : [];

  return (
    <div className="page">
      <PageHeader title={t("account.title")} />
      <div className="grid grid--2">
        <section className="card" aria-labelledby="plan-h">
          <h2 id="plan-h" className="card__title">
            {t("account.plan")}
          </h2>
          <p className="plan-name">{plan.name[lang]}</p>
          <p className="muted">
            {plan.monthlyPriceCents ? t("account.perMonth", { price: formatCad(plan.monthlyPriceCents, lang) }) : t("account.free")}
          </p>
          {me.numbers[0] ? (
            <p>
              {t("account.number")} : <strong>{formatPhone(me.numbers[0].e164)}</strong>
            </p>
          ) : null}
          <div className="row row--wrap">
            {upgrades.map((p) => (
              <UpgradeButton key={p} plan={p} />
            ))}
            {me.account.plan !== "free" ? <PortalButton /> : null}
          </div>
          {upgrades.length ? <p className="field__hint">{t("account.upgradeHint")}</p> : null}
        </section>
        <section className="card" aria-labelledby="usage-h">
          <h2 id="usage-h" className="card__title">
            {t("account.usage")}
          </h2>
          {rows.map(({ key, ...r }) => (
            <UsageBar key={key} label={t(USAGE_LABEL[key])} {...r} />
          ))}
          {rows.some((r) => r.level === "full") ? (
            <p className="note note--error">{t("account.usageFull")}</p>
          ) : rows.some((r) => r.level === "warn") ? (
            <p className="note note--warn">{t("account.usageWarn")}</p>
          ) : null}
        </section>
      </div>

      <E911Section />

      <div className="grid grid--2">
        <ConsentsSection />
        <section className="card" aria-labelledby="settings-h">
          <h2 id="settings-h" className="card__title">
            {t("account.settings")}
          </h2>
          <div className="field">
            <label htmlFor="lang">{t("account.language")}</label>
            <select id="lang" className="input" value={lang} onChange={(e) => setLang(e.target.value as "fr" | "en")}>
              <option value="fr">{t("account.languageFr")}</option>
              <option value="en">{t("account.languageEn")}</option>
            </select>
          </div>
          <DataSection />
          <button type="button" className="btn btn--ghost" onClick={() => void signOut()}>
            <Icon name="logout" size={16} /> {t("account.logout")}
          </button>
          <p className="muted small">
            {t("account.complaints")} — {t("account.complaintsHint")}
          </p>
        </section>
      </div>
    </div>
  );
}

function UpgradeButton({ plan }: { plan: PaidPlanCode }) {
  const { t, lang } = useI18n();
  const [error, setError] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn--primary btn--sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const { checkoutUrl } = await api.checkout({ plan, interval: "month", quantity: 1 });
            window.location.assign(checkoutUrl);
          } catch (e) {
            setError(toErrorKey(e));
            setBusy(false);
          }
        }}
      >
        {t("account.upgrade", { plan: PLANS[plan].name[lang] })}
      </button>
      <ErrorNote error={error} />
    </>
  );
}

function PortalButton() {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="btn btn--ghost btn--sm"
      onClick={async () => {
        const { portalUrl } = await api.billingPortal();
        window.location.assign(portalUrl);
      }}
    >
      {t("account.billingPortal")}
    </button>
  );
}

function E911Section() {
  const { t, locale } = useI18n();
  const { me, refreshMe } = useSession();
  const addr = useAsync(
    () => api.getE911Address().catch((e: unknown) => (e instanceof ApiClientError && e.status === 404 ? null : Promise.reject(e))),
    [],
  );
  const [form, setForm] = useState({ street: "", unit: "", city: "", province: "QC", postalCode: "" });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const [postalError, setPostalError] = useState(false);
  const [notice, setNotice] = useState<E911NoticeResponse | null>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    const a = addr.data;
    if (a) setForm({ street: a.street, unit: a.unit ?? "", city: a.city, province: a.province, postalCode: a.postalCode });
  }, [addr.data]);

  useEffect(() => {
    if (me && !me.e911.noticeAccepted) api.e911Notice(locale).then(setNotice).catch(() => setNotice(null));
  }, [me, locale]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const postal = normalizePostalCode(form.postalCode);
    setPostalError(!postal);
    if (!postal || !form.street.trim() || !form.city.trim()) return;
    setError(null);
    try {
      await api.putE911Address({ street: form.street.trim(), unit: form.unit.trim() || undefined, city: form.city.trim(), province: form.province, postalCode: postal, country: "CA" });
      setSaved(true);
      await refreshMe();
    } catch (err) {
      setError(toErrorKey(err));
    }
  };

  const text = notice ? (locale === "fr-CA" ? notice.fr : notice.en) : null;
  return (
    <section className="card" id="e911" aria-labelledby="e911-h">
      <h2 id="e911-h" className="card__title">
        {t("address.title")}{" "}
        {me?.e911.addressRegistered ? <Badge tone="ok">{t("address.registered")}</Badge> : <Badge tone="warn">{t("address.missing")}</Badge>}
      </h2>
      <p className="muted">{t("address.intro")}</p>
      <form className="form-grid" onSubmit={save} noValidate>
        <Field id="street" label={t("address.street")}>
          <input id="street" className="input" autoComplete="address-line1" placeholder={t("address.streetPlaceholder")} value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} required />
        </Field>
        <Field id="unit" label={t("address.unit")}>
          <input id="unit" className="input" autoComplete="address-line2" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
        </Field>
        <Field id="city" label={t("address.city")}>
          <input id="city" className="input" autoComplete="address-level2" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} required />
        </Field>
        <Field id="province" label={t("address.province")}>
          <select id="province" className="input" value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })}>
            {PROVINCES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </Field>
        <Field id="postal" label={t("address.postalCode")} error={postalError ? t("address.invalidPostal") : null}>
          <input id="postal" className="input" autoComplete="postal-code" placeholder={t("address.postalPlaceholder")} value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} required />
        </Field>
        <div className="form-grid__actions">
          <button type="submit" className="btn btn--primary">
            {t("common.save")}
          </button>
          {saved ? (
            <span className="ok-text" role="status">
              {t("address.saved")}
            </span>
          ) : null}
        </div>
      </form>
      <ErrorNote error={error ?? addr.error} />
      {text && notice && !me?.e911.noticeAccepted ? (
        <div className="notice">
          <h3>{text.title}</h3>
          {text.paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
          <label className="check">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
            <span>{text.acknowledgement}</span>
          </label>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={!accepted}
            onClick={async () => {
              await api.e911Ack(notice.version).catch((e: unknown) => setError(toErrorKey(e)));
              await refreshMe();
            }}
          >
            {t("common.confirm")}
          </button>
        </div>
      ) : null}
      <p className="note note--info">{t("phone.e911Address")} {t("call.emergencyHint")}</p>
    </section>
  );
}

/** Version recorded with the AI consent: bump it whenever "ai.consent.details" changes (fr or en). */
export const AI_CONSENT_VERSION = "web-2026-10-ai-1";

const CONSENTS: Array<{ kind: UserConsentKind; label: TKey; hint: TKey; version: string; anchor?: string }> = [
  { kind: "casl_marketing", label: "privacy.marketing", hint: "privacy.marketingHint", version: "web-2026-10" },
  // Law 25 (s. 14 and 17): separate, specific consent; the wording names the processor and where the data goes.
  { kind: AI_CONSENT_KIND, label: "ai.consent.label", hint: "ai.consent.details", version: AI_CONSENT_VERSION, anchor: "ia" },
];

function ConsentsSection() {
  const { t, lang } = useI18n();
  // There is no GET /v1/consents: the AI consent comes from GET /v1/ai/status; the others start off
  // (opt-in) and reflect what was set in this session.
  const [state, setState] = useState<Partial<Record<UserConsentKind, boolean>>>({});
  const [status, setStatus] = useState<AiStatusResponse | null>(null);
  const [msg, setMsg] = useState<TKey | null>(null);
  useEffect(() => {
    // Links from the AI features land on /compte#ia.
    if (window.location.hash === "#ia") document.getElementById("ia")?.scrollIntoView?.({ block: "center" });
    api
      .aiStatus()
      .then((s) => {
        setStatus(s);
        setState((st) => ({ ...st, [AI_CONSENT_KIND]: s.consent }));
      })
      .catch(() => undefined);
  }, []);
  const toggle = async (kind: UserConsentKind, granted: boolean, version: string) => {
    setState((s) => ({ ...s, [kind]: granted }));
    try {
      await api.setConsent({ kind, granted, version, source: "web" });
      setMsg(kind === AI_CONSENT_KIND ? (granted ? "ai.consent.granted" : "ai.consent.withdrawn") : "privacy.saved");
    } catch (e) {
      setState((s) => ({ ...s, [kind]: !granted }));
      setMsg(toErrorKey(e));
    }
  };
  const ok = msg === "privacy.saved" || msg === "ai.consent.granted" || msg === "ai.consent.withdrawn";
  return (
    <section className="card" aria-labelledby="privacy-h">
      <h2 id="privacy-h" className="card__title">
        {t("privacy.title")}
      </h2>
      <p className="muted small">{t("privacy.intro")}</p>
      {CONSENTS.map((c) => (
        <div key={c.kind} id={c.anchor}>
          <label className="switch-row">
            <span>
              <span className="switch-row__label">{t(c.label)}</span>
              <span className="field__hint">{t(c.hint)}</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={state[c.kind] ?? false}
              onChange={(e) => void toggle(c.kind, e.target.checked, c.version)}
            />
          </label>
          {c.kind === AI_CONSENT_KIND && status ? (
            <p className="muted small">
              {!status.configured
                ? t("ai.error.notConfigured")
                : status.monthlyBudgetCadCents === 0
                  ? t("ai.consent.noBudget")
                  : t("ai.consent.budget", {
                      used: formatCad(status.usedCadCents, lang),
                      budget: formatCad(status.monthlyBudgetCadCents, lang),
                    })}
            </p>
          ) : null}
        </div>
      ))}
      {msg ? (
        <p className={ok ? "ok-text" : "note note--error"} role="status">
          {t(msg)}
        </p>
      ) : null}
    </section>
  );
}

function DataSection() {
  const { t } = useI18n();
  const [status, setStatus] = useState<TKey | null>(null);
  return (
    <div className="stack">
      <button
        type="button"
        className="btn btn--ghost"
        onClick={async () => {
          try {
            const data = await api.exportData();
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = `mimt-export-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            setStatus("account.exportDone");
          } catch (e) {
            setStatus(toErrorKey(e));
          }
        }}
      >
        {t("account.export")}
      </button>
      <button
        type="button"
        className="btn btn--danger"
        onClick={async () => {
          if (!window.confirm(t("account.deleteConfirm"))) return;
          try {
            await api.deleteAccount();
            setStatus("account.deleted");
            await api.logout();
          } catch (e) {
            setStatus(toErrorKey(e));
          }
        }}
      >
        {t("account.delete")}
      </button>
      {status ? (
        <p className="muted small" role="status">
          {t(status)}
        </p>
      ) : null}
    </div>
  );
}
