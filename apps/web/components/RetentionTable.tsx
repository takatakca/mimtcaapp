import { retentionRows } from "@/lib/retention";
import type { Lang } from "@/lib/site";

/** Privacy policy: retention period per kind of information (lib/retention.ts, values from the code). */
export function RetentionTable({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  return (
    <div className="table-wrap" role="region" aria-label={fr ? "Durées de conservation" : "Retention periods"} tabIndex={0}>
      <table className="simple">
        <thead>
          <tr>
            <th scope="col">{fr ? "Renseignement" : "Information"}</th>
            <th scope="col">{fr ? "Durée de conservation" : "Retention"}</th>
          </tr>
        </thead>
        <tbody>
          {retentionRows(lang).map((r) => (
            <tr key={r.what}>
              <th scope="row">{r.what}</th>
              <td>{r.how}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
