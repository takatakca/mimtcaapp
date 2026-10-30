import { apiGet } from "@/lib/api";
import { cad, fmtDate } from "@/lib/types";
import type { RevenueResponse } from "@/lib/types";
import { DataTable, KpiCard, PageTitle, Section } from "@/components/ui";

export default async function RevenusPage() {
  const r = await apiGet<RevenueResponse>("/v1/admin/revenue");
  return (
    <>
      <PageTitle title="Revenus" sub="Abonnements en direct, essais, recouvrement, affiliés et points." />
      <div className="kpi-grid">
        <KpiCard label="MRR" value={cad(r.mrrCents)} />
        <KpiCard label="Essais en cours" value={r.trials.length} />
        <KpiCard label="À recouvrer" value={r.dunning.length} hint="past_due + incomplete" />
        <KpiCard label="Commissions à payer" value={r.affiliatePayoutsPending.length} />
        <KpiCard label="Passif points" value={r.pointsLiability.toLocaleString("fr-CA")} hint="points en circulation" />
      </div>
      <Section title="Abonnements par forfait × canal">
        <DataTable
          headers={["Type", "Forfait", "Canal", "Nombre"]}
          rows={r.byPlanSource.map((b, i) => [b.kind, b.plan, b.source, <span className="num" key={i}>{b.count}</span>])}
        />
      </Section>
      <Section title={`Essais (${r.trials.length})`}>
        <DataTable
          headers={["Forfait", "Canal", "Fin de période"]}
          rows={r.trials.map((t) => [t.code, t.source, fmtDate(t.currentPeriodEnd)])}
          empty="Aucun essai en cours."
        />
      </Section>
      <Section title={`Recouvrement (${r.dunning.length})`}>
        <DataTable
          headers={["Forfait", "Statut", "Canal", "Fin de période"]}
          rows={r.dunning.map((t) => [
            t.code,
            <span className="pill warn" key="s">{t.status}</span>,
            t.source,
            fmtDate(t.currentPeriodEnd),
          ])}
          empty="Rien à recouvrer."
        />
      </Section>
      <Section title={`Commissions d'affiliés à payer (${r.affiliatePayoutsPending.length})`}>
        <DataTable
          headers={["Affilié", "Commission", "Reversé", "Payable le"]}
          rows={r.affiliatePayoutsPending.map((c) => [
            <span title={c.affiliateId} key="a">{c.affiliateId.slice(0, 8)}…</span>,
            <span className="num" key="c">{cad(c.commissionCents)}</span>,
            <span className="num" key="r">{cad(c.reversedCents)}</span>,
            fmtDate(c.payableAt),
          ])}
          empty="Aucune commission en attente."
        />
      </Section>
    </>
  );
}
