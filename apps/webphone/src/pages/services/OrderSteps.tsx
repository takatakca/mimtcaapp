// Steps of a resale order after the draft (docs/MIMT-RESALE.md « Le parcours d'une commande »):
// contract summary + consents → submit, install appointment (internet), SIM / eSIM and number
// port-in (mobile), cancellation with its fee quote. Each step calls /v1/catalog/orders/:id/*.
import {
  consumerCodeFor,
  formatCad,
  type CancellationQuote,
  type ContractSummary,
  type EsimResponse,
  type OrderDetailResponse,
  type OrderState,
  type PortInRequest,
  type ServiceOrder,
} from "@mimt/shared";
import qrcode from "qrcode-generator";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { ApiClientError, toErrorKey } from "../../api/errors";
import { Badge, ErrorNote, Field, Loading } from "../../components/ui";
import { useI18n } from "../../i18n/I18nProvider";
import type { TKey } from "../../i18n/core";
import { formatPhone, toDialable } from "../../lib/dial";
import { formatDateTime } from "../../lib/format";

/** States where the customer may still cancel (apps/api LOCAL_ONLY + AT_PROVIDER). */
export const CANCELLABLE: readonly OrderState[] = ["draft", "submitted", "credit_check", "pending_provider", "scheduled", "active", "suspended"];
/** States where a mobile port-in may be requested. */
export const PORTING_STATES: readonly OrderState[] = ["submitted", "credit_check", "pending_provider"];

export const needsInstall = (o: Pick<ServiceOrder, "productLine">) =>
  o.productLine === "internet_residential" || o.productLine === "internet_business" || o.productLine === "home_phone";

// ---------------------------------------------------------------------------------- contract

