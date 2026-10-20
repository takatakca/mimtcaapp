// /numero: finish the number picked on mimt.ca (live picker). Hold → sign in → 9-1-1 address → plan → Stripe.
// The number is bought by the API when Stripe confirms the payment (services/numberProvisioning.ts).
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { formatCad, formatNanp, PLANS, type PaidPlanCode } from "@mimt/shared";
import { api } from "../api/client";
import { toErrorKey } from "../api/errors";
import { useSession } from "../auth/SessionProvider";
import { ErrorNote, Loading, Wordmark } from "../components/ui";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";
import { clearPendingHold, pendingHold, takeHoldFromHash, type PendingHold } from "../lib/numberHold";
import { useAsync } from "../lib/useAsync";
import { E911Section } from "./Account";
import { LanguageSwitch } from "./LanguageSwitch";

const SITE = "https://mimt.ca";

function useCountdown(expiresAt: string | undefined): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setLeft(Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 1000)));
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [expiresAt]);
  return left;
}

export function NumberCheckout() {
  const { status, me } = useSession();
  const { locale } = useI18n();
  const fr = locale === "fr-CA";
  const lang = fr ? "fr" : "en";
  const navigate = useNavigate();
  const [hold] = useState<PendingHold | null>(() => takeHoldFromHash() ?? pendingHold());
  const info = useAsync(() => (hold ? api.numberHold(hold.id, hold.token) : Promise.resolve(null)), [hold?.id]);
  const left = useCountdown(info.data?.expiresAt);
  const [plan, setPlan] = useState<PaidPlanCode>(hold?.plan === "business" ? "business" : (hold?.plan ?? "lock"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TKey | null>(null);

  const live = info.data && (info.data.status === "held" || info.data.status === "checkout") && left > 0;
  useEffect(() => {
    if (info.data && !live && info.data.expiresAt && left === 0 && Date.parse(info.data.expiresAt) <= Date.now()) clearPendingHold();
  }, [info.data, live, left]);

  if (status === "loading" || (hold && info.loading)) return <Loading />;

  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");
  const choices: PaidPlanCode[] = plan === "business" ? ["business", "business_pro"] : ["lock", "premium"];

  async function pay() {
    if (!hold) return;
    setBusy(true);
    setError(null);
    try {
      const { checkoutUrl } = await api.checkout({ plan, numberHold: { id: hold.id, token: hold.token } });
      window.location.assign(checkoutUrl);
    } catch (e) {
      setError(toErrorKey(e));
      setBusy(false);
    }
  }

  let body: React.ReactNode;
  if (!hold || info.error || !info.data) {
    body = (
      <>
        <h1 className="auth__title">{fr ? "Aucun numéro réservé" : "No number on hold"}</h1>
        <p className="auth__lead">{fr ? "Choisissez votre numéro sur mimt.ca : il sera réservé 10 minutes pour vous." : "Pick your number on mimt.ca: it is held for you for 10 minutes."}</p>
        <a className="btn btn--primary btn--block btn--lg" href={`${SITE}/${fr ? "" : "en/"}#numero`}>
          {fr ? "Choisir un numéro" : "Pick a number"}
        </a>
      </>
    );
  } else if (!live) {
    body = (
      <>
        <h1 className="auth__title">{fr ? "La réservation a pris fin" : "The hold has ended"}</h1>
        <p className="auth__lead">
          {info.data.status === "converted"
            ? fr
              ? "Ce numéro est déjà activé sur un compte."
              : "This number is already active on an account."
            : fr
              ? "Le numéro est retourné dans la liste. Vous pouvez le chercher à nouveau ou en choisir un autre."
              : "The number went back to the list. Search for it again or pick another one."}
        </p>
        <a className="btn btn--primary btn--block btn--lg" href={`${SITE}/${fr ? "" : "en/"}#numero`}>
          {fr ? "Choisir un numéro" : "Pick a number"}
        </a>
      </>
    );
  } else {
    const number = formatNanp(info.data.e164, lang);
    body = (
      <>
        <p className="hold-card__eyebrow">{fr ? "Réservé pour vous" : "Held for you"}</p>
        <h1 className="hold-card__number">{number}</h1>
        <p className="auth__lead">
          {fr ? "Personne d'autre chez MIMT ne peut le prendre pendant " : "No one else at MIMT can take it for "}
          <strong>
            {mm}:{ss}
          </strong>
          .
        </p>
        {status !== "signedIn" ? (
          <>
            <p className="auth__lead">{fr ? "Étape 1 sur 3 : créez votre compte ou connectez-vous." : "Step 1 of 3: create your account or sign in."}</p>
            <button type="button" className="btn btn--primary btn--block btn--lg" onClick={() => navigate("/connexion", { state: { from: "/numero" } })}>
              {fr ? "Continuer avec TAKATAK" : "Continue with TAKATAK"}
            </button>
            <Link to="/connexion/texto" className="btn btn--ghost btn--block">
              {fr ? "Recevoir un code par texto" : "Get a code by text"}
            </Link>
          </>
        ) : !me?.e911.addressRegistered || !me.e911.noticeAccepted ? (
          <>
            <p className="auth__lead">
              {fr
                ? "Étape 2 sur 3 : l'adresse où vous utiliserez MIMT, pour le 9-1-1. Elle est exigée avant d'activer un numéro."
                : "Step 2 of 3: the address where you will use MIMT, for 9-1-1. It is required before a number is activated."}
            </p>
            <E911Section />
          </>
        ) : (
          <>
            <p className="auth__lead">{fr ? "Étape 3 sur 3 : votre forfait. Le numéro s'active dès le paiement." : "Step 3 of 3: your plan. The number turns on as soon as you pay."}</p>
            <fieldset className="plan-pick">
              <legend className="sr-only">{fr ? "Forfait" : "Plan"}</legend>
              {choices.map((code) => (
                <label key={code} className={`plan-pick__opt${plan === code ? " is-on" : ""}`}>
                  <input type="radio" name="plan" value={code} checked={plan === code} onChange={() => setPlan(code)} />
                  <span className="plan-pick__name">{PLANS[code].name[lang]}</span>
                  <span className="plan-pick__price">
                    {formatCad(PLANS[code].monthlyPriceCents, lang)}
                    {PLANS[code].perLine ? (fr ? " / ligne / mois" : " / line / month") : fr ? " / mois" : " / month"}
                  </span>
                  <span className="plan-pick__caps">
                    {fr
                      ? `${PLANS[code].caps.outboundMinutes} min sortantes, ${PLANS[code].caps.inboundMinutes} min entrantes, ${PLANS[code].caps.outboundSms} textos`
                      : `${PLANS[code].caps.outboundMinutes} outbound min, ${PLANS[code].caps.inboundMinutes} inbound min, ${PLANS[code].caps.outboundSms} texts`}
                  </span>
                </label>
              ))}
            </fieldset>
            <button type="button" className="btn btn--primary btn--block btn--lg" disabled={busy} onClick={() => void pay()}>
              {fr ? `Payer et activer ${number}` : `Pay and activate ${number}`}
            </button>
            <p className="field__hint">{fr ? "Paiement sécurisé par Stripe. Taxes (TPS, TVQ, 9-1-1) en sus." : "Secure payment by Stripe. Taxes (GST, QST, 9-1-1) extra."}</p>
            <ErrorNote error={error} />
          </>
        )}
      </>
    );
  }

  return (
    <div className="auth">
      <div className="auth__card hold-card" aria-live="polite">
        <div className="auth__top">
          <Wordmark />
          <LanguageSwitch />
        </div>
        {body}
      </div>
    </div>
  );
}
