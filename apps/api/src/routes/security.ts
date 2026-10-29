// Security (docs/MIMT-SECURITY.md): session inventory, passkeys (WebAuthn), step-up, business strong-auth policy.
// Contract: packages/shared/src/security.ts. Audit events carry internal ids and the coarse network only.
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  type BusinessSecurityPolicy,
  type PasskeyDto,
  type PasskeysResponse,
  type RevokeOthersResponse,
  type SecurityStatusResponse,
  type SessionDto,
  type SessionsResponse,
  type StepUpResponse,
  type WebAuthnOptionsResponse,
} from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser } from "../auth/guard.js";
import { currentSession, recentAuthRemainingS, requireRecentAuth, strongAuthBusinesses } from "../auth/stepUp.js";
import { createWebAuthn, responseChallenge, responseCredentialId, type WebAuthnGateway } from "../auth/webauthn.js";
import { clientInfo } from "../lib/clientInfo.js";
import { badRequest, conflict, forbidden, HttpError, notConfigured, notFound, unauthorized } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { businessAccess } from "../pbx/access.js";
import type { AuthSessionRow, PasskeyRow } from "../repo/security.js";
import type { User } from "../repo/types.js";
import { completeSignIn } from "../services/signIn.js";

/** WebAuthn challenges are signed, single use and valid this long. */
const CHALLENGE_TTL_S = 300;
const MAX_PASSKEYS = 10;

const IdParam = z.object({ id: z.uuid() });
const WebAuthnResponse = z.record(z.string(), z.unknown());
const RegisterVerifyBody = z.object({
  challengeToken: z.string().min(20).max(4096),
  response: WebAuthnResponse,
  name: z.string().trim().min(1).max(60).optional(),
});
const AuthVerifyBody = z.object({ challengeToken: z.string().min(20).max(4096), response: WebAuthnResponse });
const SmsVerifyBody = z.object({ code: z.string().regex(/^\d{4,10}$/) });
const PolicyBody = z.object({ requireStrongAuth: z.boolean() }).strict();

type Purpose = "register" | "signin" | "stepup";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export const sessionDto = (s: AuthSessionRow, currentId: string | null): SessionDto => ({
  id: s.id,
  current: s.id === currentId,
  method: s.method,
  device: s.userAgent ?? "Unknown · Unknown",
  network: s.ipPrefix,
  createdAt: s.createdAt.toISOString(),
  lastSeenAt: s.lastSeenAt.toISOString(),
});

const passkeyDto = (k: PasskeyRow): PasskeyDto => ({ id: k.id, name: k.name, createdAt: k.createdAt.toISOString(), lastUsedAt: iso(k.lastUsedAt), backedUp: k.backedUp });

/** "+15145550123" → "•••-•••-0123" */
export const maskPhone = (e164: string) => `•••-•••-${e164.slice(-4)}`;

