// /lier?code=…&r=… — consent page of a « MIMT Connect » account link (docs/MIMT-CONNECT.md « Liaison de compte »).
// The partner (e.g. BesoinAvocat) shows its member a one-time code and this link; the signed-in MIMT user sees who
// asks, for which profile, and what the partner will see and do, then approves with a step-up (passkey or SMS code).
import type { MyPartnerLinkDto, PartnerLinkPermission, PartnerLinkPreview } from "@mimt/shared";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { api } from "../api/client";
import { toErrorKey } from "../api/errors";
import { useStepUp } from "../components/StepUp";
import { ErrorNote, Field, Loading, PageHeader } from "../components/ui";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";

const PERMISSION_KEYS: Record<PartnerLinkPermission, TKey> = {
  calls: "partnerLink.perm.calls",
  click_to_call: "partnerLink.perm.click_to_call",
  number: "partnerLink.perm.number",
};

export function PartnerLink() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const requestId = params.get("r") ?? undefined;
  const [code, setCode] = useState(params.get("code") ?? "");
  const [preview, setPreview] = useState<PartnerLinkPreview | null>(null);
  const [linked, setLinked] = useState<MyPartnerLinkDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const { guard, dialog } = useStepUp();

  const body = () => ({ code: code.trim(), ...(requestId ? { requestId } : {}) });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(toErrorKey(e));
    } finally {
      setBusy(false);
    }
  };
  const check = () => run(async () => setPreview(await api.previewPartnerLink(body())));

  // Opened from the partner's link: check the code at once.
  useEffect(() => {
    if (params.get("code")) void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void check();
  };
  const approve = () => run(async () => setLinked(await guard(() => api.approvePartnerLink(body()))));

  return (
    <div className="page">
      <PageHeader title={t("partnerLink.title")} sub={t("partnerLink.lead")} />
      <section className="card stack" aria-live="polite">
        {linked ? (
          <>
            <p className="ok-text" role="status">
              {t("partnerLink.done", { partner: linked.partnerName })}
            </p>
            <p className="muted small">{t("partnerLink.revocable")}</p>
            <Link to="/compte/integrations" className="btn btn--primary">
              {t("partnerLink.seeIntegrations")}
            </Link>
          </>
        ) : preview ? (
          <>
            <h2 className="card__title">{t("partnerLink.ask", { partner: preview.partnerName, externalId: preview.externalId })}</h2>
            <p className="muted">{t("partnerLink.profile", { name: preview.memberName })}</p>
            <p>
              <strong>{t("partnerLink.canTitle", { partner: preview.partnerName })}</strong>
            </p>
            <ul>
              {preview.permissions.map((p) => (
                <li key={p}>{t(PERMISSION_KEYS[p])}</li>
              ))}
            </ul>
            <p className="muted small">{t("partnerLink.cannot")}</p>
            <p className="field__hint">{t("partnerLink.revocable")}</p>
            <div className="row">
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void approve()}>
                {t("partnerLink.approve")}
              </button>
              <Link to="/compte/integrations" className="btn btn--ghost">
                {t("partnerLink.cancel")}
              </Link>
            </div>
          </>
        ) : busy ? (
          <Loading />
        ) : (
          <form className="stack" onSubmit={submit}>
            <Field id="partner-link-code" label={t("partnerLink.codeLabel")} hint={t("partnerLink.codeHint")}>
              <input id="partner-link-code" value={code} autoComplete="one-time-code" maxLength={12} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <button type="submit" className="btn btn--primary" disabled={busy || code.trim().length < 8}>
              {t("partnerLink.check")}
            </button>
          </form>
        )}
        <ErrorNote error={error} />
      </section>
      {dialog}
    </div>
  );
}
