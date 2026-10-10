import type { OrderEventRecord } from "@mimt/shared";
import { formatCad } from "@mimt/shared";
import { Link, useParams } from "react-router";
import { api } from "../../api/client";
import { Badge, ErrorNote, Loading, PageHeader } from "../../components/ui";
import { useI18n } from "../../i18n/I18nProvider";
import type { TKey } from "../../i18n/core";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { LINE_KEY, ORDER_STATE_KEY, orderTone, priceText, termText } from "./catalogText";

const ACTOR_KEY: Record<OrderEventRecord["actor"], TKey> = {
  customer: "order.actor.customer",
  admin: "order.actor.admin",
  system: "order.actor.system",
  provider: "order.actor.provider",
};

export function OrderDetail() {
  const { t, lang, locale } = useI18n();
  const { orderId = "" } = useParams();
  const detail = useAsync(() => api.order(orderId), [orderId]);
  const o = detail.data?.order;

  return (
    <div className="page">
      <PageHeader
        title={o ? (detail.data?.offer?.name[lang] ?? o.offerCode) : t("orders.title")}
        sub={o ? t(LINE_KEY[o.productLine]) : undefined}
        actions={
          <Link to="/services/commandes" className="btn btn--ghost btn--sm">
            {t("common.back")}
          </Link>
        }
      />
      <ErrorNote error={detail.error} onRetry={detail.reload} />
      {detail.loading ? <Loading /> : null}
      {o ? (
        <div className="grid grid--2">
          <section className="card" aria-labelledby="od-h">
            <h2 id="od-h" className="card__title">
              {t("order.details")} <Badge tone={orderTone(o.state)}>{t(ORDER_STATE_KEY[o.state])}</Badge>
            </h2>
            <dl className="dl">
              <dt>{t("order.number")}</dt>
              <dd>{o.id}</dd>
              <dt>{t("order.price")}</dt>
              <dd>{priceText(o.monthlyPriceCents, lang, t)}</dd>
              <dt>{t("order.term")}</dt>
              <dd>{termText(o.termMonths, t)}</dd>
              {o.setupFeeCents ? (
                <>
                  <dt>{t("order.setupFee")}</dt>
                  <dd>{formatCad(o.setupFeeCents, lang)}</dd>
                </>
              ) : null}
              {o.simKind ? (
                <>
                  <dt>{t("offers.simKind")}</dt>
                  <dd>{t(o.simKind === "esim" ? "offers.esim" : "offers.sim")}</dd>
                </>
              ) : null}
              {o.serviceAddress ? (
                <>
                  <dt>{t("offers.serviceAddress")}</dt>
                  <dd>
                    {o.serviceAddress.unit ? `${o.serviceAddress.unit}-` : ""}
                    {o.serviceAddress.street}, {o.serviceAddress.city} ({o.serviceAddress.province}) {o.serviceAddress.postalCode}
                  </dd>
                </>
              ) : null}
              {o.contractAcceptedAt ? (
                <>
                  <dt>{t("order.contractAccepted")}</dt>
                  <dd>{formatDateTime(o.contractAcceptedAt, locale)}</dd>
                </>
              ) : null}
            </dl>
            {o.failureReason ? <p className="note note--error">{o.failureReason}</p> : null}
            <p className="muted small">{t("order.trialHint")}</p>
          </section>
          <section className="card" aria-labelledby="ot-h">
            <h2 id="ot-h" className="card__title">
              {t("order.timeline")}
            </h2>
            <ol className="timeline">
              {detail.data?.events.map((ev) => (
                <li key={ev.id}>
                  <span className="timeline__when">{formatDateTime(ev.at, locale)}</span>
                  <span>
                    {ev.toState ? t(ORDER_STATE_KEY[ev.toState]) : ev.event} · <span className="muted">{t(ACTOR_KEY[ev.actor])}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      ) : null}
    </div>
  );
}
