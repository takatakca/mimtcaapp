import type { FastifyRequest } from "fastify";
import type { AppDeps } from "../deps.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import type { TelecomAccount, User } from "../repo/types.js";
import { ensureAccount } from "../services/accounts.js";

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
    /** Session ("sid") of the access token; null for tokens minted before the session inventory. */
    sessionId: string | null;
  }
}

/** preHandler: verifies the MIMT access token (Authorization: Bearer). */
export const requireUser = (deps: AppDeps) => async (req: FastifyRequest) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw unauthorized();
  const id = await deps.sessions.verifyAccessSession(header.slice(7).trim());
  req.userId = id.userId;
  req.sessionId = id.sessionId;
};

export interface UserContext {
  user: User;
  account: TelecomAccount;
}

export async function loadContext(deps: AppDeps, req: FastifyRequest): Promise<UserContext> {
  const user = await deps.repo.getUser(req.userId);
  // A deletion request closes the account at once (DELETE /v1/me): no more API access while the purge is pending.
  if (!user || user.status === "deleted" || user.status === "pending_deletion") throw unauthorized("Account not found");
  if (user.status === "suspended") throw forbidden("account_suspended");
  return { user, account: await ensureAccount(deps.repo, user) };
}