/** Draft → submitted: read the summary for the frozen price and term, accept, give the consents. */
export function ContractStep({ order, onSubmitted }: { order: ServiceOrder; onSubmitted: () => void }) {
  const { t, lang } = useI18n();
  const [summary, setSummary] = useState<ContractSummary | null>(null);
  const [loadError, setLoadError] = useState<TKey | null>(null);
  const [tick, setTick] = useState(0);
  const [accept, setAccept] = useState(false);
  const [code, setCode] = useState(false);
  const [credit, setCredit] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);
  const consumerCode = consumerCodeFor(order.productLine);
  const needsCredit = order.termMonths > 0;

  useEffect(() => {
    let alive = true;
    setSummary(null);
    api
      .contractSummary(order.id)
      .then((s) => alive && setSummary(s))
      .catch((e: unknown) => alive && setLoadError(toErrorKey(e)));
    return () => {
      alive = false;
    };
  }, [order.id, tick]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!summary) return;
    if (!accept || (consumerCode !== "none" && !code) || (needsCredit && !credit)) return setError("order.consentsMissing");
    setBusy(true);
    setError(null);
    try {
      await api.submitOrder(order.id, {
        contractSummaryVersion: summary.version,
        acceptContractSummary: true,
        ...(consumerCode !== "none" ? { acceptConsumerCode: true } : {}),
        ...(needsCredit ? { creditCheckConsent: true } : {}),
        source: "web",
      });
      onSubmitted();
    } catch (err) {
      const key = toErrorKey(err);
      setError(key);
      // The wording changed since it was shown: show the new version, the customer accepts it again.
      if (err instanceof ApiClientError && err.code === "contract_summary_outdated") {
        setAccept(false);
        setTick((n) => n + 1);
      }
    } finally {
      setBusy(false);
    }
  };

  const doc = summary ? summary[lang] : null;
  const other = summary ? summary[lang === "fr" ? "en" : "fr"] : null;
  return (
    <section className="card" aria-labelledby="cs-h">
      <h2 id="cs-h" className="card__title">
        {t("order.contract.title")}
      </h2>
      <p className="muted small">{t("order.contract.intro")}</p>
      <ErrorNote error={loadError} onRetry={() => setTick((n) => n + 1)} />
      {!summary && !loadError ? <Loading /> : null}
      {doc && other ? (
        <form className="stack" onSubmit={submit} noValidate>
          <div className="summary" tabIndex={0} aria-label={doc.title}>
            <h3>{doc.title}</h3>
            {doc.sections.map((s) => (
              <div key={s.heading}>
                <h4>{s.heading}</h4>
                <ul>
                  {s.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="muted small">{t("order.contract.version", { version: summary!.version })}</p>
          </div>
          <details>
            <summary>{t("order.contract.otherLanguage")}</summary>
            <div className="summary" lang={other.locale}>
              <h3>{other.title}</h3>
              {other.sections.map((s) => (
                <div key={s.heading}>
                  <h4>{s.heading}</h4>
                  <ul>
                    {s.lines.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
          <label className="check">
            <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
            <span>{t("offers.accept")}</span>
          </label>
          {consumerCode !== "none" ? (
            <label className="check">
              <input type="checkbox" checked={code} onChange={(e) => setCode(e.target.checked)} />
              <span>{t(consumerCode === "wireless" ? "order.contract.wirelessCode" : "order.contract.internetCode")}</span>
            </label>
          ) : null}
          {needsCredit ? (
            <label className="check">
              <input type="checkbox" checked={credit} onChange={(e) => setCredit(e.target.checked)} />
              <span>{t("order.contract.creditCheck", { months: order.termMonths })}</span>
            </label>
          ) : null}
          <ErrorNote error={error} />
          <div className="row">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {t("offers.confirm")}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------- cancellation

export function CancelStep({ order, onCancelled }: { order: ServiceOrder; onCancelled: () => void }) {
  const { t, lang, locale } = useI18n();
  const [quote, setQuote] = useState<CancellationQuote | null>(null);
  const [error, setError] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      setQuote(await api.cancellationQuote(order.id));
    } catch (e) {
      setError(toErrorKey(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.cancelOrder(order.id);
      setQuote(null);
      onCancelled();
    } catch (e) {
      setError(toErrorKey(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="cancel-h">
      <h2 id="cancel-h" className="card__title">
        {t("order.cancel.title")}
      </h2>
      {!quote ? (
        <button type="button" className="btn btn--ghost" onClick={() => void ask()} disabled={busy}>
          {t("order.cancel.ask")}
        </button>
      ) : (
        <div className="stack">
          <dl className="dl">
            <dt>{t("order.cancel.fee")}</dt>
            <dd>{formatCad(quote.feeCents, lang)}</dd>
            {quote.deviceBalanceCents ? (
              <>
                <dt>{t("order.cancel.device")}</dt>
                <dd>{formatCad(quote.deviceBalanceCents, lang)}</dd>
              </>
            ) : null}
            <dt>{t("order.cancel.total")}</dt>
            <dd>
              <strong>{formatCad(quote.totalCents, lang)}</strong> {quote.inTrial ? <Badge tone="ok">{t("order.cancel.trial")}</Badge> : null}
            </dd>
            <dt>{t("order.cancel.effective")}</dt>
            <dd>{formatDateTime(quote.effectiveAt, locale)}</dd>
          </dl>
          <p className="small">{quote.explanation[lang]}</p>
          <div className="row">
            <button type="button" className="btn btn--danger" onClick={() => void confirm()} disabled={busy}>
              {t("order.cancel.confirm")}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setQuote(null)} disabled={busy}>
              {t("order.cancel.keep")}
            </button>
          </div>
        </div>
      )}
      <ErrorNote error={error} />
    </section>
  );
}

// ---------------------------------------------------------------------------------- appointment

export function AppointmentStep({ detail, onBooked }: { detail: OrderDetailResponse; onBooked: () => void }) {
  const { t, locale } = useI18n();
  const order = detail.order;
  const booked = detail.appointments.filter((a) => a.status === "booked");
  const [slots, setSlots] = useState<Array<{ startsAt: string; endsAt: string }> | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [error, setError] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      setSlots((await api.appointmentSlots(order.id)).slots);
      setPick(null);
    } catch (e) {
      setError(toErrorKey(e));
    } finally {
      setBusy(false);
    }
  };

  const book = async (e: FormEvent) => {
    e.preventDefault();
    const slot = pick === null ? undefined : slots?.[pick];
    if (!slot) return setError("order.appt.pick");
    setBusy(true);
    setError(null);
    try {
      await api.bookAppointment(order.id, slot);
      setSlots(null);
      onBooked();
    } catch (err) {
      setError(toErrorKey(err));
    } finally {
      setBusy(false);
    }
  };

  const range = (s: { startsAt: string; endsAt: string }) =>
    `${formatDateTime(s.startsAt, locale)} – ${new Date(s.endsAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;

  return (
    <section className="card" aria-labelledby="appt-h">
      <h2 id="appt-h" className="card__title">
        {t("order.appt.title")}
      </h2>
      {booked.map((a) => (
        <p key={a.id}>
          <Badge tone="ok">{t("order.appt.booked")}</Badge> {range(a)}
        </p>
      ))}
      {!slots ? (
        <button type="button" className="btn btn--ghost" onClick={() => void load()} disabled={busy}>
          {booked.length ? t("order.appt.change") : t("order.appt.choose")}
        </button>
      ) : slots.length === 0 ? (
        <p className="muted">{t("order.appt.none")}</p>
      ) : (
        <form className="stack" onSubmit={book}>
          <fieldset className="fieldset">
            <legend>{t("order.appt.slots")}</legend>
            {slots.map((s, i) => (
              <label key={s.startsAt} className="check">
                <input type="radio" name="slot" checked={pick === i} onChange={() => setPick(i)} />
                <span>{range(s)}</span>
              </label>
            ))}
          </fieldset>
          <div className="row">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {t("order.appt.book")}
            </button>
          </div>
        </form>
      )}
      <ErrorNote error={error} />
    </section>
  );
}

// ---------------------------------------------------------------------------------- SIM / eSIM

export function SimStep({ detail, onActivated }: { detail: OrderDetailResponse; onActivated: () => void }) {
  const { t } = useI18n();
  const order = detail.order;
  const sim = detail.devices.find((d) => d.kind === "sim" && d.status !== "inactive");
  const ready = order.state === "pending_provider" && Boolean(order.providerOrderId);
  const [iccid, setIccid] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const digits = iccid.replace(/\D/g, "");
    if (!/^\d{19,20}$/.test(digits)) return setFieldError(t("order.sim.iccidInvalid"));
    setFieldError(null);
    setBusy(true);
    setError(null);
    try {
      await api.activateSim(order.id, { iccid: digits });
      setIccid("");
      onActivated();
    } catch (err) {
      setError(toErrorKey(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="sim-h">
      <h2 id="sim-h" className="card__title">
        {t("order.sim.title")}
      </h2>
      {sim ? (
        <p>
          {t("order.sim.card", { iccid: sim.iccid ? `…${sim.iccid.slice(-4)}` : "" })} <Badge tone={sim.status === "active" ? "ok" : "info"}>{t(DEVICE_STATUS[sim.status])}</Badge>
        </p>
      ) : null}
      {!ready ? (
        <p className="muted small">{t("order.sim.wait")}</p>
      ) : (
        <form className="form-grid" onSubmit={submit} noValidate>
          <Field id="iccid" label={t("order.sim.iccid")} hint={t("order.sim.iccidHint")} error={fieldError}>
            <input id="iccid" className="input" inputMode="numeric" autoComplete="off" value={iccid} onChange={(e) => setIccid(e.target.value)} />
          </Field>
          <div className="form-grid__actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {sim ? t("order.sim.replace") : t("order.sim.activate")}
            </button>
          </div>
        </form>
      )}
      <ErrorNote error={error} />
    </section>
  );
}

const DEVICE_STATUS: Record<OrderDetailResponse["devices"][number]["status"], TKey> = {
  pending: "order.device.pending",
  shipped: "order.device.shipped",
  active: "order.device.active",
  returned: "order.device.returned",
  inactive: "order.device.inactive",
};

/** SVG markup of the LPA activation code as a QR code (built in memory, never stored). */
export function esimQrSvg(activationCode: string): string {
  const qr = qrcode(0, "M");
  qr.addData(activationCode);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

export function EsimStep({ detail, onActivated }: { detail: OrderDetailResponse; onActivated: () => void }) {
  const { t } = useI18n();
  const order = detail.order;
  const existing = detail.devices.find((d) => d.kind === "esim" && d.status !== "inactive");
  const ready = order.state === "pending_provider" && Boolean(order.providerOrderId);
  const [eid, setEid] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [esim, setEsim] = useState<EsimResponse | null>(null);
  const [error, setError] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);

  // The code stays in memory only while the page is open.
  useEffect(() => () => setEsim(null), []);

  const run = async (fn: () => Promise<EsimResponse>, refresh: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setEsim(await fn());
      if (refresh) onActivated();
    } catch (err) {
      setError(toErrorKey(err));
    } finally {
      setBusy(false);
    }
  };

  const activate = (e: FormEvent) => {
    e.preventDefault();
    const digits = eid.replace(/\D/g, "");
    if (digits && !/^\d{32}$/.test(digits)) return setFieldError(t("order.esim.eidInvalid"));
    setFieldError(null);
    void run(() => api.activateEsim(order.id, digits ? { eid: digits } : {}), true);
  };

  return (
    <section className="card" aria-labelledby="esim-h">
      <h2 id="esim-h" className="card__title">
        {t("order.esim.title")}{" "}
        {existing ? <Badge tone={existing.status === "active" ? "ok" : "info"}>{t(DEVICE_STATUS[existing.status])}</Badge> : null}
      </h2>
      {esim ? (
        <div className="stack">
          <p>{t("order.esim.scan")}</p>
          <div className="esim-qr" role="img" aria-label={t("order.esim.qr")} dangerouslySetInnerHTML={{ __html: esimQrSvg(esim.activationCode) }} />
          <dl className="dl">
            <dt>{t("order.esim.smdp")}</dt>
            <dd>
              <code>{esim.smdpAddress}</code>
            </dd>
            <dt>{t("order.esim.matchingId")}</dt>
            <dd>
              <code>{esim.matchingId}</code>
            </dd>
          </dl>
          <p className="muted small">{t("order.esim.private")}</p>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEsim(null)}>
            {t("order.esim.hide")}
          </button>
        </div>
      ) : existing ? (
        <button type="button" className="btn btn--primary" onClick={() => void run(() => api.esim(order.id), false)} disabled={busy}>
          {t("order.esim.show")}
        </button>
      ) : !ready ? (
        <p className="muted small">{t("order.sim.wait")}</p>
      ) : (
        <form className="form-grid" onSubmit={activate} noValidate>
          <Field id="eid" label={t("order.esim.eid")} hint={t("order.esim.eidHint")} error={fieldError}>
            <input id="eid" className="input" inputMode="numeric" autoComplete="off" value={eid} onChange={(e) => setEid(e.target.value)} />
          </Field>
          <div className="form-grid__actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {t("order.esim.activate")}
            </button>
          </div>
        </form>
      )}
      <ErrorNote error={error} />
    </section>
  );
}

// ---------------------------------------------------------------------------------- port-in

const PORTING_STATUS: Record<NonNullable<OrderDetailResponse["porting"]>["status"], { key: TKey; tone: "ok" | "info" | "warn" | "error" | "muted" }> = {
  pending: { key: "order.port.status.pending", tone: "info" },
  submitted: { key: "order.port.status.submitted", tone: "info" },
  confirmed: { key: "order.port.status.confirmed", tone: "info" },
  completed: { key: "order.port.status.completed", tone: "ok" },
  rejected: { key: "order.port.status.rejected", tone: "error" },
  cancelled: { key: "order.port.status.cancelled", tone: "muted" },
};

export function PortingStep({ detail, onSent }: { detail: OrderDetailResponse; onSent: () => void }) {
  const { t, locale } = useI18n();
  const order = detail.order;
  const current = detail.porting;
  const canRequest = PORTING_STATES.includes(order.state) && (!current || current.status === "rejected" || current.status === "cancelled");
  const [form, setForm] = useState({ phoneNumber: "", losingCarrier: "", authorizedName: "", accountNumber: "", pin: "", imei: "" });
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [error, setError] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    const phone = toDialable(form.phoneNumber);
    if (!phone || phone === "911") found.phoneNumber = t("messages.invalidTo");
    if (form.losingCarrier.trim().length < 2) found.losingCarrier = t("validation.required");
    if (form.authorizedName.trim().length < 2) found.authorizedName = t("validation.required");
    if (!form.accountNumber.trim()) found.accountNumber = t("validation.required");
    const imei = form.imei.replace(/\D/g, "");
    if (!form.pin.trim() && !imei) found.pin = t("order.port.pinOrImei");
    if (imei && !/^\d{15}$/.test(imei)) found.imei = t("order.port.imeiInvalid");
    setIssues(found);
    if (Object.keys(found).length || !phone) return;
    const body: PortInRequest = {
      phoneNumber: phone,
      losingCarrier: form.losingCarrier.trim(),
      authorizedName: form.authorizedName.trim(),
      accountNumber: form.accountNumber.trim(),
      ...(form.pin.trim() ? { pin: form.pin.trim() } : {}),
      ...(imei ? { imei } : {}),
    };
    setBusy(true);
    setError(null);
    try {
      await api.portIn(order.id, body);
      // Never keep the account number, PIN or IMEI around after sending them.
      setForm({ phoneNumber: "", losingCarrier: "", authorizedName: "", accountNumber: "", pin: "", imei: "" });
      setOpen(false);
      onSent();
    } catch (err) {
      setError(toErrorKey(err));
    } finally {
      setBusy(false);
    }
  };

  const status = current ? PORTING_STATUS[current.status] : null;
  const input = (key: keyof typeof form, label: TKey, extra: { type?: string; inputMode?: "numeric" | "tel"; hint?: TKey } = {}) => (
    <Field id={`port-${key}`} label={t(label)} hint={extra.hint ? t(extra.hint) : undefined} error={issues[key]}>
      <input
        id={`port-${key}`}
        className="input"
        type={extra.type ?? "text"}
        inputMode={extra.inputMode}
        autoComplete="off"
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </Field>
  );

  return (
    <section className="card" aria-labelledby="port-h">
      <h2 id="port-h" className="card__title">
        {t("order.port.title")}
      </h2>
      {current && status ? (
        <p>
          {formatPhone(current.phoneE164)} · {current.losingCarrier} <Badge tone={status.tone}>{t(status.key)}</Badge>
          {current.dueAt ? <span className="muted small"> · {t("order.port.due", { date: formatDateTime(current.dueAt, locale) })}</span> : null}
          {current.rejectReason ? <span className="note note--error">{current.rejectReason}</span> : null}
        </p>
      ) : (
        <p className="muted small">{t("order.port.intro")}</p>
      )}
      {canRequest && !open ? (
        <button type="button" className="btn btn--ghost" onClick={() => setOpen(true)}>
          {current ? t("order.port.retry") : t("order.port.start")}
        </button>
      ) : null}
      {canRequest && open ? (
        <form className="stack" onSubmit={submit} noValidate>
          <div className="form-grid">
            {input("phoneNumber", "order.port.phone", { type: "tel", inputMode: "tel" })}
            {input("losingCarrier", "order.port.carrier")}
            {input("authorizedName", "order.port.name", { hint: "order.port.nameHint" })}
            {input("accountNumber", "order.port.account")}
            {input("pin", "order.port.pin", { type: "password", hint: "order.port.pinHint" })}
            {input("imei", "order.port.imei", { inputMode: "numeric", hint: "order.port.imeiHint" })}
          </div>
          <p className="muted small">{t("order.port.privacy")}</p>
          <div className="row">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {t("order.port.send")}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      ) : null}
      <ErrorNote error={error} />
    </section>
  );
}
