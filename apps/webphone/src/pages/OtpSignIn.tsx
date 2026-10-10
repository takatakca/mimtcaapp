import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api/client";
import { toErrorKey } from "../api/errors";
import { useSession } from "../auth/SessionProvider";
import { ErrorNote, Field, Wordmark } from "../components/ui";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";
import { formatPhone, toDialable } from "../lib/dial";

export function OtpSignIn() {
  const { t } = useI18n();
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const e164 = toDialable(phone);
    if (!e164 || e164 === "911") {
      setError("otp.invalidPhone");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.otpStart(e164);
      setSentTo(e164);
    } catch (err) {
      setError(toErrorKey(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!sentTo) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(await api.otpVerify(sentTo, code.trim()));
      navigate("/messages", { replace: true });
    } catch (err) {
      const key = toErrorKey(err);
      setError(key === "error.session" ? "error.invalidCode" : key);
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth__card">
        <Wordmark />
        <h1 className="auth__title">{t("otp.title")}</h1>
        {!sentTo ? (
          <form onSubmit={send} className="stack" noValidate>
            <Field id="otp-phone" label={t("otp.phoneLabel")}>
              <input
                id="otp-phone"
                className="input"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder={t("otp.phonePlaceholder")}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </Field>
            <button type="submit" className="btn btn--primary btn--block" disabled={busy || !phone}>
              {t("otp.send")}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="stack" noValidate>
            <p className="muted" role="status">
              {t("otp.sentTo", { phone: formatPhone(sentTo) })}
            </p>
            <Field id="otp-code" label={t("otp.codeLabel")}>
              <input
                id="otp-code"
                className="input input--code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{4,8}"
                maxLength={8}
                placeholder={t("otp.codePlaceholder")}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                required
              />
            </Field>
            <button type="submit" className="btn btn--primary btn--block" disabled={busy || code.length < 4}>
              {t("otp.verify")}
            </button>
            <button type="button" className="btn btn--ghost btn--block" onClick={() => void send()} disabled={busy}>
              {t("otp.resend")}
            </button>
          </form>
        )}
        <ErrorNote error={error} />
        <Link to="/connexion" className="auth__back">
          {t("common.back")}
        </Link>
      </div>
    </div>
  );
}
