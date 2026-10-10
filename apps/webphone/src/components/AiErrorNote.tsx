import { Link } from "react-router";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";

/** Error of an AI feature; when consent is missing, links to the consent switch in Compte. */
export function AiErrorNote({ error }: { error: TKey | null | undefined }) {
  const { t } = useI18n();
  if (!error) return null;
  return (
    <div className="note note--error" role="alert">
      <span>{t(error)}</span>
      {error === "error.aiConsentRequired" ? (
        <Link to="/compte#ia" className="btn btn--ghost btn--sm">
          {t("ai.consent.manage")}
        </Link>
      ) : null}
    </div>
  );
}
