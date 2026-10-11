// Number port-in (transfert de numéro): request a transfer of a landline or VoIP number into MIMT,
// sign the letter of authorization (typed name), then follow it until the transfer date.
import { useState, type FormEvent } from "react";
import { formatCad, PORT_IN_CANCELABLE, type NumberPortIn, type PortInCustomerType, type PortInLoaResponse, type PortInStatus } from "@mimt/shared";
import { api } from "../api/client";
import { toErrorKey } from "../api/errors";
import { useSession } from "../auth/SessionProvider";
import { Badge, Empty, ErrorNote, Field, Loading, PageHeader } from "../components/ui";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";
import { normalizePostalCode, PROVINCES } from "../lib/address";
import { formatPhone, toDialable } from "../lib/dial";
import { formatDateTime } from "../lib/format";
import { useAsync } from "../lib/useAsync";

export const PORT_STATUS_KEY: Record<PortInStatus, TKey> = {
  pending_signature: "port.status.pendingSignature",
  signed: "port.status.signed",
  submitted: "port.status.submitted",
  action_required: "port.status.actionRequired",
  foc_scheduled: "port.status.focScheduled",
  completed: "port.status.completed",
  rejected: "port.status.rejected",
  canceled: "port.status.canceled",
};

function tone(s: PortInStatus): "ok" | "warn" | "error" | "info" | "muted" {
  if (s === "completed") return "ok";
  if (s === "pending_signature" || s === "action_required") return "warn";
  if (s === "rejected") return "error";
  if (s === "canceled") return "muted";
  return "info";
}

/** "514 555-0123\n450-555-0124" → E.164 list, or null when any line is not a valid NANP number. */
export function parseNumbers(raw: string): string[] | null {
  const lines = raw
    .split(/[\n,;]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0 || lines.length > 20) return null;
  const out: string[] = [];
  for (const l of lines) {
    const e = toDialable(l);
    if (!e || e === "911") return null;
    if (!out.includes(e)) out.push(e);
  }
  return out;
}

export function PortIn() {
  const { t } = useI18n();
  const list = useAsync(() => api.portIns(), []);
  const [creating, setCreating] = useState(false);
  const [signing, setSigning] = useState<string | null>(null);

  const replace = (p: NumberPortIn) =>
    list.setData((prev) => (prev ? { portIns: prev.portIns.some((x) => x.id === p.id) ? prev.portIns.map((x) => (x.id === p.id ? p : x)) : [p, ...prev.portIns] } : { portIns: [p] }));

  return (
    <div className="page">
      <PageHeader
        title={t("port.title")}
        sub={t("port.sub")}
        actions={
          creating ? null : (
            <button type="button" className="btn btn--primary btn--sm" onClick={() => setCreating(true)}>
              {t("port.new")}
            </button>
          )
        }
      />
      <p className="note note--info">{t("port.e911")}</p>
      {creating ? (
        <PortInForm
          onCancel={() => setCreating(false)}
          onCreated={(p) => {
            replace(p);
            setCreating(false);
            setSigning(p.id);
          }}
        />
      ) : null}

      <section aria-labelledby="port-list-h" className="stack">
        <h2 id="port-list-h" className="card__title">
          {t("port.listTitle")}
        </h2>
        <ErrorNote error={list.error} onRetry={list.reload} />
        {list.loading && !list.data ? <Loading /> : null}
        {list.data && list.data.portIns.length === 0 ? <Empty>{t("port.empty")}</Empty> : null}
        {list.data?.portIns.map((p) => (
          <PortInCard key={p.id} p={p} signing={signing === p.id} onSign={() => setSigning(p.id)} onCloseSign={() => setSigning(null)} onChange={replace} />
        ))}
      </section>
    </div>
  );
}

