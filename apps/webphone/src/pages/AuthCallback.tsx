import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api/client";
import { toErrorKey } from "../api/errors";
import { useSession } from "../auth/SessionProvider";
import { readCallback } from "../auth/takatak";
import { ErrorNote, Loading, Wordmark } from "../components/ui";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";

/** /auth/callback?code&state: checks state, then sends code + PKCE verifier to the MIMT API. */
export function AuthCallback() {
  const { t } = useI18n();
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<TKey | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // StrictMode runs effects twice; the code is single-use.
    ran.current = true;
    const result = readCallback(window.location.search);
    // Remove ?code&state from the address bar and history.
    window.history.replaceState(null, "", window.location.pathname);
    if (!result.ok) {
      setError(result.reason === "cancelled" ? "signin.cancelled" : "signin.callbackInvalid");
      return;
    }
    api
      .takatakExchange({ code: result.code, codeVerifier: result.verifier, redirectUri: result.redirectUri, nonce: result.nonce })
      .then((tokens) => signIn(tokens))
      .then(() => navigate(result.returnTo, { replace: true }))
      .catch((e: unknown) => setError(toErrorKey(e)));
  }, [navigate, signIn]);

  return (
    <div className="auth">
      <div className="auth__card">
        <Wordmark />
        <h1 className="auth__title">{t("signin.title")}</h1>
        {error ? (
          <>
            <ErrorNote error={error} />
            <Link to="/connexion" className="btn btn--ghost btn--block">
              {t("common.back")}
            </Link>
          </>
        ) : (
          <Loading />
        )}
      </div>
    </div>
  );
}
