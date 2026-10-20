import type { ReactNode } from "react";
import { PageHero, Shell } from "@/components/Shell";
import { PlanCard } from "@/components/PlanCard";
import { Offers } from "@/components/Offers";
import {
  ADD_ONS,
  ALL_PLANS,
  BUSINESS_PLANS,
  CONSUMER_PLANS,
  featureLabel,
  PLANS,
  formatCad,
  num,
  price,
  type Feature,
  type Plan,
} from "@/lib/plans-view";
import { serviceLd } from "@/lib/seo";
import { href, type Lang } from "@/lib/site";

const ROW_FEATURES: Feature[] = [
  "no_ads",
  "number_lock",
  "vm_transcription",
  "mms",
  "call_forwarding",
  "auto_attendant",
  "ring_groups",
  "admin_portal",
  "call_recording",
  "ai_assist",
  "video_meetings",
];

function Yes({ lang }: { lang: Lang }) {
  return (
    <span className="yes">
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="sr-only">{lang === "fr" ? "Inclus" : "Included"}</span>
    </span>
  );
}
function No({ lang }: { lang: Lang }) {
  return (
    <span className="no">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{lang === "fr" ? "Non inclus" : "Not included"}</span>
    </span>
  );
}

export function PlansPage({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  const rows: { label: string; cell: (p: Plan) => ReactNode }[] = [
    {
      label: fr ? "Prix" : "Price",
      cell: (p) => {
        const x = price(p, lang);
        return (
          <>
            <strong>{x.amount}</strong> {x.unit}
            {p.yearlyPriceCents ? (
              <>
                <br />
                <small>
                  {fr ? "ou " : "or "}
                  {formatCad(p.yearlyPriceCents, lang)}
                  {fr ? "/an" : "/year"}
                </small>
              </>
            ) : null}
          </>
        );
      },
    },
    {
      label: fr ? "Numéro de téléphone canadien" : "Canadian phone number",
      cell: (p) => (p.caps.hasNumber ? (fr ? "Inclus, attribué tout de suite" : "Included, assigned right away") : fr ? "Non (entre applications MIMT)" : "No (MIMT apps only)"),
    },
    {
      label: fr ? "Minutes sortantes/mois (Canada et É.-U.)" : "Outbound minutes/month (Canada & US)",
      cell: (p) =>
        p.caps.hasNumber
          ? num(p.caps.outboundMinutes, lang) + (p.perLine ? (fr ? " par ligne" : " per line") : "")
          : fr
            ? `${num(p.caps.onNetMinutes ?? 0, lang)} entre applications MIMT`
            : `${num(p.caps.onNetMinutes ?? 0, lang)} between MIMT apps`,
    },
    {
      label: fr ? "Minutes entrantes/mois" : "Inbound minutes/month",
      cell: (p) => (p.caps.hasNumber ? num(p.caps.inboundMinutes, lang) + (p.perLine ? (fr ? " par ligne" : " per line") : "") : "—"),
    },
    {
      label: fr ? "Textos/mois (envoyés et reçus)" : "Texts/month (sent and received)",
      cell: (p) =>
        p.caps.hasNumber
          ? num(p.caps.messages, lang) + (p.perLine ? (fr ? " par ligne" : " per line") : "")
          : fr
            ? "Illimités entre applications MIMT"
            : "Unlimited between MIMT apps",
    },
    { label: fr ? "Appels simultanés" : "Simultaneous calls", cell: (p) => num(p.caps.concurrentCalls, lang) },
    {
      label: fr ? "Numéro sans activité" : "Number when inactive",
      cell: (p) =>
        !p.caps.hasNumber
          ? "—"
          : p.caps.inactivityDays === null
          ? fr
            ? "Conservé tant que le forfait est payé"
            : "Kept while the plan is paid"
          : fr
            ? `Récupéré après ${p.caps.inactivityDays} jours`
            : `Reclaimed after ${p.caps.inactivityDays} days`,
    },
    { label: fr ? "Messagerie vocale" : "Voicemail", cell: () => <Yes lang={lang} /> },
    { label: "9-1-1", cell: () => (fr ? "Inclus (voir limites)" : "Included (see limits)") },
    ...ROW_FEATURES.map((f) => ({
      label: featureLabel(f, lang),
      cell: (p: Plan) => (p.features.includes(f) ? <Yes lang={lang} /> : <No lang={lang} />),
    })),
  ];

  return (
    <Shell lang={lang} page="plans" ld={[serviceLd(lang, "mobile"), serviceLd(lang, "business")]}>
      <PageHero
        eyebrow={fr ? "Forfaits" : "Plans"}
        title={fr ? "Des forfaits clairs, sans surprise" : "Clear plans, no surprises"}
        lead={
          fr
            ? "Chaque forfait affiche ses limites. Vous savez exactement ce que vous payez et ce qui est inclus."
            : "Every plan shows its limits. You know exactly what you pay and what's included."
        }
      />

      <section className="section" aria-labelledby="mobile-plans">
        <div className="container">
          <div className="notice notice--info" role="note">
            <strong>{fr ? "Prix proposés pour le lancement." : "Proposed launch prices."}</strong>{" "}
            {fr
              ? "MIMT n'est pas encore offert. Les prix et les limites peuvent changer d'ici le lancement; nous les confirmerons avant toute inscription payante."
              : "MIMT is not available yet. Prices and limits may change before launch; we'll confirm them before any paid sign-up."}
          </div>
          <h2 id="mobile-plans">MIMT Mobile</h2>
          <div className="grid grid--3">
            {CONSUMER_PLANS.map((c) => (
              <PlanCard key={c} plan={PLANS[c]} lang={lang} highlight={c === "premium"} />
            ))}
          </div>
          <p className="fineprint">
            {fr ? "Le 9-1-1 par Internet a des limites (panne d'Internet ou de courant, adresse à tenir à jour). " : "9-1-1 over the internet has limits (internet or power outage, address to keep current). "}
            <a href={href(lang, "e911")}>{fr ? "Lire la page 9-1-1" : "Read the 9-1-1 page"}</a>
          </p>
          <Offers lang={lang} />

          <h2 className="mt-xl">MIMT {fr ? "Affaires" : "Business"}</h2>
          <div className="grid grid--2">
            {BUSINESS_PLANS.map((c) => (
              <PlanCard key={c} plan={PLANS[c]} lang={lang} />
            ))}
          </div>
        </div>
      </section>

      <section className="section section--tint" aria-labelledby="compare">
        <div className="container">
          <h2 id="compare">{fr ? "Comparer les forfaits" : "Compare plans"}</h2>
          <div className="table-wrap" role="region" aria-labelledby="compare" tabIndex={0}>
            <table className="compare">
              <caption className="sr-only">
                {fr ? "Comparaison des forfaits MIMT, prix avant taxes" : "MIMT plan comparison, prices before tax"}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{fr ? "Forfait" : "Plan"}</th>
                  {ALL_PLANS.map((c) => (
                    <th scope="col" key={c}>
                      {PLANS[c].name[lang]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <th scope="row">{r.label}</th>
                    {ALL_PLANS.map((c) => (
                      <td key={c}>{r.cell(PLANS[c])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="fineprint">
            {fr
              ? "Taxes en sus (TPS/TVQ) et taxe municipale 9-1-1 du Québec. Les appels internationaux ne sont pas inclus : ils se paient avec un crédit prépayé (non offert avec le forfait Gratuit)."
              : "Taxes extra (GST/QST) and the Québec 9-1-1 municipal tax. International calls are not included: they use prepaid credit (not available on the Free plan)."}
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="addons">
        <div className="container">
          <h2 id="addons">{fr ? "Options" : "Add-ons"}</h2>
          <ul className="grid grid--3">
            <li className="card addon">
              <h3>{ADD_ONS.extra_number.name[lang]}</h3>
              <p className="addon__price">
                {formatCad(ADD_ONS.extra_number.monthlyPriceCents, lang)}
                {fr ? "/mois" : "/month"}
              </p>
              <p>{fr ? "Un deuxième numéro canadien dans la même app." : "A second Canadian number in the same app."}</p>
            </li>
            <li className="card addon">
              <h3>{ADD_ONS.minutes_250.name[lang]}</h3>
              <p className="addon__price">{formatCad(ADD_ONS.minutes_250.priceCents, lang)}</p>
              <p>
                {fr
                  ? "Bloc de 250 minutes sortantes (Canada et É.-U.), pour un mois plus occupé."
                  : "A block of 250 outbound minutes (Canada & US) for a busier month."}
              </p>
            </li>
            <li className="card addon">
              <h3>{ADD_ONS.intl_credit_min.name[lang]}</h3>
              <p className="addon__price">
                {fr ? "À partir de " : "From "}
                {formatCad(ADD_ONS.intl_credit_min.priceCents, lang)}
              </p>
              <p>
                {fr
                  ? "Appels internationaux payés d'avance, au tarif affiché dans l'app. Aucune facture surprise."
                  : "Prepaid international calls at the rate shown in the app. No surprise bills."}
              </p>
            </li>
          </ul>
          <p className="fineprint">
            {fr ? "Le réceptionniste IA est inclus avec Affaires et Affaires Pro. " : "The AI receptionist is included with Business and Business Pro. "}
            <a href={href(lang, "ai")}>{fr ? "Fonctions IA" : "AI features"}</a>
            {" · "}
            <a href={href(lang, "compare")}>{fr ? "Comparer avec les applis de numéro gratuit" : "Compare with free-number apps"}</a>
            <br />
            {fr ? "Une question sur les forfaits? " : "Questions about plans? "}
            <a href={href(lang, "help")}>{fr ? "Consultez l'aide" : "Visit help"}</a>
            {fr ? " ou " : " or "}
            <a href={href(lang, "contact")}>{fr ? "écrivez-nous" : "write to us"}</a>.
          </p>
        </div>
      </section>
    </Shell>
  );
}
