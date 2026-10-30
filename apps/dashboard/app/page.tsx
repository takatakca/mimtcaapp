import { apiGet } from "@/lib/api";
import { cad } from "@/lib/types";
import type { Overview } from "@/lib/types";
import { KpiCard, PageTitle } from "@/components/ui";

export default async function OverviewPage() {
  const o = await apiGet<Overview>("/v1/admin/overview");
  return (
    <>
      <PageTitle title="Vue d'ensemble" sub="Indicateurs clés des 30 derniers jours (inscriptions : 7 et 30 jours)." />
      <div className="kpi-grid">
        <KpiCard label="Inscriptions (7 j)" value={o.signups7d} />
        <KpiCard label="Inscriptions (30 j)" value={o.signups30d} />
        <KpiCard label="Utilisateurs actifs" value={o.activeUsers} />
        <KpiCard label="MRR" value={cad(o.mrrCents)} hint="forfaits en direct, prix mensuels" />
        <KpiCard label="Appels (30 j)" value={o.calls30d} />
        <KpiCard label="Messages (30 j)" value={o.messages30d} />
        <KpiCard label="Messageries vocales (30 j)" value={o.voicemails30d} />
      </div>
      <p className="muted">
        MRR approximatif : somme des prix mensuels des forfaits en direct (actif / essai / en souffrance). Les
        abonnements annuels sont comptés au prorata mensuel de leur prix affiché.
      </p>
    </>
  );
}
