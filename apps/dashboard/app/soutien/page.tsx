import { apiGet } from "@/lib/api";
import { fmtDate } from "@/lib/types";
import type { SupportResponse } from "@/lib/types";
import { DataTable, PageTitle, Section } from "@/components/ui";

export default async function SoutienPage({
  searchParams,
}: {
  searchParams: Promise<{ userId?: string }>;
}) {
  const sp = await searchParams;
  const path = sp.userId
    ? `/v1/admin/support-queue?userId=${encodeURIComponent(sp.userId)}`
    : "/v1/admin/support-queue";
  const s = await apiGet<SupportResponse>(path);
  const audit = sp.userId ? s.userAudit : s.recentAudit;
  return (
    <>
      <PageTitle title="Soutien" sub="File de soutien : utilisateurs non vérifiés, écarts 9-1-1, journal d'audit." />
      <Section title={`Utilisateurs non vérifiés (${s.unverifiedUsers.length})`}>
        <DataTable
          headers={["Nom", "Courriel", "Téléphone", "Créé", "Audit"]}
          rows={s.unverifiedUsers.map((u) => [
            u.displayName ?? "—",
            u.email ?? "—",
            u.phoneE164 ?? "—",
            fmtDate(u.createdAt),
            <a key="a" href={`/soutien?userId=${u.id}`}>voir</a>,
          ])}
          empty="Aucun utilisateur non vérifié récent."
        />
      </Section>
      <Section title={`Écarts 9-1-1 (${s.e911Gaps.length})`}>
        <DataTable
          headers={["Compte", "Adresse manquante", "Attestation manquante"]}
          rows={s.e911Gaps.map((g) => [
            <span title={g.ownerUserId} key="id">{g.accountId.slice(0, 8)}…</span>,
            g.missingAddress ? <span className="pill bad" key="a">oui</span> : <span className="pill ok" key="a">non</span>,
            g.missingAck ? <span className="pill bad" key="k">oui</span> : <span className="pill ok" key="k">non</span>,
          ])}
          empty="Aucun écart 9-1-1."
        />
      </Section>
      <Section
        title={sp.userId ? `Journal d'audit — ${sp.userId.slice(0, 8)}…` : "Journal d'audit récent"}
        action={sp.userId ? <a href="/soutien">tout voir</a> : undefined}
      >
        <DataTable
          headers={["Action", "Acteur", "Cible", "Date"]}
          rows={audit.map((e) => [
            e.action,
            e.actorUserId ? <span title={e.actorUserId} key="u">{e.actorUserId.slice(0, 8)}…</span> : "—",
            e.targetId ? <span title={`${e.targetType ?? ""}:${e.targetId}`} key="t">{e.targetId.slice(0, 8)}…</span> : "—",
            fmtDate(e.at),
          ])}
          empty="Aucune entrée."
        />
      </Section>
    </>
  );
}
