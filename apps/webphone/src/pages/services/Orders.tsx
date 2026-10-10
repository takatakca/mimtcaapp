import { Link } from "react-router";
import { api } from "../../api/client";
import { Badge, Empty, ErrorNote, Loading, PageHeader } from "../../components/ui";
import { useI18n } from "../../i18n/I18nProvider";
import { formatWhen } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { LINE_KEY, ORDER_STATE_KEY, orderTone, priceText } from "./catalogText";

export function Orders() {
  const { t, lang, locale } = useI18n();
  const orders = useAsync(() => api.orders(), []);
  return (
    <div className="page">
      <PageHeader
        title={t("orders.title")}
        actions={
          <Link to="/services/offres" className="btn btn--primary btn--sm">
            {t("orders.browse")}
          </Link>
        }
      />
      <ErrorNote error={orders.error} onRetry={orders.reload} />
      {orders.loading ? <Loading /> : null}
      {orders.data && orders.data.orders.length === 0 ? <Empty>{t("orders.empty")}</Empty> : null}
      {orders.data && orders.data.orders.length > 0 ? (
        <ul className="list card">
          {orders.data.orders.map((o) => (
            <li key={o.id}>
              <Link to={`/services/commandes/${encodeURIComponent(o.id)}`} className="list__row">
                <span className="list__main">
                  <span className="list__title">
                    {t(LINE_KEY[o.productLine])} · {o.offerCode}
                  </span>
                  <span className="list__sub">{priceText(o.monthlyPriceCents, lang, t)}</span>
                </span>
                <Badge tone={orderTone(o.state)}>{t(ORDER_STATE_KEY[o.state])}</Badge>
                <span className="list__meta">{formatWhen(o.createdAt, locale, t("common.yesterday"))}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
