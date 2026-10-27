// Mensuel / Annuel switch for plan checkout: yearly plans are 12 months for the price of 11 (owner decision
// 2026-10-27). Prices before taxes, as everywhere else (GST/QST and the 9-1-1 tax are added on the bill).
import { formatCad, type Plan } from "@mimt/shared";
import { useI18n } from "../i18n/I18nProvider";

export type BillingInterval = "month" | "year";

/** The plan's price for one interval, its per-month equivalent and the saving of the free month. */
export function intervalPrice(plan: Pick<Plan, "monthlyPriceCents" | "yearlyPriceCents">, interval: BillingInterval) {
  if (interval === "year" && plan.yearlyPriceCents) {
    return {
      totalCents: plan.yearlyPriceCents,
      perMonthCents: Math.round(plan.yearlyPriceCents / 12),
      savingCents: plan.monthlyPriceCents * 12 - plan.yearlyPriceCents,
    };
  }
  return { totalCents: plan.monthlyPriceCents, perMonthCents: plan.monthlyPriceCents, savingCents: 0 };
}

export function IntervalToggle({ value, onChange }: { value: BillingInterval; onChange: (v: BillingInterval) => void }) {
  const { t } = useI18n();
  return (
    <fieldset className="interval-toggle">
      <legend className="sr-only">{t("plan.interval.label")}</legend>
      {(["month", "year"] as const).map((v) => (
        <label key={v} className={`interval-toggle__opt${value === v ? " is-on" : ""}`}>
          <input type="radio" name="billing-interval" value={v} checked={value === v} onChange={() => onChange(v)} />
          <span>{t(v === "month" ? "plan.interval.month" : "plan.interval.year")}</span>
          {v === "year" ? <span className="interval-toggle__badge">{t("plan.interval.yearBadge")}</span> : null}
        </label>
      ))}
    </fieldset>
  );
}

/** "142,89 $ / an — soit 11,91 $ / mois, taxes en sus" (or the monthly price). */
export function PlanPrice({ plan, interval }: { plan: Pick<Plan, "monthlyPriceCents" | "yearlyPriceCents" | "perLine">; interval: BillingInterval }) {
  const { t, lang } = useI18n();
  const p = intervalPrice(plan, interval);
  const price = formatCad(p.totalCents, lang);
  if (interval === "month" || !plan.yearlyPriceCents) {
    return <>{t(plan.perLine ? "plan.perLineMonth" : "plan.perMonth", { price })}</>;
  }
  return (
    <>
      {t(plan.perLine ? "plan.perLineYear" : "plan.perYear", { price })}
      <small className="plan-equiv"> {t("plan.perMonthEquiv", { price: formatCad(p.perMonthCents, lang) })}</small>
    </>
  );
}

