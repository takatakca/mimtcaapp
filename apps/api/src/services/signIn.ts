// Every sign-in (TAKATAK, SMS code, passkey) goes through here: session row, audit, « Nouvelle connexion » notice.
import type { AuthMethod, AuthTokensResponse } from "@mimt/shared";
import type { FastifyBaseLogger, FastifyRequest } from "fastify";
import type { AppDeps } from "../deps.js";
import { clientInfo } from "../lib/clientInfo.js";
import type { User } from "../repo/types.js";

export async function completeSignIn(deps: AppDeps, req: FastifyRequest, user: User, method: AuthMethod): Promise<AuthTokensResponse> {
  const client = clientInfo(req);
  const { tokens, session, newDevice } = await deps.sessions.signIn(user.id, method, client);
  // Internal ids and the coarse network only (Law 25): no phone number, no email, no full IP.
  await deps.repo.audit({ actorUserId: user.id, action: "auth.sign_in", targetType: "session", targetId: session.id, ip: client.ipPrefix, meta: { method, newDevice } });
  if (newDevice) {
    await deps.repo.audit({ actorUserId: user.id, action: "auth.new_device", targetType: "session", targetId: session.id, ip: client.ipPrefix, meta: { device: client.userAgent } });
    if (deps.config.SECURITY_SIGNIN_NOTICE === "on") void sendSignInNotice(deps, user, client.userAgent, req.log);
  }
  return tokens;
}

/** Subject and body of the sign-in email: French first, English below (no personal data besides the device family). */
export function signInNoticeEmail(user: Pick<User, "locale">, device: string, appBaseUrl: string): { subject: string; text: string } {
  const link = `${appBaseUrl.replace(/\/$/, "")}/compte/securite`;
  const text = [
    "Bonjour,",
    "",
    `Une nouvelle connexion à votre compte MIMT vient d'avoir lieu depuis : ${device}.`,
    "C'est vous ? Vous n'avez rien à faire.",
    `Ce n'est pas vous ? Ouvrez ${link}, choisissez « Déconnecter partout ailleurs », puis écrivez-nous à info@mimt.ca.`,
    "",
    "— English —",
    `New sign-in to your MIMT account from: ${device}.`,
    `Not you? Open ${link}, choose « Sign out everywhere else », then write to info@mimt.ca.`,
    "",
    "— L'équipe MIMT",
  ].join("\n");
  return { subject: user.locale === "en-CA" ? "New sign-in to your MIMT account" : "Nouvelle connexion à votre compte MIMT", text };
}

/** Push (web push when configured) and email (when EMAIL_PROVIDER is set and the user has an email). Never throws. */
async function sendSignInNotice(deps: AppDeps, user: User, device: string, log: FastifyBaseLogger): Promise<void> {
  try {
    await deps.notifier.notify(user.id, "new_sign_in", { device });
  } catch {
    log.warn({ template: "new_sign_in" }, "sign-in notice push failed");
  }
  if (!deps.email || deps.config.EMAIL_PROVIDER === "log" || !user.email) return;
  try {
    await deps.email.send({ to: user.email, ...signInNoticeEmail(user, device, deps.config.APP_BASE_URL) });
  } catch {
    log.warn({ channel: "email" }, "sign-in notice email failed");
  }
}
