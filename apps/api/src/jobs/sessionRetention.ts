// Law 25 retention for the session inventory (docs/MIMT-SECURITY.md): sessions revoked, or not seen, for more than
// SESSION_RETENTION_DAYS are deleted with their coarse device label and network. Refresh tokens expire after 30 days,
// so an idle session can no longer be used long before it is deleted.
import type { AppDeps } from "../deps.js";

export const SESSION_RETENTION_DAYS = 90;

export async function runSessionRetention(deps: Pick<AppDeps, "repo" | "now">): Promise<{ deleted: number }> {
  const before = new Date(deps.now().getTime() - SESSION_RETENTION_DAYS * 86_400_000);
  return { deleted: await deps.repo.security.pruneSessions(before) };
}
