// Stripe Checkout comes back here (/billing/success, /billing/cancel; see apps/api/src/routes/billing.ts).
// After paying for a picked number, waits for the webhook to activate it and says so.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { formatNanp } from "@mimt/shared";
import { useSession } from "../auth/SessionProvider";
import { needsBusinessSetup } from "../lib/bizSetup";
import { useI18n } from "../i18n/I18nProvider";
import { clearPendingHold, pendingHold } from "../lib/numberHold";

export function BillingResult({ outcome }: { outcome: "success" | "cancel" }) {
  const { me, businesses, refreshMe } = useSession();
  const { locale } = useI18n();
  const fr = locale === "fr-CA";
  const [waitingForNumber] = useState(() => outcome === "success" && Boolean(pendingHold()));
  const active = me?.numbers.find((n) => n.state === "active" || n.state === "locked");

  // The webhook usually lands within seconds: poll /v1/me for up to a minute.
  useEffect(() => {
    if (!waitingForNumber || active) return;
    let n = 0;
    const t = window.setInterval(() => {
      if (++n > 20) return window.clearInterval(t);
      void refreshMe();
    }, 3000);
    return () => window.clearInterval(t);
  }, [waitingForNumber, active, refreshMe]);

  useEffect(() => {
    if (active) clearPendingHold();
  }, [active]);

  if (outcome === "cancel") {
    return (
      <section className="card">
        <h1 className="card__title">{fr ? "Paiement annulé" : "Payment cancelled"}</h1>
        <p>{fr ? "Rien n'a été facturé." : "Nothing was charged."}</p>
        <Link className="btn btn--primary" to={pendingHold() ? "/numero" : "/compte"}>
          {fr ? "Revenir" : "Go back"}
        </Link>
      </section>
    );
  }
  return (
    <section className="card" aria-live="polite">
      <h1 className="card__title">{fr ? "Paiement reçu, merci" : "Payment received, thank you"}</h1>
      {waitingForNumber ? (
        active ? (
          <p>
            {fr ? "Votre numéro est actif : " : "Your number is active: "}
            <strong>{formatNanp(active.e164, fr ? "fr" : "en")}</strong>
          </p>
        ) : (
          <p>{fr ? "Activation de votre numéro en cours…" : "Activating your number…"}</p>
        )
      ) : (
        <p>{fr ? "Votre forfait est à jour." : "Your plan is up to date."}</p>
      )}
      {needsBusinessSetup(me, businesses) ? (
        <div className="wiz-cta">
          <p>
            {fr
              ? "Votre forfait Affaires est prêt. Il reste à créer votre standard : 5 minutes, sans technicien."
              : "Your Business plan is ready. One thing left: create your phone system. 5 minutes, no technician."}
          </p>
          <Link className="btn btn--primary btn--lg" to="/affaires/nouvelle">
            {fr ? "Configurer mon standard" : "Set up my phone system"}
          </Link>
        </div>
      ) : null}
      <Link className={needsBusinessSetup(me, businesses) ? "btn btn--ghost" : "btn btn--primary"} to="/messages">
        {fr ? "Ouvrir MIMT" : "Open MIMT"}
      </Link>
    </section>
  );
}