export async function securityRoutes(app: FastifyInstance, deps: AppDeps) {
  const { repo } = deps;
  const auth = { preHandler: requireUser(deps) };
  const stepUpLimit = { rateLimit: { max: 20, timeWindow: "1 minute" } };
  let gateway: WebAuthnGateway | null = null;
  const webauthn = (): WebAuthnGateway => {
    if (deps.config.PASSKEYS === "off") throw notConfigured("Passkeys");
    return deps.webauthn ?? (gateway ??= createWebAuthn(deps.config));
  };

  const audit = (req: FastifyRequest, userId: string | null, action: string, targetType: string, targetId: string, meta?: Record<string, unknown>) =>
    repo.audit({ actorUserId: userId, action, targetType, targetId, ip: clientInfo(req).ipPrefix, ...(meta ? { meta } : {}) });

  // --- WebAuthn challenges: signed (EdDSA, 5 min), bound to a purpose and a subject, single use. -----------------------
  const resource = (purpose: Purpose, subject: string, challenge: string) => `webauthn:${purpose}:${subject}:${challenge}`;
  async function challengeToken(purpose: Purpose, subject: string, challenge: string) {
    return (await deps.sessions.signMedia(resource(purpose, subject, challenge), CHALLENGE_TTL_S)).token;
  }
  /** The challenge of `response` if `token` was issued for it (same purpose and subject) and was never used. */
  async function consumeChallenge(purpose: Purpose, subject: string, token: string, response: unknown): Promise<string | null> {
    const challenge = responseChallenge(response);
    if (!challenge) return null;
    if (!(await deps.sessions.verifyMedia(token, resource(purpose, subject, challenge)))) return null;
    if (!(await repo.useOnce(`webauthn:${challenge}`, new Date(deps.now().getTime() + CHALLENGE_TTL_S * 1000)))) return null;
    return challenge;
  }

  /** Verifies a passkey assertion for `purpose`; returns the passkey and its owner, or null (caller audits). */
  async function verifyAssertion(purpose: Purpose, subject: string, body: z.infer<typeof AuthVerifyBody>, userId?: string) {
    const challenge = await consumeChallenge(purpose, subject, body.challengeToken, body.response);
    const credentialId = responseCredentialId(body.response);
    if (!challenge || !credentialId) return null;
    const key = await repo.security.findPasskeyByCredentialId(credentialId);
    if (!key || (userId && key.userId !== userId)) return null;
    const ok = await webauthn().verifyAuthentication({
      response: body.response,
      expectedChallenge: challenge,
      credential: { id: key.credentialId, publicKey: key.publicKey, counter: key.counter, transports: key.transports },
    });
    if (!ok) return { key, ok: false as const };
    await repo.security.updatePasskeyUse(key.id, ok.newCounter, deps.now());
    return { key, ok: true as const };
  }

  async function passkeyUserName(user: User): Promise<string> {
    const handle = await repo.handles.forUser(user.id);
    return handle?.handle ?? user.phoneE164 ?? user.email ?? "Compte MIMT";
  }

  async function stepUpAnswer(req: FastifyRequest): Promise<StepUpResponse> {
    const s = await currentSession(deps, req);
    return { recentAuthRemainingS: recentAuthRemainingS(s, deps.now()), strongAuth: Boolean(s?.strongAuthAt) };
  }

  /** Step-up needs a session id (tokens from before the inventory get a 401, the app refreshes and retries). */
  function sessionIdOf(req: FastifyRequest): string {
    if (!req.sessionId) throw unauthorized("Session refresh required");
    return req.sessionId;
  }

  // ------------------------------------------------------------------------------------------ sessions

  app.get("/v1/me/sessions", auth, async (req): Promise<SessionsResponse> => {
    const { user } = await loadContext(deps, req);
    const rows = await repo.security.listActiveSessions(user.id);
    return { sessions: rows.map((s) => sessionDto(s, req.sessionId)) };
  });

  app.delete("/v1/me/sessions/:id", auth, async (req, reply) => {
    const { user } = await loadContext(deps, req);
    const r = IdParam.safeParse(req.params);
    if (!r.success) throw notFound();
    const s = await repo.security.getSession(r.data.id);
    if (!s || s.userId !== user.id || s.revokedAt) throw notFound();
    await deps.sessions.revokeSession(s.id);
    await audit(req, user.id, "session.revoked", "session", s.id, { scope: "one", current: s.id === req.sessionId });
    return reply.code(204).send();
  });

  // « Déconnecter partout ailleurs »
  app.post("/v1/me/sessions/revoke-others", auth, async (req): Promise<RevokeOthersResponse> => {
    const { user } = await loadContext(deps, req);
    const keep = sessionIdOf(req);
    const ids = await deps.sessions.revokeOtherSessions(user.id, keep);
    await audit(req, user.id, "session.revoked", "user", user.id, { scope: "others", count: ids.length, kept: keep });
    return { revoked: ids.length };
  });

  app.get("/v1/me/security", auth, async (req): Promise<SecurityStatusResponse> => {
    const { user } = await loadContext(deps, req);
    const [keys, session, businesses] = await Promise.all([repo.security.listPasskeys(user.id), currentSession(deps, req), strongAuthBusinesses(deps, user.id)]);
    return {
      passkeys: keys.length,
      stepUpPhone: user.phoneE164 && user.phoneVerifiedAt && deps.twilio && deps.config.TWILIO_VERIFY_SERVICE_SID ? maskPhone(user.phoneE164) : null,
      recentAuthRemainingS: recentAuthRemainingS(session, deps.now()),
      strongAuth: Boolean(session?.strongAuthAt),
      strongAuthRequiredByBusiness: businesses.length > 0,
      passkeysEnabled: deps.config.PASSKEYS === "on",
    };
  });

  // ------------------------------------------------------------------------------------------ passkeys

  app.get("/v1/me/passkeys", auth, async (req): Promise<PasskeysResponse> => {
    const { user } = await loadContext(deps, req);
    return { passkeys: (await repo.security.listPasskeys(user.id)).map(passkeyDto) };
  });

  app.post("/v1/me/passkeys/register/options", { ...auth, config: stepUpLimit }, async (req): Promise<WebAuthnOptionsResponse> => {
    const { user } = await loadContext(deps, req);
    const wa = webauthn();
    // Adding a passkey is a way back into the account: a recent authentication first.
    await requireRecentAuth(deps, req);
    const keys = await repo.security.listPasskeys(user.id);
    if (keys.length >= MAX_PASSKEYS) throw conflict("passkey_limit", `Au plus ${MAX_PASSKEYS} clés d'accès par compte.`);
    const options = await wa.registrationOptions({
      userId: user.id,
      userName: await passkeyUserName(user),
      exclude: keys.map((k) => ({ id: k.credentialId, transports: k.transports })),
    });
    return { options, challengeToken: await challengeToken("register", user.id, options.challenge) };
  });

  app.post("/v1/me/passkeys/register/verify", { ...auth, config: stepUpLimit }, async (req, reply) => {
    const body = parse(RegisterVerifyBody, req.body);
    const { user } = await loadContext(deps, req);
    const wa = webauthn();
    await requireRecentAuth(deps, req);
    const challenge = await consumeChallenge("register", user.id, body.challengeToken, body.response);
    if (!challenge) throw badRequest("invalid_challenge", "Ce défi a expiré. Recommencez.");
    const cred = await wa.verifyRegistration({ response: body.response, expectedChallenge: challenge });
    if (!cred) {
      await audit(req, user.id, "passkey.add_failed", "user", user.id);
      throw badRequest("passkey_not_verified", "La clé d'accès n'a pas pu être vérifiée.");
    }
    if (await repo.security.findPasskeyByCredentialId(cred.credentialId)) throw conflict("passkey_exists", "Cette clé d'accès est déjà enregistrée.");
    const row = await repo.security.addPasskey({
      userId: user.id,
      credentialId: cred.credentialId,
      publicKey: cred.publicKey,
      counter: cred.counter,
      transports: cred.transports,
      deviceType: cred.deviceType,
      backedUp: cred.backedUp,
      name: body.name ?? clientInfo(req).userAgent,
      createdAt: deps.now(),
    });
    // The user just proved possession with user verification: this session is strongly authenticated.
    if (req.sessionId) await deps.sessions.markRecentAuth(req.sessionId, true);
    await audit(req, user.id, "passkey.added", "passkey", row.id, { backedUp: row.backedUp });
    return reply.code(201).send(passkeyDto(row));
  });

  app.delete("/v1/me/passkeys/:id", auth, async (req, reply) => {
    const { user } = await loadContext(deps, req);
    const r = IdParam.safeParse(req.params);
    if (!r.success) throw notFound();
    const keys = await repo.security.listPasskeys(user.id);
    const key = keys.find((k) => k.id === r.data.id);
    if (!key) throw notFound();
    await requireRecentAuth(deps, req);
    if (keys.length === 1 && (await strongAuthBusinesses(deps, user.id)).length > 0) {
      throw conflict("passkey_required_by_business", "Une entreprise dont vous êtes administrateur exige une clé d'accès. Ajoutez-en une autre avant de supprimer celle-ci.");
    }
    await repo.security.deletePasskey(key.id, user.id);
    await audit(req, user.id, "passkey.removed", "passkey", key.id);
    return reply.code(204).send();
  });

  // ------------------------------------------------------------------------- passwordless sign-in

  app.post("/v1/auth/passkeys/options", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (): Promise<WebAuthnOptionsResponse> => {
    // Discoverable credentials: no user is named, the authenticator offers the passkeys it holds for mimt.ca.
    const options = await webauthn().authenticationOptions({ allow: [] });
    return { options, challengeToken: await challengeToken("signin", "-", options.challenge) };
  });

  app.post("/v1/auth/passkeys/verify", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const body = parse(AuthVerifyBody, req.body);
    webauthn();
    const result = await verifyAssertion("signin", "-", body);
    if (!result?.ok) {
      if (result) await audit(req, result.key.userId, "auth.passkey_failed", "passkey", result.key.id);
      throw unauthorized("La clé d'accès n'a pas pu être vérifiée.");
    }
    const user = await repo.getUser(result.key.userId);
    if (!user || user.status !== "active") throw forbidden("account_unavailable");
    return completeSignIn(deps, req, user, "passkey");
  });

  // ------------------------------------------------------------------------------------- step-up

  app.post("/v1/auth/step-up/passkey/options", { ...auth, config: stepUpLimit }, async (req): Promise<WebAuthnOptionsResponse> => {
    const { user } = await loadContext(deps, req);
    const wa = webauthn();
    const keys = await repo.security.listPasskeys(user.id);
    if (!keys.length) throw badRequest("no_passkey", "Aucune clé d'accès sur ce compte.");
    const options = await wa.authenticationOptions({ allow: keys.map((k) => ({ id: k.credentialId, transports: k.transports })) });
    return { options, challengeToken: await challengeToken("stepup", user.id, options.challenge) };
  });

  app.post("/v1/auth/step-up/passkey/verify", { ...auth, config: stepUpLimit }, async (req): Promise<StepUpResponse> => {
    const body = parse(AuthVerifyBody, req.body);
    const { user } = await loadContext(deps, req);
    const sid = sessionIdOf(req);
    webauthn();
    const result = await verifyAssertion("stepup", user.id, body, user.id);
    if (!result?.ok) {
      await audit(req, user.id, "auth.step_up_failed", "session", sid, { method: "passkey" });
      throw new HttpError(403, "step_up_failed", "La clé d'accès n'a pas pu être vérifiée.");
    }
    await deps.sessions.markRecentAuth(sid, true);
    await audit(req, user.id, "auth.step_up", "session", sid, { method: "passkey" });
    return stepUpAnswer(req);
  });

  /** Step-up by a fresh SMS code to the account's verified phone (Twilio Verify). */
  function verifyPhone(user: User): { phone: string; twilio: NonNullable<AppDeps["twilio"]> } {
    if (!deps.twilio || !deps.config.TWILIO_VERIFY_SERVICE_SID) throw notConfigured("Phone verification");
    if (!user.phoneE164 || !user.phoneVerifiedAt) throw badRequest("no_verified_phone", "Aucun cellulaire vérifié sur ce compte. Utilisez une clé d'accès.");
    return { phone: user.phoneE164, twilio: deps.twilio };
  }

  app.post("/v1/auth/step-up/sms/start", { ...auth, config: stepUpLimit }, async (req, reply) => {
    const { user } = await loadContext(deps, req);
    sessionIdOf(req);
    const { phone, twilio } = verifyPhone(user);
    if (!(await deps.rateLimiter.take(`stepup-sms:${user.id}`, { capacity: 3, windowSeconds: 600 }))) {
      throw new HttpError(429, "rate_limited", "Trop de codes demandés. Réessayez dans 10 minutes.");
    }
    try {
      await twilio.startVerification(phone, String(req.headers["accept-language"] ?? user.locale));
    } catch (err) {
      req.log.warn({ code: (err as { code?: number }).code }, "step-up verification start failed");
      throw new HttpError(503, "verify_unavailable", "L'envoi du code est momentanément indisponible.");
    }
    return reply.code(202).send({ status: "pending", phone: maskPhone(phone) });
  });

  app.post("/v1/auth/step-up/sms/verify", { ...auth, config: stepUpLimit }, async (req): Promise<StepUpResponse> => {
    const { code } = parse(SmsVerifyBody, req.body);
    const { user } = await loadContext(deps, req);
    const sid = sessionIdOf(req);
    const { phone, twilio } = verifyPhone(user);
    if (!(await deps.rateLimiter.take(`stepup-sms-check:${user.id}`, { capacity: 5, windowSeconds: 600 }))) {
      throw new HttpError(429, "rate_limited", "Trop d'essais. Réessayez dans 10 minutes.");
    }
    let approved = false;
    try {
      approved = await twilio.checkVerification(phone, code);
    } catch (err) {
      if ((err as { code?: number }).code !== 20404) throw new HttpError(503, "verify_unavailable", "La vérification du code est momentanément indisponible.");
    }
    if (!approved) {
      await audit(req, user.id, "auth.step_up_failed", "session", sid, { method: "sms" });
      throw new HttpError(403, "step_up_failed", "Code invalide.");
    }
    await deps.sessions.markRecentAuth(sid, false);
    await audit(req, user.id, "auth.step_up", "session", sid, { method: "sms" });
    return stepUpAnswer(req);
  });

  // ------------------------------------------------------------------------- business policy

  app.get("/v1/business/:id/security", auth, async (req): Promise<BusinessSecurityPolicy> => {
    const ctx = await businessAccess(deps, req, "admin", { skipStrongAuth: true });
    return repo.security.getBusinessPolicy(ctx.business.id);
  });

  app.put("/v1/business/:id/security", auth, async (req): Promise<BusinessSecurityPolicy> => {
    const body = parse(PolicyBody, req.body);
    const ctx = await businessAccess(deps, req, "owner", { skipStrongAuth: true });
    await requireRecentAuth(deps, req);
    // Turning it on (or off) needs this session confirmed by a passkey: the owner can never lock themselves out.
    const session = await currentSession(deps, req);
    if (!session?.strongAuthAt) {
      const has = (await repo.security.listPasskeys(ctx.user.id)).length > 0;
      throw forbidden(has ? "strong_auth_required" : "strong_auth_setup_required", "Confirmez d'abord votre identité avec une clé d'accès.");
    }
    await repo.security.setBusinessPolicy(ctx.business.id, body.requireStrongAuth, ctx.user.id, deps.now());
    await audit(req, ctx.user.id, "business.security_policy_updated", "business", ctx.business.id, { requireStrongAuth: body.requireStrongAuth });
    return { requireStrongAuth: body.requireStrongAuth };
  });
}
