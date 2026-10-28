import type { CallRecord } from "@mimt/shared";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api } from "../api/client";
import { toErrorKey } from "../api/errors";
import { AdSlot } from "../ads/Ads";
import { Icon } from "../components/Icon";
import { Badge, Empty, ErrorNote, Loading, PageHeader } from "../components/ui";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";
import { formatPhone } from "../lib/dial";
import { formatDuration, formatWhen } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { usePhone } from "../phone/PhoneProvider";

export function Calls() {
  const { t, locale } = useI18n();
  const { prepare, setPanelOpen } = usePhone();
  const first = useAsync(() => api.calls(), []);
  const [more, setMore] = useState<CallRecord[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<TKey | null>(null);
  const nextCursor = cursor === undefined ? first.data?.nextCursor : cursor;
  // ?filtre=missed|inbound|outbound (set by the « Pilote MIMT », or a shared link).
  const [params] = useSearchParams();
  const filter = params.get("filtre");
  const known = filter === "missed" || filter === "inbound" || filter === "outbound" ? filter : null;
  const all = [...(first.data?.calls ?? []), ...more];
  const calls = known ? all.filter((c) => (known === "missed" ? c.missed : c.direction === known)) : all;

  const loadMore = async () => {
    if (!nextCursor) return;
    try {
      const page = await api.calls(nextCursor);
      setMore((m) => [...m, ...page.calls]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(toErrorKey(e));
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={t("calls.title")}
        actions={
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setPanelOpen(true)}>
            <Icon name="dialpad" size={16} /> {t("calls.keypad")}
          </button>
        }
      />
      {known ? (
        <p className="calls-filter" data-pilot="calls-filter">
          <Badge tone="info">{t("calls.filtered", { filter: t(`calls.filter.${known}` as TKey) })}</Badge>{" "}
          <Link to="/appels">{t("calls.filterClear")}</Link>
        </p>
      ) : null}
      <ErrorNote error={first.error ?? error} onRetry={first.reload} />
      {first.loading ? <Loading /> : null}
      {first.data && calls.length === 0 ? <Empty>{t("calls.empty")}</Empty> : null}
      <ul className="list card">
        {calls.map((c) => (
          <li key={c.id} className="list__row" data-pilot={`call-${c.id}`}>
            <span className={`call-dir call-dir--${c.missed ? "missed" : c.direction}`} aria-hidden="true">
              <Icon name="phone" size={16} />
            </span>
            <span className="list__main">
              <span className="list__title">
                {c.kind === "emergency" ? "9-1-1" : formatPhone(c.peer)}{" "}
                {c.spamLabel ? (
                  <span title={t("ai.spam.hint")}>
                    <Badge tone="warn">{t("spam.call")}</Badge>
                  </span>
                ) : null}
              </span>
              <span className="list__sub">
                {c.missed ? (
                  <Badge tone="error">{t("calls.missed")}</Badge>
                ) : (
                  t(c.direction === "inbound" ? "calls.incoming" : "calls.outgoing")
                )}
                {c.durationS ? ` · ${formatDuration(c.durationS)}` : ""}
              </span>
            </span>
            <span className="list__meta">{formatWhen(c.startedAt, locale, t("common.yesterday"))}</span>
            {c.kind !== "app" ? (
              <button type="button" className="icon-btn" onClick={() => prepare(c.peer)} aria-label={t("calls.callNumber", { number: formatPhone(c.peer) })}>
                <Icon name="phone" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {nextCursor ? (
        <button type="button" className="btn btn--ghost" onClick={loadMore}>
          {t("common.loadMore")}
        </button>
      ) : null}
      <AdSlot placement="banner" />
    </div>
  );
}
