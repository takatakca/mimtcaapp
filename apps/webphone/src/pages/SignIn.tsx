import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { api } from "../api/client";
import { toErrorKey } from "../api/errors";
import { useSession } from "../auth/SessionProvider";
import { isTakatakConfigured, safeReturnTo, startTakatakSignIn } from "../auth/takatak";
import { ErrorNote, Wordmark } from "../components/ui";
import { env } from "../env";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";
import { afterSignIn } from "../lib/numberHold";
import { LanguageSwitch } from "./LanguageSwitch";

export function SignIn() {
  const { t, lang } = useI18n();
  const { signIn } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);
  const returnTo = safeReturnTo((location.state as { from?: unknown } | null)?.from ?? afterSignIn());
  const configured = env.mock || isTakatakConfigured();

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      if (env.mock) {
        // Demo mode: the fixture API accepts any code.
        await signIn(await api.takatakExchange({ code: "demo", codeVerifier: "demo", redirectUri: window.location.origin }));
        navigate(returnTo, { replace: true });
        return;
      }
      await startTakatakSignIn(lang === "fr" ? "fr-CA" : "en-CA", returnTo);
    } catch (e) {
      setError(toErrorKey(e));
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth__card">
        <div className="auth__top">
          <Wordmark />
          <LanguageSwitch />
        </div>
        <h1 className="auth__title">{t("signin.webTitle")}</h1>
        <p className="auth__lead">{t("signin.webLead")}</p>
        <Link to="/connexion/texto" className="btn btn--primary btn--block btn--lg">
          {t("signin.sms")}
        </Link>
        <ul className="auth__perks">
          <li>{t("signin.perkNoPassword")}</li>
          <li>{t("signin.perkNoContract")}</li>
          <li>{t("signin.perkFrench")}</li>
        </ul>
        <div className="auth__divider">
          <span>{t("signin.or")}</span>
        </div>
        <button type="button" className="btn btn--ghost btn--block" onClick={start} disabled={busy || !configured}>
          {t("signin.takatak")}
        </button>
        <p className="field__hint">{configured ? t("signin.takatakHint") : t("signin.notConfigured")}</p>
        <ErrorNote error={error} />
        <p className="auth__legal">{t("signin.terms")}</p>
        <div className="auth__e911">
          <strong>{t("signin.e911Title")}</strong> {t("signin.e911Body")}
        </div>
      </div>
      <p className="auth__foot">{t("app.tagline")}</p>
    </div>
  );
}
