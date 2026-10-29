// /points — « Portefeuille »: the MIMT Points balance (animated), active campaigns, how to earn (missions, a friend
// who subscribes, yearly plan, every bill), the catalog with a confirm step, the history and the rules.
// The API credits every point itself from a verified event; the only write here is POST /v1/points/redeem, with an
// idempotency key made once per confirmation (a double click or a retry never spends twice).
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { MISSION_POINTS_CAP, type PointsCampaignDto, type PointsRewardDto, type ReferralsResponse } from "@mimt/shared";
import { api } from "../api/client";
import { ApiClientError } from "../api/errors";
import { Icon } from "../components/Icon";
import { ErrorNote, Loading, PageHeader } from "../components/ui";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";
import { announcePoints, entryLabel, formatPoints, newRedeemKey } from "../lib/points";
import { useAsync } from "../lib/useAsync";

const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Counts up (or down) to `value` in about a second; jumps straight there with reduced motion. */
function AnimatedNumber({ value, lang }: { value: number; lang: "fr" | "en" }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value || reducedMotion() || typeof requestAnimationFrame !== "function") {
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / 900);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span aria-hidden="true">{formatPoints(shown, lang)}</span>;
}

const ERROR_KEYS = new Set(["insufficient_points", "monthly_limit", "not_eligible", "free_budget_reached", "fulfilment_failed", "points_paused", "points_owed", "rate_limited"]);

function errorKey(e: unknown): TKey {
  const code = e instanceof ApiClientError ? e.code : null;
  return (code && ERROR_KEYS.has(code) ? `points.error.${code}` : "points.error.generic") as TKey;
}

