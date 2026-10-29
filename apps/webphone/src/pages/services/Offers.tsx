// Services (resale): offers sold at a postal code, then a draft order (SIM kind / service address).
// The Critical Information Summary is previewed here; the customer accepts the version frozen on the
// order (and gives the consumer-code and credit-check consents) on the order page before submitting.
import { formatCad, generateContractSummary, normalizePostalCode, type Offer, type ProductLine, type ServiceAddress } from "@mimt/shared";
import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api } from "../../api/client";
import { toErrorKey } from "../../api/errors";
import { Badge, Empty, ErrorNote, Field, Loading, PageHeader } from "../../components/ui";
import { useI18n } from "../../i18n/I18nProvider";
import type { TKey } from "../../i18n/core";
import { PROVINCES } from "../../lib/address";
import { useAsync } from "../../lib/useAsync";
import { LINE_KEY, offerFeatures, priceText, termText } from "./catalogText";
import { ShopTabs } from "../../components/SectionTabs";

type Filter = "all" | "mobile" | "internet" | "other";
const FILTERS: Array<{ id: Filter; label: TKey }> = [
  { id: "all", label: "offers.filter.all" },
  { id: "mobile", label: "offers.filter.mobile" },
  { id: "internet", label: "offers.filter.internet" },
  { id: "other", label: "offers.filter.other" },
];

function matches(line: ProductLine, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "mobile") return line === "mobile";
  if (f === "internet") return line === "internet_residential" || line === "internet_business";
  return line !== "mobile" && !line.startsWith("internet");
}

