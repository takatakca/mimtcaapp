import { apiGet } from "@/lib/api";
import type { UsageResponse } from "@/lib/types";
import { DataTable, PageTitle, Section } from "@/components/ui";

export default async function UtilisationPage() {
  const u = await apiGet<UsageResponse>("/v1/admin/usage?limit=50");
  return (
    <>
      <PageTitle title="Utilisation" sub={`Période ${u.period} — minutes et messages par compte, par rapport aux plafonds du forfait.`} />
      <Section title="Comptes">
        <DataTable
          headers={["Compte", "Forfait", "Min. sort.", "Min. entr.", "SMS", "Plafond min.", "Plafond SMS", "Dépensé (CAD)"]}
          rows={u.accounts.map((a) => [
            <span title={a.ownerUserId} key="id">{a.accountId.slice(0, 8)}…</span>,
            a.plan,
            <span className="num" key="mo">{a.usage.minutesOut}</span>,
            <span className="num" key="mi">{a.usage.minutesIn}</span>,
            <span className="num" key="sms">{a.usage.smsOut + a.usage.smsIn}</span>,
            <span className="num" key="cm">{a.caps.outboundMinutes + a.caps.inboundMinutes}</span>,
            <span className="num" key="cs">{a.caps.messages}</span>,
            <span className="num" key="sp">{a.usage.spendCad.toFixed(2)}</span>,
          ])}
        />
      </Section>
      <Section title="Top parleurs (10)">
        <DataTable
          headers={["Compte", "Minutes (sort. + entr.)"]}
          rows={u.topTalkers.map((t) => [
            <span title={t.accountId} key="id">{t.accountId.slice(0, 8)}…</span>,
            <span className="num" key="m">{t.minutes}</span>,
          ])}
        />
      </Section>
      <Section title={`Écarts 9-1-1 (${u.e911Gaps.length})`}>
        <DataTable
          headers={["Compte", "Adresse manquante", "Attestation manquante"]}
          rows={u.e911Gaps.map((g) => [
            <span title={g.ownerUserId} key="id">{g.accountId.slice(0, 8)}…</span>,
            g.missingAddress ? <span className="pill bad" key="a">oui</span> : <span className="pill ok" key="a">non</span>,
            g.missingAck ? <span className="pill bad" key="k">oui</span> : <span className="pill ok" key="k">non</span>,
          ])}
          empty="Aucun écart 9-1-1 sur cette page."
        />
      </Section>
      <Section title="Inventaire des numéros par indicatif">
        <DataTable
          headers={["Indicatif", "Numéros détenus"]}
          rows={u.numberInventory.map((n) => [n.areaCode, <span className="num" key="c">{n.count}</span>])}
        />
      </Section>
    </>
  );
}
