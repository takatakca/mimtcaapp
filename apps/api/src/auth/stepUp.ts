// Step-up for sensitive actions and the business « require_strong_auth » policy (docs/MIMT-SECURITY.md).
//
// - requireRecentAuth: the session authenticated with a passkey or a fresh SMS code within STEP_UP_WINDOW_S
//   (10 minutes). Used by: call forwarding to an external number, deleting the account, adding/removing a passkey,
//   changing the business security policy, partner API keys and webhook secrets, approving a « MIMT Connect » account link
//   (POST /v1/me/partner-links/approve). Port-out must call it too once it exists.
// - assertBusinessStrongAuth: owners/admins of a business with require_strong_auth must have confirmed this session
//   with a passkey before the business admin routes answer.
import { STEP_UP_WINDOW_S } from "@mimt/shared";
import type { FastifyRequest } from "fastify";
import type { AppDeps } from "../deps.js";
import { HttpError } from "../lib/errors.js";
import type { AuthSessionRow } from "../repo/security.js";

export const STEP_UP_WINDOW_MS = STEP_UP_WINDOW_S * 1000;

export async function currentSession(deps: AppDeps, req: FastifyRequest): Promise<AuthSessionRow | null> {
  return req.sessionId ? deps.repo.security.getSession(req.sessionId) : null;
}

/** Seconds left in the step-up window of this session (0: a step-up is needed). */
export function recentAuthRemainingS(session: AuthSessionRow | null, now: Date): number {
  if (!session?.recentAuthAt) return 0;
  const left = STEP_UP_WINDOW_MS - (now.getTime() - session.recentAuthAt.getTime());
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

export const stepUpRequired = () =>
  new HttpError(403, "step_up_required", "Pour votre sécurité, confirmez votre identité (clé d'accès ou code par texto), puis réessayez.");

/** 403 step_up_required unless the session authenticated (passkey or SMS code) in the last 10 minutes. */
export async function requireRecentAuth(deps: AppDeps, req: FastifyRequest): Promise<void> {
  const session = await currentSession(deps, req);
  if (recentAuthRemainingS(session, deps.now()) > 0) return;
  throw stepUpRequired();
}

/**
 * Business « require_strong_auth »: an owner or admin needs a passkey confirmation in this session.
 * 403 strong_auth_setup_required when the user has no passkey yet, strong_auth_required otherwise.
 */
export async function assertBusinessStrongAuth(deps: AppDeps, req: FastifyRequest, businessId: string, userId: string): Promise<void> {
  const { requireStrongAuth } = await deps.repo.security.getBusinessPolicy(businessId);
  if (!requireStrongAuth) return;
  const session = await currentSession(deps, req);
  if (session?.strongAuthAt) return;
  const hasPasskey = (await deps.repo.security.listPasskeys(userId)).length > 0;
  if (!hasPasskey) {
    throw new HttpError(403, "strong_auth_setup_required", "Cette entreprise exige une clé d'accès pour les administrateurs. Ajoutez-en une dans Paramètres › Sécurité.");
  }
  throw new HttpError(403, "strong_auth_required", "Cette entreprise exige une confirmation par clé d'accès. Confirmez votre identité dans Paramètres › Sécurité.");
}

/** Businesses where the user is owner/admin and require_strong_auth is on. */
export async function strongAuthBusinesses(deps: AppDeps, userId: string): Promise<string[]> {
  const out: string[] = [];
  for (const { business, member } of await deps.repo.pbx.listBusinessesForUser(userId)) {
    if (member.role !== "owner" && member.role !== "admin") continue;
    if ((await deps.repo.security.getBusinessPolicy(business.id)).requireStrongAuth) out.push(business.id);
  }
  return out;
}
