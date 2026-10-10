import { useI18n } from "../i18n/I18nProvider";

export function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();
  const next = lang === "fr" ? "en" : "fr";
  return (
    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setLang(next)} lang={next === "fr" ? "fr-CA" : "en-CA"}>
      {next === "fr" ? t("account.languageFr") : t("account.languageEn")}
    </button>
  );
}
