import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const API_URL = process.env.MIMT_API_URL ?? "https://api.mimt.ca";

/** Bearer token of the operator's admin session, or redirect to /connexion. */
export async function adminToken(): Promise<string> {
  const token = (await cookies()).get("mimt_admin_token")?.value;
  if (!token) redirect("/connexion");
  return token;
}

export async function apiGet<T>(path: string, init?: { token?: string }): Promise<T> {
  const token = init?.token ?? (await adminToken());
  const res = await fetch(`${API_URL}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) redirect("/connexion?expired=1");
  if (!res.ok) throw new Error(`API ${res.status} sur ${path}`);
  return (await res.json()) as T;
}

/** Public health endpoint: no token needed. */
export async function apiGetPublic<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API ${res.status} sur ${path}`);
  return (await res.json()) as T;
}

export function apiUrl(): string {
  return API_URL;
}
