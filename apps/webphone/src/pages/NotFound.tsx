import { Link } from "react-router";
import { PageHeader } from "../components/ui";
import { useI18n } from "../i18n/I18nProvider";

export function NotFound() {
  const { t } = useI18n();
  return (
    <div className="page">
      <PageHeader title={t("notFound.title")} />
      <p className="muted">{t("notFound.body")}</p>
      <Link to="/accueil" className="btn btn--primary">
        {t("notFound.home")}
      </Link>
    </div>
  );
}