function PortInCard({ p, signing, onSign, onCloseSign, onChange }: { p: NumberPortIn; signing: boolean; onSign: () => void; onCloseSign: () => void; onChange: (p: NumberPortIn) => void }) {
  const { t, lang, locale } = useI18n();
  const [error, setError] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);

  const cancel = async () => {
    if (!window.confirm(t("port.cancelConfirm"))) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await api.cancelPortIn(p.id));
    } catch (e) {
      setError(toErrorKey(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="card stack" aria-label={p.numbers.map((n) => formatPhone(n.e164)).join(", ")}>
      <div className="row row--wrap">
        <strong>{p.numbers.map((n) => formatPhone(n.e164)).join(", ")}</strong>
        <Badge tone={tone(p.status)}>{t(PORT_STATUS_KEY[p.status])}</Badge>
      </div>
      <p className="muted">
        {t("port.from", { carrier: p.currentCarrier })} · {p.feeCents > 0 ? t("port.fee", { amount: formatCad(p.feeCents, lang) }) : t("port.feeFree")}
      </p>
      {p.focDate ? <p>{t("port.focDate", { date: p.focDate })}</p> : null}
      {p.temporaryNumber && p.status !== "completed" && p.status !== "canceled" ? <p className="muted">{t("port.temporaryActive", { number: formatPhone(p.temporaryNumber) })}</p> : null}
      {p.statusReason && (p.status === "action_required" || p.status === "rejected") ? <p className="note note--warn">{t("port.reason", { reason: p.statusReason })}</p> : null}
      {p.loa ? <p className="muted">{t("port.signedOn", { name: p.loa.signedName, date: formatDateTime(p.loa.signedAt, locale) })}</p> : null}
      <ErrorNote error={error} />
      {signing && p.status === "pending_signature" ? (
        <SignPanel p={p} onDone={(x) => { onChange(x); onCloseSign(); }} onCancel={onCloseSign} />
      ) : (
        <div className="row">
          {p.status === "pending_signature" ? (
            <button type="button" className="btn btn--primary btn--sm" onClick={onSign}>
              {t("port.sign")}
            </button>
          ) : null}
          {PORT_IN_CANCELABLE.includes(p.status) ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={cancel} disabled={busy}>
              {t("port.cancel")}
            </button>
          ) : null}
        </div>
      )}
    </article>
  );
}

