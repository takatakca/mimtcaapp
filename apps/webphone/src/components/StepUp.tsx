// Step-up for sensitive actions (docs/MIMT-SECURITY.md): when the API answers 403 step_up_required, ask the person to
// confirm with a passkey or a fresh SMS code, then run the action again. Valid 10 minutes on the API side.
import type { SecurityStatusResponse } from "@mimt/shared";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../api/client";
import { ApiClientError, toErrorKey } from "../api/errors";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";
import { isPasskeyCancel, passkeysSupported, signWithPasskey } from "../lib/passkeys";
import { ErrorNote, Field } from "./ui";

export const isStepUpRequired = (e: unknown) => e instanceof ApiClientError && e.code === "step_up_required";

/** The confirmation panel itself (also used inline on the Sécurité page). */
export function StepUpPanel({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<SecurityStatusResponse | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TKey | null>(null);

  useEffect(() => {
    let live = true;
    api.securityStatus().then((s) => live && setStatus(s), (e: unknown) => live && setError(toErrorKey(e)));
    return () => {
      live = false;
    };
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (!isPasskeyCancel(e)) setError(toErrorKey(e));
    } finally {
      setBusy(false);
    }
  };
  const viaPasskey = () =>
    run(async () => {
      const options = await api.stepUpPasskeyOptions();
      await api.stepUpPasskeyVerify({ challengeToken: options.challengeToken, response: await signWithPasskey(options) });
      onDone();
    });
  const sendCode = () =>
    run(async () => {
      await api.stepUpSmsStart();
      setCodeSent(true);
    });
  const verifyCode = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.stepUpSmsVerify({ code: code.trim() });
      onDone();
    });
  };

  const canPasskey = Boolean(status?.passkeysEnabled && status.passkeys > 0 && passkeysSupported());
  return (
    <div className="stack">
      <p className="muted">{t("security.stepUp.lead")}</p>
      {status && !canPasskey && !status.stepUpPhone ? <p className="note note--warn">{t("security.stepUp.noMethod")}</p> : null}
      {canPasskey ? (
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void viaPasskey()}>
          {t("security.stepUp.passkey")}
        </button>
      ) : null}
      {status?.stepUpPhone && !codeSent ? (
        <button type="button" className={`btn ${canPasskey ? "btn--ghost" : "btn--primary"}`} disabled={busy} onClick={() => void sendCode()}>
          {t("security.stepUp.sms", { phone: status.stepUpPhone })}
        </button>
      ) : null}
      {codeSent ? (
        <form className="stack" onSubmit={verifyCode}>
          <Field id="stepup-code" label={t("security.stepUp.codeLabel")}>
            <input id="stepup-code" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <button type="submit" className="btn btn--primary" disabled={busy || code.trim().length < 4}>
            {t("security.stepUp.verify")}
          </button>
        </form>
      ) : null}
      <ErrorNote error={error} />
      {onCancel ? (
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
          {t("security.stepUp.cancel")}
        </button>
      ) : null}
    </div>
  );
}

/**
 * const { guard, dialog } = useStepUp();
 * await guard(() => api.deleteAccount());   // asks for a confirmation on step_up_required, then retries once
 * …and render {dialog} somewhere in the page.
 */
export function useStepUp(): { guard: <T>(fn: () => Promise<T>) => Promise<T>; dialog: ReactNode } {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const pending = useRef<{ resolve: () => void; reject: () => void } | null>(null);

  const guard = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (!isStepUpRequired(e)) throw e;
      const confirmed = await new Promise<boolean>((resolve) => {
        pending.current = { resolve: () => resolve(true), reject: () => resolve(false) };
        setOpen(true);
      });
      setOpen(false);
      if (!confirmed) throw e;
      return fn();
    }
  }, []);

  const dialog = open ? (
    <div className="stepup-backdrop">
      <section className="card stepup" role="dialog" aria-modal="true" aria-labelledby="stepup-h">
        <h2 id="stepup-h" className="card__title">
          {t("security.stepUp.title")}
        </h2>
        <StepUpPanel onDone={() => pending.current?.resolve()} onCancel={() => pending.current?.reject()} />
      </section>
    </div>
  ) : null;
  return { guard, dialog };
}
