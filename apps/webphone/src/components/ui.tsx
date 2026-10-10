import type { ReactNode } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";
import type { UsageLevel } from "../lib/usage";

export function Wordmark({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={`wordmark${compact ? " wordmark--compact" : ""}`}>
      <span className="wordmark__name">
        MIMT<span className="wordmark__suffix"> Web</span>
      </span>
      {!compact && <span className="wordmark__by">{t("app.by")}</span>}
    </div>
  );
}

export function PageHeader({ title, actions, sub }: { title: string; actions?: ReactNode; sub?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {sub ? <p className="page-header__sub">{sub}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function Loading() {
  const { t } = useI18n();
  return (
    <p className="muted" role="status">
      {t("common.loading")}
    </p>
  );
}

export function ErrorNote({ error, onRetry }: { error: TKey | null | undefined; onRetry?: () => void }) {
  const { t } = useI18n();
  if (!error) return null;
  return (
    <div className="note note--error" role="alert">
      <span>{t(error)}</span>
      {onRetry ? (
        <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>
          {t("common.retry")}
        </button>
      ) : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function UsageBar({ label, used, cap, percent, level }: { label: string; used: number; cap: number; percent: number; level: UsageLevel }) {
  const { t } = useI18n();
  return (
    <div className="usage">
      <div className="usage__row">
        <span>{label}</span>
        <span className="muted">{t("account.usageOf", { used, cap })}</span>
      </div>
      <div
        className={`usage__track usage__track--${level}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="usage__fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function Badge({ tone = "info", children }: { tone?: "info" | "ok" | "warn" | "error" | "muted"; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function Field({ label, hint, error, children, id }: { label: string; hint?: string; error?: string | null; children: ReactNode; id: string }) {
  return (
    <div className={`field${error ? " field--error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint ? <p className="field__hint">{hint}</p> : null}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function DemoBanner() {
  const { t } = useI18n();
  return <div className="demo-banner">{t("app.demo")}</div>;
}
