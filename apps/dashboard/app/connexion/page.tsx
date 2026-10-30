import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { apiUrl } from "@/lib/api";
import { PageTitle } from "@/components/ui";

async function login(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "").trim();
  if (!token) redirect("/connexion?error=1");
  // Validate the token before storing it: it must belong to an admin user.
  const res = await fetch(`${apiUrl()}/v1/admin/overview`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) redirect("/connexion?error=1");
  (await cookies()).set("mimt_admin_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 86_400,
  });
  redirect("/");
}

export default async function ConnexionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; expired?: string }>;
}) {
  const sp = await searchParams;
  return (
    <>
      <PageTitle title="Connexion" sub="Collez le jeton porteur d'une session admin (utilisateur dans CATALOG_ADMIN_USER_IDS)." />
      <div className="card">
        {sp.error ? <p className="error">Jeton invalide ou refusé. Réessayez.</p> : null}
        {sp.expired ? <p className="error">Session expirée. Reconnectez-vous.</p> : null}
        <form action={login}>
          <div className="field">
            <label htmlFor="token">Jeton porteur admin</label>
            <input id="token" name="token" type="password" autoComplete="off" placeholder="eyJ…" required />
          </div>
          <button type="submit">Se connecter</button>
        </form>
        <p className="muted" style={{ marginTop: 16 }}>
          Astuce : copiez le jeton depuis une session webphone ouverte en tant qu'administrateur. Le jeton est
          conservé 24 h dans un cookie httpOnly.
        </p>
      </div>
    </>
  );
}