export function Offers() {
  const { t, lang } = useI18n();
  const [params, setParams] = useSearchParams();
  const postal = params.get("cp") ?? "";
  const [input, setInput] = useState(postal);
  const [postalError, setPostalError] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [ordering, setOrdering] = useState<Offer | null>(null);
  const offers = useAsync(() => api.offers(postal || undefined), [postal]);

  const search = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim()) {
      setPostalError(false);
      setParams({});
      return;
    }
    const p = normalizePostalCode(input);
    setPostalError(!p);
    if (p) setParams({ cp: p });
  };

  const list = (offers.data?.offers ?? []).filter((o) => matches(o.productLine, filter));
  return (
    <div className="page page--wide">
      <ShopTabs />
      <PageHeader title={t("offers.title")} sub={t("offers.sub")} />
      <form className="row row--wrap row--end" onSubmit={search} noValidate>
        <Field id="offers-postal" label={t("address.postalCode")} error={postalError ? t("address.invalidPostal") : null}>
          <input id="offers-postal" className="input" autoComplete="postal-code" placeholder={t("address.postalPlaceholder")} value={input} onChange={(e) => setInput(e.target.value)} />
        </Field>
        <button type="submit" className="btn btn--primary">
          {t("offers.search")}
        </button>
      </form>
      <div className="chips" role="group" aria-label={t("offers.filter.label")}>
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={`chip${filter === f.id ? " is-active" : ""}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {t(f.label)}
          </button>
        ))}
      </div>
      {ordering ? <OrderPanel key={ordering.id} offer={ordering} postalCode={postal} onCancel={() => setOrdering(null)} /> : null}
      <ErrorNote error={offers.error} onRetry={offers.reload} />
      {offers.loading ? <Loading /> : null}
      {offers.data && list.length === 0 ? <Empty>{postal ? t("offers.noneAt", { postal }) : t("offers.none")}</Empty> : null}
      <ul className="grid grid--3">
        {list.map((o) => (
          <li key={o.id} className="card offer">
            <p className="offer__line">{t(LINE_KEY[o.productLine])}</p>
            <h2 className="offer__name">{o.name[lang]}</h2>
            <p className="offer__price">{priceText(o.monthlyPriceCents, lang, t)}</p>
            <p className="muted small">{o.description[lang]}</p>
            <ul className="offer__features">
              {offerFeatures(o, t).map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <p className="small">
              {termText(o.termMonths, t)}
              {o.setupFeeCents ? ` · ${t("offer.setupFee", { fee: formatCad(o.setupFeeCents, lang) })}` : ""}
            </p>
            {o.productLine === "tv" ? (
              <Badge tone="muted">{t("offers.soon")}</Badge>
            ) : (
              <button type="button" className="btn btn--primary btn--block" onClick={() => setOrdering(o)}>
                {t("offers.order")}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function OrderPanel({ offer, postalCode, onCancel }: { offer: Offer; postalCode: string; onCancel: () => void }) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const summary = generateContractSummary(offer)[lang];
  const needsAddress = offer.productLine !== "mobile" && offer.productLine !== "voip_consumer" && offer.productLine !== "voip_business";
  const [simKind, setSimKind] = useState<"sim" | "esim">(offer.attributes.esim ? "esim" : "sim");
  const [addr, setAddr] = useState({ street: "", unit: "", city: "", province: "QC", postalCode });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    let serviceAddress: ServiceAddress | undefined;
    if (needsAddress) {
      const postal = normalizePostalCode(addr.postalCode);
      if (!addr.street.trim()) found.street = t("validation.required");
      if (!addr.city.trim()) found.city = t("validation.required");
      if (!postal) found.postal = t("address.invalidPostal");
      if (postal) serviceAddress = { street: addr.street.trim(), unit: addr.unit.trim() || null, city: addr.city.trim(), province: addr.province, postalCode: postal };
    }
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError(null);
    try {
      const order = await api.createOrder({ offerId: offer.id, serviceAddress, simKind: offer.productLine === "mobile" ? simKind : undefined });
      navigate(`/services/commandes/${encodeURIComponent(order.id)}`);
    } catch (err) {
      setError(toErrorKey(err));
      setBusy(false);
    }
  };

  return (
    <section className="card order-panel" aria-labelledby="order-h">
      <h2 id="order-h" className="card__title">
        {t("offers.orderTitle", { name: offer.name[lang] })}
      </h2>
      <form className="stack" onSubmit={submit} noValidate>
        {offer.productLine === "mobile" ? (
          <fieldset className="fieldset">
            <legend>{t("offers.simKind")}</legend>
            <label className="check">
              <input type="radio" name="sim" checked={simKind === "sim"} onChange={() => setSimKind("sim")} />
              <span>{t("offers.sim")}</span>
            </label>
            {offer.attributes.esim ? (
              <label className="check">
                <input type="radio" name="sim" checked={simKind === "esim"} onChange={() => setSimKind("esim")} />
                <span>{t("offers.esim")}</span>
              </label>
            ) : null}
          </fieldset>
        ) : null}
        {needsAddress ? (
          <fieldset className="fieldset">
            <legend>{t("offers.serviceAddress")}</legend>
            <div className="form-grid">
              <Field id="o-street" label={t("address.street")} error={errors.street}>
                <input id="o-street" className="input" autoComplete="address-line1" value={addr.street} onChange={(e) => setAddr({ ...addr, street: e.target.value })} />
              </Field>
              <Field id="o-unit" label={t("address.unit")}>
                <input id="o-unit" className="input" autoComplete="address-line2" value={addr.unit} onChange={(e) => setAddr({ ...addr, unit: e.target.value })} />
              </Field>
              <Field id="o-city" label={t("address.city")} error={errors.city}>
                <input id="o-city" className="input" autoComplete="address-level2" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} />
              </Field>
              <Field id="o-prov" label={t("address.province")}>
                <select id="o-prov" className="input" value={addr.province} onChange={(e) => setAddr({ ...addr, province: e.target.value })}>
                  {PROVINCES.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </Field>
              <Field id="o-postal" label={t("address.postalCode")} error={errors.postal}>
                <input id="o-postal" className="input" autoComplete="postal-code" value={addr.postalCode} onChange={(e) => setAddr({ ...addr, postalCode: e.target.value })} />
              </Field>
            </div>
          </fieldset>
        ) : null}
        <p className="muted small">{t("order.contract.preview")}</p>
        <div className="summary" tabIndex={0} aria-label={summary.title}>
          <h3>{summary.title}</h3>
          {summary.sections.map((s) => (
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
        <ErrorNote error={error} />
        <div className="row">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {t("order.contract.continue")}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </section>
  );
}