function SignPanel({ p, onDone, onCancel }: { p: NumberPortIn; onDone: (p: NumberPortIn) => void; onCancel: () => void }) {
  const { t, lang } = useI18n();
  const loa = useAsync<PortInLoaResponse>(() => api.portInLoa(p.id), [p.id]);
  const [name, setName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);
  // French first, then English: the signed document is bilingual.
  const order = lang === "fr" ? (["fr", "en"] as const) : (["en", "fr"] as const);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setFieldError(t("validation.required"));
    if (!accepted) return setFieldError(t("port.mustAccept"));
    setFieldError(null);
    setBusy(true);
    setError(null);
    try {
      onDone(await api.signPortIn(p.id, { signedName: name.trim(), accept: true }));
    } catch (err) {
      setError(toErrorKey(err));
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit} noValidate aria-labelledby={`loa-${p.id}`}>
      <h3 id={`loa-${p.id}`}>{t("port.signTitle")}</h3>
      <ErrorNote error={loa.error} onRetry={loa.reload} />
      {loa.loading ? <Loading /> : null}
      {loa.data ? (
        <div className="summary" tabIndex={0}>
          {order.map((l) => (
            <div key={l} lang={l === "fr" ? "fr-CA" : "en-CA"}>
              <h4>{loa.data![l].title}</h4>
              {loa.data![l].paragraphs.map((x) => (
                <p key={x}>{x}</p>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      <Field id={`sig-${p.id}`} label={t("port.signedName")} hint={t("port.signedNameHint", { name: p.authorizedName })}>
        <input id={`sig-${p.id}`} className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
        <span>{t("port.signAccept")}</span>
      </label>
      {fieldError ? (
        <p className="field__error" role="alert">
          {fieldError}
        </p>
      ) : null}
      <ErrorNote error={error} />
      <div className="row">
        <button type="submit" className="btn btn--primary" disabled={busy || !loa.data}>
          {t("port.signConfirm")}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

function PortInForm({ onCreated, onCancel }: { onCreated: (p: NumberPortIn) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const { me, businesses } = useSession();
  const adminBusinesses = businesses.filter((b) => b.role === "owner" || b.role === "admin");
  const activeNumbers = (me?.numbers ?? []).filter((n) => n.state === "active");
  const [f, setF] = useState({
    numbers: "",
    currentCarrier: "",
    customerType: "individual" as PortInCustomerType,
    businessId: "",
    customerName: "",
    authorizedName: me?.user.displayName ?? "",
    authorizedEmail: "",
    accountNumber: "",
    pin: "",
    street: "",
    unit: "",
    city: "",
    province: "QC",
    postalCode: "",
    temporaryNumber: activeNumbers[0]?.e164 ?? "",
    keepTemporaryNumber: false,
    desiredDate: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    const numbers = parseNumbers(f.numbers);
    const postal = normalizePostalCode(f.postalCode);
    if (!numbers) found.numbers = t("port.invalidNumbers");
    for (const k of ["currentCarrier", "customerName", "authorizedName", "accountNumber", "street", "city"] as const) {
      if (f[k].trim().length < 2 && !(k === "accountNumber" && f[k].trim())) found[k] = t("validation.required");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.authorizedEmail.trim())) found.authorizedEmail = t("validation.required");
    if (!postal) found.postalCode = t("address.invalidPostal");
    setErrors(found);
    if (Object.keys(found).length || !numbers || !postal) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api.createPortIn({
        numbers,
        currentCarrier: f.currentCarrier.trim(),
        customerType: f.customerType,
        customerName: f.customerName.trim(),
        authorizedName: f.authorizedName.trim(),
        authorizedEmail: f.authorizedEmail.trim(),
        accountNumber: f.accountNumber.trim(),
        ...(f.pin.trim() ? { pin: f.pin.trim() } : {}),
        serviceAddress: { street: f.street.trim(), unit: f.unit.trim() || null, city: f.city.trim(), province: f.province, postalCode: postal },
        ...(f.businessId ? { businessId: f.businessId } : {}),
        ...(f.temporaryNumber ? { temporaryNumber: f.temporaryNumber, keepTemporaryNumber: f.keepTemporaryNumber } : {}),
        ...(f.desiredDate ? { desiredDate: f.desiredDate } : {}),
      });
      onCreated(p);
    } catch (err) {
      setError(toErrorKey(err));
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="port-new-h">
      <h2 id="port-new-h" className="card__title">
        {t("port.new")}
      </h2>
      <form className="stack" onSubmit={submit} noValidate>
        <Field id="pi-numbers" label={t("port.numbers")} hint={t("port.numbersHint")} error={errors.numbers}>
          <textarea id="pi-numbers" className="input" rows={3} value={f.numbers} onChange={(e) => set({ numbers: e.target.value })} />
        </Field>
        <div className="form-grid">
          <Field id="pi-carrier" label={t("port.carrier")} hint={t("port.carrierHint")} error={errors.currentCarrier}>
            <input id="pi-carrier" className="input" value={f.currentCarrier} onChange={(e) => set({ currentCarrier: e.target.value })} />
          </Field>
          {adminBusinesses.length > 0 ? (
            <Field id="pi-business" label={t("port.business")}>
              <select
                id="pi-business"
                className="input"
                value={f.businessId}
                onChange={(e) => set({ businessId: e.target.value, ...(e.target.value ? { customerType: "business" as const } : {}) })}
              >
                <option value="">{t("port.businessNone")}</option>
                {adminBusinesses.map((b) => (
                  <option key={b.business.id} value={b.business.id}>
                    {b.business.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>
        <fieldset className="fieldset">
          <legend>{t("port.customerType")}</legend>
          <label className="check">
            <input type="radio" name="pi-type" checked={f.customerType === "individual"} onChange={() => set({ customerType: "individual" })} />
            <span>{t("port.individual")}</span>
          </label>
          <label className="check">
            <input type="radio" name="pi-type" checked={f.customerType === "business"} onChange={() => set({ customerType: "business" })} />
            <span>{t("port.businessType")}</span>
          </label>
        </fieldset>
        <div className="form-grid">
          <Field id="pi-cname" label={t("port.customerName")} error={errors.customerName}>
            <input id="pi-cname" className="input" value={f.customerName} onChange={(e) => set({ customerName: e.target.value })} />
          </Field>
          <Field id="pi-aname" label={t("port.authorizedName")} error={errors.authorizedName}>
            <input id="pi-aname" className="input" autoComplete="name" value={f.authorizedName} onChange={(e) => set({ authorizedName: e.target.value })} />
          </Field>
          <Field id="pi-email" label={t("port.authorizedEmail")} error={errors.authorizedEmail}>
            <input id="pi-email" className="input" type="email" autoComplete="email" value={f.authorizedEmail} onChange={(e) => set({ authorizedEmail: e.target.value })} />
          </Field>
          <Field id="pi-account" label={t("port.accountNumber")} hint={t("port.accountHint")} error={errors.accountNumber}>
            <input id="pi-account" className="input" autoComplete="off" spellCheck={false} value={f.accountNumber} onChange={(e) => set({ accountNumber: e.target.value })} />
          </Field>
          <Field id="pi-pin" label={t("port.pin")}>
            <input id="pi-pin" className="input" type="password" autoComplete="off" value={f.pin} onChange={(e) => set({ pin: e.target.value })} />
          </Field>
        </div>
        <fieldset className="fieldset">
          <legend>{t("port.serviceAddress")}</legend>
          <div className="form-grid">
            <Field id="pi-street" label={t("address.street")} error={errors.street}>
              <input id="pi-street" className="input" autoComplete="address-line1" value={f.street} onChange={(e) => set({ street: e.target.value })} />
            </Field>
            <Field id="pi-unit" label={t("address.unit")}>
              <input id="pi-unit" className="input" autoComplete="address-line2" value={f.unit} onChange={(e) => set({ unit: e.target.value })} />
            </Field>
            <Field id="pi-city" label={t("address.city")} error={errors.city}>
              <input id="pi-city" className="input" autoComplete="address-level2" value={f.city} onChange={(e) => set({ city: e.target.value })} />
            </Field>
            <Field id="pi-prov" label={t("address.province")}>
              <select id="pi-prov" className="input" value={f.province} onChange={(e) => set({ province: e.target.value })}>
                {PROVINCES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </Field>
            <Field id="pi-postal" label={t("address.postalCode")} error={errors.postalCode}>
              <input id="pi-postal" className="input" autoComplete="postal-code" value={f.postalCode} onChange={(e) => set({ postalCode: e.target.value })} />
            </Field>
          </div>
        </fieldset>
        <div className="form-grid">
          <Field id="pi-temp" label={t("port.temporary")} hint={t("port.temporaryHint")}>
            <select id="pi-temp" className="input" value={f.temporaryNumber} onChange={(e) => set({ temporaryNumber: e.target.value })}>
              <option value="">{t("port.temporaryNone")}</option>
              {activeNumbers.map((n) => (
                <option key={n.id} value={n.e164}>
                  {formatPhone(n.e164)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="pi-date" label={t("port.desiredDate")}>
            <input id="pi-date" className="input" type="date" value={f.desiredDate} onChange={(e) => set({ desiredDate: e.target.value })} />
          </Field>
        </div>
        {f.temporaryNumber ? (
          <label className="check">
            <input type="checkbox" checked={f.keepTemporaryNumber} onChange={(e) => set({ keepTemporaryNumber: e.target.checked })} />
            <span>{t("port.keepTemporary")}</span>
          </label>
        ) : null}
        <ErrorNote error={error} />
        <div className="row">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {t("port.submit")}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </section>
  );
}