export function Points() {
  const { t, lang } = useI18n();
  const wallet = useAsync(() => api.points(), []);
  const catalog = useAsync(() => api.pointsCatalog(), []);
  const reload = () => {
    wallet.reload();
    catalog.reload();
  };

  if ((wallet.loading && !wallet.data) || (catalog.loading && !catalog.data)) return <Loading />;
  if (!wallet.data || !catalog.data) return <ErrorNote error={wallet.error ?? catalog.error} onRetry={reload} />;
  const w = wallet.data;
  const cat = catalog.data;

  return (
    <div className="page pts-page">
      <PageHeader title={t("points.title")} sub={t("points.lead")} />
      {w.enabled ? null : <p className="note note--warn">{t("points.off")}</p>}

      <section className="pts-hero" aria-labelledby="pts-balance-h">
        <p id="pts-balance-h" className="pts-mono">
          {t("points.balanceLabel")}
        </p>
        <p className="pts-balance">
          <AnimatedNumber value={w.balance} lang={lang} />
          <span className="sr-only">{t("points.balance", { points: formatPoints(w.balance, lang) })}</span>
          <span className="pts-balance__unit" aria-hidden="true">
            pts
          </span>
        </p>
        <p className="pts-mono pts-muted">{t("points.lifetime", { points: formatPoints(w.lifetimeEarned, lang) })}</p>
        {w.owed > 0 ? (
          <p className="pts-mono pts-muted" role="status">
            {t("points.owed", { points: formatPoints(w.owed, lang) })}
          </p>
        ) : null}
        {w.campaigns.length ? (
          <ul className="pts-campaigns">
            {w.campaigns.map((c) => (
              <CampaignChip key={c.id} c={c} />
            ))}
          </ul>
        ) : null}
      </section>

      <EarnSection pointsPerDollar={w.rules.pointsPerDollar} referralPoints={w.rules.referralPoints} />

      <section aria-labelledby="pts-redeem-h">
        <h2 id="pts-redeem-h" className="pts-h2">
          <span className="pts-mono">02 //</span> {t("points.redeem.title")}
        </h2>
        <ul className="pts-grid">
          {cat.rewards.map((r) => (
            <RewardCard key={r.id} reward={r} balance={cat.balance} onDone={reload} />
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="pts-history-h">
        <h2 id="pts-history-h" className="card__title">
          {t("points.history.title")}
        </h2>
        {w.history.length ? (
          <ul className="pts-history">
            {w.history.map((e) => (
              <li key={e.id}>
                <span className="pts-history__label">{entryLabel(e, lang)}</span>
                <time className="pts-mono pts-muted" dateTime={e.createdAt}>
                  {new Date(e.createdAt).toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", { day: "numeric", month: "short", year: "numeric" })}
                </time>
                <span className={`pts-delta ${e.delta < 0 ? "pts-delta--neg" : ""}`}>
                  {e.delta > 0 ? "+" : e.delta < 0 ? "−" : ""}
                  {formatPoints(Math.abs(e.delta), lang)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t("points.history.empty")}</p>
        )}
      </section>

      <section className="card pts-rules" aria-labelledby="pts-rules-h">
        <h2 id="pts-rules-h" className="card__title">
          {t("points.rules.title")}
        </h2>
        <ul>
          <li>{t("points.rules.noCash")}</li>
          <li>{t("points.rules.earn")}</li>
          <li>{t("points.rules.noChance")}</li>
          <li>{t("points.rules.noSocial")}</li>
          <li>{t("points.rules.caps", { daily: formatPoints(w.rules.dailyEarnCap, lang), monthly: formatPoints(w.rules.monthlyEarnCap, lang) })}</li>
          {w.rules.expiryMonths ? <li>{t("points.rules.expiry", { months: w.rules.expiryMonths })}</li> : null}
          <li>{t("points.rules.monthly")}</li>
          <li>{t("points.rules.change")}</li>
        </ul>
      </section>
    </div>
  );
}

function CampaignChip({ c }: { c: PointsCampaignDto }) {
  const { t, lang } = useI18n();
  const date = new Date(c.endsAt).toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", { day: "numeric", month: "long" });
  const text = c.kind === "multiplier" ? t("points.campaign.multiplier", { multiplier: c.multiplier ?? 1, name: c.name }) : t("points.campaign.bonus", { points: c.bonusPoints ?? 0, name: c.name });
  return (
    <li className="pts-chip">
      <Icon name="sparkle" size={14} /> {text} <span className="pts-muted">· {t("points.campaign.until", { date })}</span>
    </li>
  );
}

function EarnSection({ pointsPerDollar, referralPoints }: { pointsPerDollar: number; referralPoints: number }) {
  const { t, lang } = useI18n();
  const [ref, setRef] = useState<ReferralsResponse | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api.referrals().then(setRef, () => undefined);
  }, []);

  const copy = async () => {
    if (!ref) return;
    try {
      await navigator.clipboard.writeText(ref.shareUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const share = async () => {
    if (!ref) return;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "MIMT", text: t("points.shareText", { code: ref.code }), url: ref.shareUrl });
        return;
      } catch (e) {
        if ((e as DOMException)?.name === "AbortError") return;
      }
    }
    await copy();
  };

  return (
    <section aria-labelledby="pts-earn-h">
      <h2 id="pts-earn-h" className="pts-h2">
        <span className="pts-mono">01 //</span> {t("points.earn.title")}
      </h2>
      <ul className="pts-grid">
        <li className="pts-card">
          <p className="pts-card__title">{t("points.earn.missions")}</p>
          <p className="muted small">{t("points.earn.missionsLead", { points: formatPoints(MISSION_POINTS_CAP, lang) })}</p>
          <Link to="/missions" className="btn btn--ghost btn--sm">
            {t("points.earn.go")}
          </Link>
        </li>
        <li className="pts-card">
          <p className="pts-card__title">{t("points.earn.referral")}</p>
          <p className="muted small">{t("points.earn.referralLead", { points: formatPoints(referralPoints, lang) })}</p>
          <div className="row row--wrap">
            <button type="button" className="btn btn--primary btn--sm" onClick={() => void share()} disabled={!ref}>
              <Icon name="link" size={16} /> {t("points.share")}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void copy()} disabled={!ref}>
              <Icon name="copy" size={16} /> {t("points.copy")}
            </button>
          </div>
          {copied ? (
            <p className="ok-text small" role="status">
              {t("points.copied")}
            </p>
          ) : null}
        </li>
        <li className="pts-card">
          <p className="pts-card__title">{t("points.earn.yearly")}</p>
          <p className="muted small">{t("points.earn.yearlyLead")}</p>
          <Link to="/compte#forfait" className="btn btn--ghost btn--sm">
            {t("points.earn.go")}
          </Link>
        </li>
        <li className="pts-card">
          <p className="pts-card__title">{t("points.earn.invoices")}</p>
          <p className="muted small">{t("points.earn.invoicesLead", { points: pointsPerDollar })}</p>
        </li>
      </ul>
    </section>
  );
}

function RewardCard({ reward: r, balance, onDone }: { reward: PointsRewardDto; balance: number; onDone: () => void }) {
  const { t, lang } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // One key per confirmation: a retry of the same confirmation reuses it, a new confirmation gets a new one.
  const key = useRef<string | null>(null);
  const label = r.label[lang];

  const confirm = async () => {
    key.current ??= newRedeemKey();
    setBusy(true);
    setError(null);
    try {
      const res = await api.redeemPoints({ rewardId: r.id, idempotencyKey: key.current });
      key.current = null;
      setConfirming(false);
      setDone(
        res.until
          ? t("points.redeem.doneUntil", { date: new Date(res.until).toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", { day: "numeric", month: "long" }) })
          : t("points.redeem.done", { reward: label }),
      );
      announcePoints(res.balance);
      onDone();
    } catch (e) {
      // A refused redemption debited nothing (or was refunded): the next confirmation is a new attempt.
      if (e instanceof ApiClientError && e.status !== null && e.status < 500) key.current = null;
      setError(errorKey(e));
    } finally {
      setBusy(false);
    }
  };

  const unavailable =
    r.unavailableReason === "balance"
      ? t("points.unavailable.balance", { points: formatPoints(Math.max(0, r.points - balance), lang) })
      : r.unavailableReason
        ? t(`points.unavailable.${r.unavailableReason}` as TKey)
        : null;

  return (
    <li className={`pts-card pts-reward${r.available ? "" : " is-locked"}`}>
      <div className="pts-reward__top">
        <p className="pts-card__title">{label}</p>
        <span className="pts-price">{t("points.redeem.price", { points: formatPoints(r.points, lang) })}</span>
      </div>
      <p className="muted small">{r.description[lang]}</p>
      <p className="pts-mono pts-muted">{t("points.redeem.limit", { used: r.usedThisMonth, limit: r.monthlyLimit })}</p>
      {confirming ? (
        <div className="pts-confirm" role="group" aria-label={label}>
          <p>{t("points.redeem.confirm", { points: formatPoints(r.points, lang), reward: label })}</p>
          <div className="row row--wrap">
            <button type="button" className="btn btn--primary btn--sm" onClick={() => void confirm()} disabled={busy}>
              {t("points.redeem.confirmYes")}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirming(false)} disabled={busy}>
              {t("points.redeem.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={!r.available}
          aria-label={`${t("points.redeem.button")} : ${label}`}
          onClick={() => {
            setDone(null);
            setError(null);
            setConfirming(true);
          }}
        >
          {t("points.redeem.button")}
        </button>
      )}
      {unavailable && !confirming ? <p className="muted small">{unavailable}</p> : null}
      {done ? (
        <p className="ok-text small" role="status">
          {done}
        </p>
      ) : null}
      {error ? (
        <p className="note note--error small" role="alert">
          {t(error)}
        </p>
      ) : null}
    </li>
  );
}
