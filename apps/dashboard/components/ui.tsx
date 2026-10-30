import type { ReactNode } from "react";

export function KpiCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {hint ? <div className="kpi-hint">{hint}</div> : null}
    </div>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function DataTable({ headers, rows, empty }: { headers: string[]; rows: ReactNode[][]; empty?: string }) {
  if (rows.length === 0) return <p className="muted">{empty ?? "Aucune donnée."}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PageTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="page-head">
      <h1>{title}</h1>
      {sub ? <p className="muted">{sub}</p> : null}
    </header>
  );
}
