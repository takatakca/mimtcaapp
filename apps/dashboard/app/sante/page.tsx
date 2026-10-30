import { apiGet, apiGetPublic } from "@/lib/api";
import { fmtDate } from "@/lib/types";
import type { FraudResponse } from "@/lib/types";
import { DataTable, KpiCard, PageTitle, Section } from "@/components/ui";

interface Readyz {
  ok?: boolean;
  status?: string;
  schema?: string;
  [k: string]: unknown;
}

export default async function SantePage() {
  const [readyz, fraud] = await Promise.all([
    apiGetPublic<Readyz>("/readyz").catch((e: Error) => ({ ok: false, error: e.message })),
    apiGet<FraudResponse>("/v1/admin/fraud?limit=50"),
  ]);
  const healthy = (readyz as { ok?: boolean }).ok !== false && (readyz as { error?: string }).error === undefined;
  return (
    <>
      <PageTitle title="Santé" sub="État de l'API et événements antifraude récents." />
      <div className="kpi-grid">
        <KpiCard
          label="API"
          value={healthy ? <span className="pill ok">EN LIGNE</span> : <span className="pill bad">HORS LIGNE</span>}
          hint={(readyz as { schema?: string }).schema ? `schéma : ${(readyz as { schema?: string }).schema}` : undefined}
        />
        <KpiCard label="Événements antifraude" value={fraud.events.length} hint="50 derniers" />
      </div>
      {!healthy ? (
        <Section title="Détail /readyz">
          <pre className="card" style={{ maxWidth: "100%", overflow: "auto" }}>
            {JSON.stringify(readyz, null, 2)}
          </pre>
        </Section>
      ) : null}
      <Section title="Par règle">
        <DataTable
          headers={["Règle", "Nombre"]}
          rows={Object.entries(fraud.byRule).map(([rule, n]) => [rule, <span className="num" key={rule}>{n}</span>])}
          empty="Aucun événement."
        />
      </Section>
      <Section title="Par action">
        <DataTable
          headers={["Action", "Nombre"]}
          rows={Object.entries(fraud.byAction).map(([action, n]) => [action, <span className="num" key={action}>{n}</span>])}
          empty="Aucun événement."
        />
      </Section>
      <Section title="Événements récents">
        <DataTable
          headers={["Règle", "Score", "Action", "Compte", "Date"]}
          rows={fraud.events.map((e) => [
            e.rule,
            <span className="num" key="s">{e.score}</span>,
            e.action === "block" ? (
              <span className="pill bad" key="a">{e.action}</span>
            ) : e.action === "alert" ? (
              <span className="pill info" key="a">{e.action}</span>
            ) : (
              <span className="pill warn" key="a">{e.action}</span>
            ),
            e.telecomAccountId ? <span title={e.telecomAccountId} key="c">{e.telecomAccountId.slice(0, 8)}…</span> : "—",
            fmtDate(e.at),
          ])}
          empty="Aucun événement antifraude récent."
        />
      </Section>
      <p className="muted">
        Le taux d'échec OTP n'est pas persisté côté serveur (Twilio Verify est externe) : surveillez-le dans la
        console Twilio.
      </p>
    </>
  );
}
