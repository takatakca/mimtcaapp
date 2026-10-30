import { apiGet } from "@/lib/api";
import { fmtDate } from "@/lib/types";
import type { DashboardUser } from "@/lib/types";
import { DataTable, PageTitle, Section } from "@/components/ui";

const planPill = (plan: string) =>
  plan === "free" ? <span className="pill">Gratuit</span> : <span className="pill info">{plan}</span>;

export default async function UtilisateursPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q ?? "";
  const { users } = await apiGet<{ users: DashboardUser[] }>(`/v1/admin/users?q=${encodeURIComponent(q)}&limit=50`);
  return (
    <>
      <PageTitle title="Utilisateurs" sub="Recherche par courriel, téléphone ou nom. Les comptes affichent forfait, canal et numéros." />
      <form className="searchbar" action="/utilisateurs" method="get">
        <input type="text" name="q" defaultValue={q} placeholder="courriel, +1514…, nom" />
        <button type="submit">Chercher</button>
      </form>
      <Section title={`${users.length} utilisateur(s)`}>
        <DataTable
          headers={["Nom", "Courriel", "Téléphone", "Statut", "Vérifié", "Forfait", "Canal", "Numéros", "Créé"]}
          rows={users.map((u) => [
            u.displayName ?? "—",
            u.email ?? "—",
            u.phoneE164 ?? "—",
            u.status,
            u.phoneVerifiedAt ? <span className="pill ok">oui</span> : <span className="pill warn">non</span>,
            u.account ? planPill(u.account.plan) : "—",
            u.account?.planSource ?? "—",
            u.account?.numbers.join(", ") || "—",
            fmtDate(u.createdAt),
          ])}
          empty={q ? "Aucun utilisateur trouvé." : "Aucun utilisateur récent."}
        />
      </Section>
    </>
  );
}
