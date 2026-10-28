// /affilie — « Espace agent affilié » (docs/MIMT-AFFILIATES.md). Read-only view of GET /v1/affiliates/me: link and
// code to copy or share (the share text already carries the paid-relationship disclosure), counts, payout threshold
// progress, the commission ledger and the rules. Only for active (or suspended) affiliates; never shows who the
// customers are.
import { useState } from "react";
import { formatCad, formatCommissionPct, type AffiliateCommissionDto } from "@mimt/shared";
import { ApiClientError } from "../api/errors";
import { api } from "../api/client";
import { Icon } from "../components/Icon";
import { Badge, ErrorNote, Loading, PageHeader } from "../components/ui";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";
import { formatDateTime } from "../lib/format";
import { useAsync } from "../lib/useAsync";

const STATUS_TONE: Record<AffiliateCommissionDto["status"], "muted" | "warn" | "ok" | "info"> = {
  pending: "warn",
  payable: "info",
  paid: "ok",
  reversed: "muted",
};

/** Percent of the payout threshold reached by the payable balance (0–100). */
export function payoutProgress(payableCents: number, thresholdCents: number): number {
  if (thresholdCents <= 0) return payableCents > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((payableCents / thresholdCents) * 100)));
}

export function Affiliate() {
  const { t, lang, locale } = useI18n();
  const [notAffiliate, setNotAffiliate] = useState(false);
  const data = useAsync(
    () =>
      api.affiliateDashboard().catch((e: unknown) => {
        if (e instanceof ApiClientError && e.status === 404) setNotAffiliate(true);
        throw e;
      }),
    [],
  );
  const [copied, setCopied] = useState<"link" | "code" | null>(null);

  if (notAffiliate) {
    return (
      <div className="page">
        <PageHeader title={t("aff.title")} />
        <section className="card">
          <p>{t("aff.notAffiliate")}</p>
          <a className="btn btn--primary" href={lang === "fr" ? "https://mimt.ca/affilies/" : "https://mimt.ca/en/affiliates/"} target="_blank" rel="noopener noreferrer">
            {t("aff.apply")}
          </a>
        </section>
      </div>
    );
  }
  if (data.loading && !data.data) return <Loading />;
  if (!data.data) return <ErrorNote error={data.error} onRetry={data.reload} />;
  const d = data.data;
  const money = (cents: number) => formatCad(cents, lang);
  const progress = payoutProgress(d.totals.payableCents, d.terms.payoutThresholdCents);
  const missing = Math.max(0, d.terms.payoutThresholdCents - d.totals.payableCents);

  const copy = async (what: "link" | "code") => {
    try {
      await navigator.clipboard.writeText(what === "link" ? d.link : d.code);
      setCopied(what);
    } catch {
      setCopied(null);
    }
  };
  const share = async () => {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "MIMT", text: t("aff.link.shareText"), url: d.link });
        return;
      } catch (e) {
        if ((e as DOMException)?.name === "AbortError") return;
      }
    }
    await copy("link");
  };

  return (
    <div className="page affiliate">
      <PageHeader title={t("aff.title")} sub={t("aff.lead")} />
      {d.status === "suspended" ? <p className="note note--warn">{t("aff.suspended")}</p> : null}

      <section className="card affiliate__link" aria-labelledby="aff-link-h">
        <h2 id="aff-link-h" className="card__title">
          {t("aff.link.title")}
        </h2>
        <p className="affiliate__url">{d.link}</p>
        <p>
          <strong>{t("aff.link.code", { code: d.code })}</strong>
        </p>
        <div className="row row--wrap">
          <button type="button" className="btn btn--primary" onClick={() => void share()}>
            <Icon name="link" size={16} /> {t("aff.link.share")}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => void copy("link")}>
            <Icon name="copy" size={16} /> {t("aff.link.copy")}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => void copy("code")}>
            <Icon name="copy" size={16} /> {t("aff.link.copyCode")}
          </button>
        </div>
        {copied ? (
          <p className="ok-text" role="status">
            {t("aff.link.copied")}
          </p>
        ) : null}
        <p className="muted small">{t("aff.link.lead", { days: d.attributionDays })}</p>
      </section>

      <ul className="affiliate__stats" aria-label={t("aff.title")}>
        <li className="affiliate__stat">
          <span className="affiliate__stat-label">{t("aff.stats.signups")}</span>
          <span className="affiliate__stat-value">{d.signups}</span>
        </li>
        <li className="affiliate__stat">
          <span className="affiliate__stat-label">{t("aff.stats.paying")}</span>
          <span className="affiliate__stat-value">{d.payingCustomers}</span>
        </li>
        <li className="affiliate__stat">
          <span className="affiliate__stat-label">{t("aff.stats.rate")}</span>
          <span className="affiliate__stat-value">{t("aff.stats.rateValue", { pct: formatCommissionPct(d.terms.commissionBps, lang) })}</span>
        </li>
        <li className="affiliate__stat">
          <span className="affiliate__stat-label">{t("aff.stats.duration")}</span>
          <span className="affiliate__stat-value">{t("aff.stats.durationValue", { months: d.terms.durationMonths })}</span>
        </li>
      </ul>

      <section className="card" aria-labelledby="aff-payout-h">
        <h2 id="aff-payout-h" className="card__title">
          {t("aff.payout.title")}
        </h2>
        <p>{t("aff.payout.progress", { payable: money(d.totals.payableCents), threshold: money(d.terms.payoutThresholdCents) })}</p>
        <div className="usage__track affiliate__progress" role="progressbar" aria-label={t("aff.payout.progressLabel")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <div className="usage__fill" style={{ width: `${progress}%` }} />
        </div>
        <p className="small">{missing === 0 && d.totals.payableCents > 0 ? t("aff.payout.reached") : t("aff.payout.missing", { missing: money(missing) })}</p>
        <dl className="affiliate__totals">
          <div>
            <dt>{t("aff.totals.pending")}</dt>
            <dd>{money(d.totals.pendingCents)}</dd>
          </div>
          <div>
            <dt>{t("aff.totals.payable")}</dt>
            <dd>{money(d.totals.payableCents)}</dd>
          </div>
          <div>
            <dt>{t("aff.totals.paid")}</dt>
            <dd>{money(d.totals.paidCents)}</dd>
          </div>
        </dl>
        <p className="muted small">{t("aff.payout.hold", { days: d.holdDays })}</p>
      </section>

      <section className="card" aria-labelledby="aff-ledger-h">
        <h2 id="aff-ledger-h" className="card__title">
          {t("aff.ledger.title")}
        </h2>
        {d.commissions.length === 0 ? (
          <p className="muted">{t("aff.ledger.empty")}</p>
        ) : (
          <div className="affiliate__table-wrap">
            <table className="affiliate__table">
              <thead>
                <tr>
                  <th scope="col">{t("aff.ledger.date")}</th>
                  <th scope="col">{t("aff.ledger.net")}</th>
                  <th scope="col">{t("aff.ledger.rate")}</th>
                  <th scope="col">{t("aff.ledger.amount")}</th>
                  <th scope="col">{t("aff.ledger.status")}</th>
                </tr>
              </thead>
              <tbody>
                {d.commissions.map((c) => (
                  <tr key={c.id}>
                    <td>{formatDateTime(c.earnedAt, locale)}</td>
                    <td>{c.kind === "clawback" ? t("aff.ledger.clawback") : money(c.netRevenueCents)}</td>
                    <td>{formatCommissionPct(c.commissionBps, lang)} %</td>
                    <td className={c.amountCents < 0 ? "affiliate__neg" : undefined}>{money(c.amountCents)}</td>
                    <td>
                      <Badge tone={STATUS_TONE[c.status]}>{t(`aff.status.${c.status}` as TKey)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card affiliate__rules" aria-labelledby="aff-rules-h">
        <h2 id="aff-rules-h" className="card__title">
          {t("aff.rules.title")}
        </h2>
        <ul>
          <li>{t("aff.rules.disclose")}</li>
          <li>{t("aff.rules.casl")}</li>
          <li>{t("aff.rules.claims")}</li>
          <li>{t("aff.rules.brand")}</li>
          <li>{t("aff.rules.self")}</li>
          <li>{t("aff.rules.privacy")}</li>
        </ul>
      </section>
    </div>
  );
}
