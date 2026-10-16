import { featureLabel, capLines, price, yearly, type Plan } from "@/lib/plans-view";
import { href, type Lang } from "@/lib/site";

const BLURB: Record<string, { fr: string; en: string }> = {
  free: { fr: "Pour essayer, avec publicités.", en: "To try it out, with ads." },
  lock: { fr: "Le gratuit, sans perdre votre numéro.", en: "The free plan, without losing your number." },
  premium: { fr: "Pour en faire votre numéro principal.", en: "To make it your main number." },
  business: { fr: "Une ligne d'affaires complète.", en: "A complete business line." },
  business_pro: { fr: "Pour les équipes qui enregistrent leurs appels.", en: "For teams that record calls." },
};

export function PlanCard({ plan, lang, highlight, compact }: { plan: Plan; lang: Lang; highlight?: boolean; compact?: boolean }) {
  const fr = lang === "fr";
  const p = price(plan, lang);
  const y = yearly(plan, lang);
  const isBiz = plan.perLine;
  const features = plan.features.filter((f) => !(compact && f === "number_lock" && plan.code !== "lock"));
  return (
    <article className={`card plan${highlight ? " plan--highlight" : ""}`} aria-labelledby={`plan-${plan.code}`} data-tilt="">
      {/* "Recommandé", not "le plus populaire": MIMT has no subscribers yet, so popularity can't be claimed. */}
      {highlight ? <p className="plan__flag">{fr ? "Recommandé" : "Recommended"}</p> : null}
      <h3 id={`plan-${plan.code}`}>{plan.name[lang]}</h3>
      <p className="plan__blurb">{BLURB[plan.code]?.[lang]}</p>
      <p className="plan__price">
        <span className="plan__amount">{p.amount}</span>
        <span className="plan__unit">{p.unit}</span>
      </p>
      {y ? <p className="plan__yearly">{y}</p> : <p className="plan__yearly" aria-hidden="true">&nbsp;</p>}
      <ul className="checklist">
        {capLines(plan, lang).map((l) => (
          <li key={l}>{l}</li>
        ))}
        {plan.code === "free" || plan.code === "lock" ? (
          <li>{fr ? "Publicités dans l'app" : "Ads in the app"}</li>
        ) : null}
        <li>{fr ? "Messagerie vocale" : "Voicemail"}</li>
        {features.map((f) => (
          <li key={f}>{featureLabel(f, lang)}</li>
        ))}
        {isBiz ? <li>{fr ? "Réceptionniste IA" : "AI receptionist"}</li> : null}
        {isBiz ? <li>{fr ? "Heures d'ouverture et jours fériés du Québec" : "Business hours and Québec holidays"}</li> : null}
      </ul>
      <a
        className={`btn ${highlight ? "btn--primary" : "btn--outline"} plan__cta`}
        href={isBiz ? href(lang, "business", "demo") : href(lang, "home", fr ? "liste-attente" : "waitlist")}
      >
        {isBiz ? (fr ? "Demander une démo" : "Request a demo") : fr ? "Obtenir l'accès anticipé" : "Get early access"}
      </a>
    </article>
  );
}
