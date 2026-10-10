// Business overview: pooled usage, seats (lines), call recording policy and recent calls.
import { DEFAULT_RECORDING_CONSENT, formatCad, PLANS, type CallRecordingPolicy } from "@mimt/shared";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { toErrorKey } from "../../api/errors";
import { useSession } from "../../auth/SessionProvider";
import { Badge, Empty, ErrorNote, Field, Loading, UsageBar } from "../../components/ui";
import { useI18n } from "../../i18n/I18nProvider";
import type { TKey } from "../../i18n/core";
import { formatPhone } from "../../lib/dial";
import { formatDuration, formatWhen } from "../../lib/format";
import { usageLevel, usagePercent } from "../../lib/usage";
import { useAsync } from "../../lib/useAsync";
import { useBusiness } from "./shared";

const POOL_LABEL: Record<"outboundMinutes" | "inboundMinutes" | "outboundSms", TKey> = {
  outboundMinutes: "account.usageOutMin",
  inboundMinutes: "account.usageInMin",
  outboundSms: "account.usageSms",
};

export function BusinessOverview() {
  const { t, locale } = useI18n();
  const { id } = useBusiness();
  const usage = useAsync(() => api.businessUsage(id), [id]);
  const calls = useAsync(() => api.businessCalls(id), [id]);

  return (
    <>
      <div className="grid grid--2">
        <section className="card" aria-labelledby="pool-h">
          <h2 id="pool-h" className="card__title">
            {t("biz.usage")}
          </h2>
          <ErrorNote error={usage.error} onRetry={usage.reload} />
          {usage.loading ? <Loading /> : null}
          {usage.data ? (
            <>
              <p className="muted small">{t("biz.usageHint", { seats: usage.data.seats })}</p>
              {(["outboundMinutes", "inboundMinutes", "outboundSms"] as const).map((k) => {
                const { used, cap } = usage.data!.pooled[k];
                const percent = usagePercent(used, cap);
                return <UsageBar key={k} label={t(POOL_LABEL[k])} used={used} cap={cap} percent={percent} level={usageLevel(percent)} />;
              })}
              <p className="muted small">{t("biz.concurrent", { count: usage.data.pooled.concurrentCalls.cap })}</p>
            </>
          ) : null}
        </section>
        <SeatsCard />
      </div>
      <RecordingCard />
      <section className="card" aria-labelledby="bcalls-h">
        <h2 id="bcalls-h" className="card__title">
          {t("biz.recentCalls")}
        </h2>
        <ErrorNote error={calls.error} onRetry={calls.reload} />
        {calls.loading ? <Loading /> : null}
        {calls.data && calls.data.calls.length === 0 ? <Empty>{t("calls.empty")}</Empty> : null}
        <ul className="list">
          {calls.data?.calls.slice(0, 10).map((c) => (
            <li key={c.id} className="list__row">
              <span className="list__main">
                <span className="list__title">
                  {c.kind === "emergency" ? "9-1-1" : `${formatPhone(c.from)} → ${formatPhone(c.to)}`}
                </span>
                <span className="list__sub">
                  {t(c.direction === "inbound" ? "calls.incoming" : "calls.outgoing")}
                  {c.durationS ? ` · ${formatDuration(c.durationS)}` : ""}
                </span>
              </span>
              <span className="list__meta">{formatWhen(c.startedAt, locale, t("common.yesterday"))}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function SeatsCard() {
  const { t, lang } = useI18n();
  const { id, biz, canAdmin } = useBusiness();
  const { me, refreshMe } = useSession();
  const [count, setCount] = useState(biz.seats);
  const [msg, setMsg] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);
  const planCode = me?.account.plan === "business_pro" ? "business_pro" : "business";
  const price = PLANS[planCode].monthlyPriceCents;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.setSeats(id, count);
      setCount(r.seats);
      setMsg("biz.seatsSaved");
      await refreshMe();
    } catch (err) {
      setMsg(toErrorKey(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="seats-h">
      <h2 id="seats-h" className="card__title">
        {t("biz.seats")}
      </h2>
      <p className="muted small">{t("biz.seatsHint", { price: formatCad(price, lang) })}</p>
      <form className="row row--wrap" onSubmit={save}>
        <label htmlFor="seats" className="sr-only">
          {t("biz.seats")}
        </label>
        <input
          id="seats"
          className="input input--narrow"
          type="number"
          min={1}
          max={500}
          value={count}
          disabled={!canAdmin}
          onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
        />
        <button type="submit" className="btn btn--primary btn--sm" disabled={!canAdmin || busy || count === biz.seats}>
          {t("common.save")}
        </button>
      </form>
      <p className="muted small">{t("biz.seatsTotal", { total: formatCad(price * count, lang) })}</p>
      {msg ? (
        <p className={msg === "biz.seatsSaved" ? "ok-text" : "note note--error"} role="status">
          {t(msg)}
        </p>
      ) : null}
    </section>
  );
}

const MODE_KEY: Record<CallRecordingPolicy["mode"], TKey> = {
  off: "biz.recording.off",
  all: "biz.recording.all",
  on_demand: "biz.recording.onDemand",
};

function RecordingCard() {
  const { t } = useI18n();
  const { id, biz, canAdmin } = useBusiness();
  const { me, refreshMe } = useSession();
  const policy = biz.business.recordingPolicy;
  const [mode, setMode] = useState(policy.mode);
  const [fr, setFr] = useState(policy.consentPrompt.fr);
  const [en, setEn] = useState(policy.consentPrompt.en);
  const [days, setDays] = useState(policy.retentionDays);
  const [msg, setMsg] = useState<TKey | null>(null);
  const isPro = me?.account.plan === "business_pro";

  useEffect(() => {
    setMode(policy.mode);
    setFr(policy.consentPrompt.fr);
    setEn(policy.consentPrompt.en);
    setDays(policy.retentionDays);
  }, [policy]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (mode !== "off" && !fr.trim()) return setMsg("biz.recording.promptRequired");
    try {
      await api.setRecordingPolicy(id, { mode, consentPrompt: { fr: fr.trim(), en: en.trim() || DEFAULT_RECORDING_CONSENT.en }, retentionDays: days });
      setMsg("biz.recording.saved");
      await refreshMe();
    } catch (err) {
      setMsg(toErrorKey(err));
    }
  };

  return (
    <section className="card" aria-labelledby="rec-h">
      <h2 id="rec-h" className="card__title">
        {t("biz.recording.title")} {!isPro ? <Badge tone="muted">{t("biz.proOnly")}</Badge> : null}
      </h2>
      <p className="muted small">{t("biz.recording.intro")}</p>
      <form className="form-grid" onSubmit={save}>
        <Field id="rec-mode" label={t("biz.recording.mode")}>
          <select id="rec-mode" className="input" value={mode} disabled={!canAdmin} onChange={(e) => setMode(e.target.value as CallRecordingPolicy["mode"])}>
            {(Object.keys(MODE_KEY) as CallRecordingPolicy["mode"][]).map((m) => (
              <option key={m} value={m} disabled={m !== "off" && !isPro}>
                {t(MODE_KEY[m])}
              </option>
            ))}
          </select>
        </Field>
        <Field id="rec-days" label={t("biz.recording.retention")}>
          <input id="rec-days" className="input" type="number" min={1} max={365} value={days} disabled={!canAdmin} onChange={(e) => setDays(Number(e.target.value) || 1)} />
        </Field>
        <Field id="rec-fr" label={t("biz.recording.promptFr")}>
          <textarea id="rec-fr" className="input" rows={2} lang="fr-CA" value={fr} disabled={!canAdmin} onChange={(e) => setFr(e.target.value)} />
        </Field>
        <Field id="rec-en" label={t("biz.recording.promptEn")}>
          <textarea id="rec-en" className="input" rows={2} lang="en-CA" value={en} disabled={!canAdmin} onChange={(e) => setEn(e.target.value)} />
        </Field>
        <div className="form-grid__actions">
          <button type="submit" className="btn btn--primary" disabled={!canAdmin}>
            {t("common.save")}
          </button>
          {msg ? (
            <span className={msg === "biz.recording.saved" ? "ok-text" : "field__error"} role="status">
              {t(msg)}
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}
