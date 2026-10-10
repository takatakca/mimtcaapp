// Business hours (America/Montreal), Quebec statutory holidays, custom closures, open/closed routing.
import {
  DEFAULT_WEEKLY_SCHEDULE,
  quebecStatutoryHolidays,
  WEEKDAYS,
  type BusinessHoursRequest,
  type Holiday,
  type Weekday,
} from "@mimt/shared";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { toErrorKey } from "../../api/errors";
import { Icon } from "../../components/Icon";
import { Badge, ErrorNote, Loading } from "../../components/ui";
import { useI18n } from "../../i18n/I18nProvider";
import type { TKey } from "../../i18n/core";
import { validateTarget, validateWeekly } from "../../lib/ivr";
import { useAsync } from "../../lib/useAsync";
import { TargetPicker, targetContext, useBusiness, useDirectory, useIssueText } from "./shared";

const DAY_KEY: Record<Weekday, TKey> = {
  mon: "day.mon",
  tue: "day.tue",
  wed: "day.wed",
  thu: "day.thu",
  fri: "day.fri",
  sat: "day.sat",
  sun: "day.sun",
};

const ROUTE_TYPES = ["extension", "ring_group", "ivr", "voicemail", "external", "ai_receptionist", "directory", "hangup"] as const;

export function Hours() {
  const { t, locale } = useI18n();
  const { id, canAdmin } = useBusiness();
  const dir = useDirectory(id);
  const current = useAsync(() => api.hours(id), [id]);
  const [form, setForm] = useState<BusinessHoursRequest | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [msg, setMsg] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [holiday, setHoliday] = useState<Holiday>({ date: "", name: "" });

  useEffect(() => {
    const h = current.data?.hours;
    if (h) {
      setForm({ weekly: h.weekly, holidays: h.holidays, quebecHolidays: h.quebecHolidays, openTarget: h.openTarget, closedTarget: h.closedTarget });
    }
  }, [current.data]);

  const ctx = targetContext(dir.data);
  const issues = form
    ? [
        ...validateWeekly(form.weekly),
        ...validateTarget(form.openTarget, ctx, "openTarget"),
        ...validateTarget(form.closedTarget, ctx, "closedTarget"),
      ]
    : [];
  const issue = useIssueText(showIssues ? issues : []);
  const year = new Date().getFullYear();

  if (!form) {
    return (
      <section className="card">
        <ErrorNote error={current.error ?? dir.error} onRetry={current.reload} />
        {current.loading ? <Loading /> : null}
      </section>
    );
  }

  const setDay = (day: Weekday, ranges: BusinessHoursRequest["weekly"][Weekday]) => setForm({ ...form, weekly: { ...form.weekly, [day]: ranges } });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setShowIssues(true);
    if (issues.length) return;
    setBusy(true);
    try {
      const r = await api.putHours(id, form);
      current.setData(() => r);
      setMsg("biz.hours.saved");
    } catch (err) {
      setMsg(toErrorKey(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={save} noValidate>
      <section className="card" aria-labelledby="hours-h">
        <div className="card__head">
          <h2 id="hours-h" className="card__title">
            {t("biz.hours.weekly")}
          </h2>
          {current.data ? (
            <Badge tone={current.data.open ? "ok" : "muted"}>{current.data.open ? t("biz.hours.openNow") : t("biz.hours.closedNow")}</Badge>
          ) : null}
        </div>
        <p className="muted small">{t("biz.hours.intro")}</p>
        <div className="hours">
          {WEEKDAYS.map((day) => {
            const ranges = form.weekly[day] ?? [];
            const dayIssue = issue(`weekly.${day}`) ?? ranges.map((_, i) => issue(`weekly.${day}.${i}`)).find(Boolean) ?? null;
            return (
              <div key={day} className="hours__day">
                <span className="hours__name">{t(DAY_KEY[day])}</span>
                <div className="hours__ranges">
                  {ranges.length === 0 ? <span className="muted">{t("biz.hours.closed")}</span> : null}
                  {ranges.map((r, i) => (
                    <span key={i} className="hours__range">
                      <input
                        type="time"
                        className="input input--time"
                        aria-label={t("biz.hours.opensAt", { day: t(DAY_KEY[day]) })}
                        value={r.open}
                        disabled={!canAdmin}
                        onChange={(e) => setDay(day, ranges.map((x, j) => (j === i ? { ...x, open: e.target.value } : x)))}
                      />
                      –
                      <input
                        type="time"
                        className="input input--time"
                        aria-label={t("biz.hours.closesAt", { day: t(DAY_KEY[day]) })}
                        value={r.close}
                        disabled={!canAdmin}
                        onChange={(e) => setDay(day, ranges.map((x, j) => (j === i ? { ...x, close: e.target.value } : x)))}
                      />
                      {canAdmin ? (
                        <button type="button" className="icon-btn" onClick={() => setDay(day, ranges.filter((_, j) => j !== i))} aria-label={t("biz.hours.removeRange")}>
                          <Icon name="close" size={16} />
                        </button>
                      ) : null}
                    </span>
                  ))}
                  {canAdmin ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setDay(day, [...ranges, ranges.length ? { open: "13:00", close: "17:00" } : { open: "09:00", close: "17:00" }])}
                    >
                      <Icon name="plus" size={14} /> {t("biz.hours.addRange")}
                    </button>
                  ) : null}
                  {dayIssue ? (
                    <p className="field__error" role="alert">
                      {dayIssue}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        {canAdmin ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setForm({ ...form, weekly: DEFAULT_WEEKLY_SCHEDULE })}>
            {t("biz.hours.reset")}
          </button>
        ) : null}
      </section>

      <section className="card" aria-labelledby="hol-h">
        <h2 id="hol-h" className="card__title">
          {t("biz.hours.holidays")}
        </h2>
        <label className="check">
          <input type="checkbox" checked={form.quebecHolidays} disabled={!canAdmin} onChange={(e) => setForm({ ...form, quebecHolidays: e.target.checked })} />
          <span>{t("biz.hours.quebecHolidays")}</span>
        </label>
        {form.quebecHolidays ? (
          <details className="details">
            <summary>{t("biz.hours.quebecList", { year })}</summary>
            <ul className="plain">
              {quebecStatutoryHolidays(year).map((h) => (
                <li key={h.date}>
                  {new Date(`${h.date}T12:00:00`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "long" })} — {h.name}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <h3 className="small-title">{t("biz.hours.custom")}</h3>
        {form.holidays.length === 0 ? <p className="muted small">{t("biz.hours.noCustom")}</p> : null}
        <ul className="plain">
          {form.holidays.map((h) => (
            <li key={h.date} className="row">
              <span>
                {h.date} — {h.name}
              </span>
              {canAdmin ? (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setForm({ ...form, holidays: form.holidays.filter((x) => x.date !== h.date) })}
                  aria-label={t("biz.hours.removeHoliday", { name: h.name })}
                >
                  <Icon name="trash" size={16} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {canAdmin ? (
          <div className="row row--wrap">
            <input type="date" className="input input--narrow" aria-label={t("biz.hours.holidayDate")} value={holiday.date} onChange={(e) => setHoliday({ ...holiday, date: e.target.value })} />
            <input className="input" aria-label={t("biz.hours.holidayName")} placeholder={t("biz.hours.holidayName")} value={holiday.name} onChange={(e) => setHoliday({ ...holiday, name: e.target.value })} />
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={!/^\d{4}-\d{2}-\d{2}$/.test(holiday.date) || !holiday.name.trim() || form.holidays.some((x) => x.date === holiday.date)}
              onClick={() => {
                setForm({ ...form, holidays: [...form.holidays, { date: holiday.date, name: holiday.name.trim() }].sort((a, b) => a.date.localeCompare(b.date)) });
                setHoliday({ date: "", name: "" });
              }}
            >
              <Icon name="plus" size={14} /> {t("biz.hours.addHoliday")}
            </button>
          </div>
        ) : null}
      </section>

      <section className="card" aria-labelledby="route-h">
        <h2 id="route-h" className="card__title">
          {t("biz.hours.routing")}
        </h2>
        <div className="form-grid">
          <TargetPicker
            id="open-target"
            label={t("biz.hours.openTarget")}
            value={form.openTarget}
            onChange={(v) => v && setForm({ ...form, openTarget: v })}
            dir={dir.data}
            types={ROUTE_TYPES}
            error={issue("openTarget")}
            disabled={!canAdmin}
          />
          <TargetPicker
            id="closed-target"
            label={t("biz.hours.closedTarget")}
            value={form.closedTarget}
            onChange={(v) => v && setForm({ ...form, closedTarget: v })}
            dir={dir.data}
            types={ROUTE_TYPES}
            error={issue("closedTarget")}
            disabled={!canAdmin}
          />
        </div>
        <p className="field__hint">{t("biz.hours.routingHint")}</p>
      </section>

      {canAdmin ? (
        <div className="row">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {t("common.save")}
          </button>
          {msg ? (
            <span className={msg === "biz.hours.saved" ? "ok-text" : "field__error"} role="status">
              {t(msg)}
            </span>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
