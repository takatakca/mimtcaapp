// /lier?code=…&r=… — consent page of a « MIMT Connect » account link (docs/MIMT-CONNECT.md « Liaison de compte » and
// « Consentement »). The partner (e.g. BesoinAvocat) shows its member a one-time code and this link; the signed-in MIMT
// user sees who asks (name, legal name, privacy contact), the purpose of each access, which ones the partner says it
// requires, and checks each access separately (nothing is checked in advance). Approval needs a step-up (passkey or SMS
// code) and leaves a receipt. An « upgrade » request changes the accesses of an existing link the same way.
import {
  PARTNER_CONSENT_COMMON,
  PARTNER_SCOPE_TEXT,
  type MyPartnerLinkDto,
  type PartnerLinkPreview,
  type PartnerScope,
} from "@mimt/shared";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { api } from "../api/client";
import { toErrorKey } from "../api/errors";
import { useStepUp } from "../components/StepUp";
import { Badge, ErrorNote, Field, Loading, PageHeader } from "../components/ui";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";

export function PartnerLink() {
  const { t, lang } = useI18n();
  const [params] = useSearchParams();
  const requestId = params.get("r") ?? undefined;
  const [code, setCode] = useState(params.get("code") ?? "");
  const [preview, setPreview] = useState<PartnerLinkPreview | null>(null);
  const [checked, setChecked] = useState<Set<PartnerScope>>(new Set());
  const [linked, setLinked] = useState<MyPartnerLinkDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const { guard, dialog } = useStepUp();
  const L = lang === "en" ? "en" : "fr";

  const codeBody = () => ({ code: code.trim(), ...(requestId ? { requestId } : {}) });
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
  const check = () =>
    run(async () => {
      const p = await api.previewPartnerLink(codeBody());
      setPreview(p);
      // Nothing is checked in advance, except what the person already granted (an upgrade shows the current state).
      setChecked(new Set(p.scopes.filter((s) => s.granted).map((s) => s.scope)));
    });

  // Opened from the partner's link: check the code at once.
  useEffect(() => {
    if (params.get("code")) void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void check();
  };
  const toggle = (scope: PartnerScope, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(scope);
      else next.delete(scope);
      return next;
    });

  const missing = preview ? preview.scopes.filter((s) => s.required && !checked.has(s.scope)) : [];
  const canApprove = Boolean(preview) && !missing.length && checked.size > 0 && !busy;
  const approve = () =>
    run(async () => {
      if (!preview) return;
      const scopes = preview.scopes.map((s) => s.scope).filter((s) => checked.has(s));
      setLinked(await guard(() => api.approvePartnerLink({ ...codeBody(), scopes, consentVersion: preview.consentVersion })));
    });

  return (
    <div className="page">
      <PageHeader title={t("partnerLink.title")} sub={t("partnerLink.lead")} />
      <section className="card stack" aria-live="polite">
        {linked ? (
          <>
            <p className="ok-text" role="status">
              {preview?.kind === "upgrade" ? t("partnerLink.doneUpgrade", { partner: linked.partnerName }) : t("partnerLink.done", { partner: linked.partnerName })}
            </p>
            <p className="muted small">{t("partnerLink.receiptKept")}</p>
            <p className="muted small">{t("partnerLink.revocable")}</p>
            <Link to="/compte/integrations" className="btn btn--primary">
              {t("partnerLink.seeIntegrations")}
            </Link>
          </>
        ) : preview ? (
          <>
            <h2 className="card__title">
              {t(preview.kind === "upgrade" ? "partnerLink.askUpgrade" : "partnerLink.ask", { partner: preview.partnerName, externalId: preview.externalId })}
            </h2>
            <p className="muted">{t("partnerLink.profile", { name: preview.memberName })}</p>

            <div className="stack">
              <strong>{t("partnerLink.who")}</strong>
              <span className="small">
                {preview.partnerName}
                {preview.partnerLegalName ? ` · ${t("partnerLink.legalName", { name: preview.partnerLegalName })}` : ""}
              </span>
              {preview.privacyContactEmail ? (
                <span className="small">
                  {t("partnerLink.privacyContact")}
                  <a href={`mailto:${preview.privacyContactEmail}`}>{preview.privacyContactEmail}</a>
                </span>
              ) : null}
              {preview.termsVersion ? <span className="muted small">{t("partnerLink.termsVersion", { version: preview.termsVersion })}</span> : null}
            </div>

            <p>{PARTNER_CONSENT_COMMON[L].linkEffect}</p>

            <fieldset className="stack">
              <legend>
                <strong>{t("partnerLink.choose", { partner: preview.partnerName })}</strong>
              </legend>
              <p className="field__hint">{t("partnerLink.chooseHint")}</p>
              {preview.scopes.map((s) => {
                const text = PARTNER_SCOPE_TEXT[s.scope][L];
                const id = `scope-${s.scope.replace(".", "-")}`;
                return (
                  <div key={s.scope} className="stack">
                    <label className="check" htmlFor={id}>
                      <input id={id} type="checkbox" checked={checked.has(s.scope)} disabled={busy} onChange={(e) => toggle(s.scope, e.target.checked)} />
                      <span>
                        <strong>{text.label}</strong> {s.required ? <Badge tone="warn">{t("partnerLink.required")}</Badge> : null}{" "}
                        {s.granted ? <Badge tone="muted">{t("partnerLink.alreadyGranted")}</Badge> : null}
                      </span>
                    </label>
                    <span className="small">{t("partnerLink.sees", { text: text.sees })}</span>
                    <span className="muted small">{t("partnerLink.never", { text: text.never })}</span>
                    <span className="small">{t("partnerLink.purpose", { partner: preview.partnerName, purpose: s.purpose })}</span>
                    {s.required ? <span className="muted small">{t("partnerLink.requiredWhy", { partner: preview.partnerName })}</span> : null}
                  </div>
                );
              })}
            </fieldset>

            <p className="muted small">{PARTNER_CONSENT_COMMON[L].cannot}</p>
            <p className="field__hint">{PARTNER_CONSENT_COMMON[L].revoke}</p>
            <p className="muted small">{t("partnerLink.version", { version: preview.consentVersion })}</p>
            {missing.length ? (
              <p className="note note--info">{t("partnerLink.missingRequired", { list: missing.map((s) => PARTNER_SCOPE_TEXT[s.scope][L].label).join(", ") })}</p>
            ) : checked.size === 0 ? (
              <p className="note note--info">{t("partnerLink.noneChecked")}</p>
            ) : null}
            <div className="row">
              <button type="button" className="btn btn--primary" disabled={!canApprove} onClick={() => void approve()}>
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
