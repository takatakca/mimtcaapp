import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { forbidden, HttpError, notConfigured, unauthorized } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { NANP_E164, type AuthTokensResponse, type OtpStartResponse } from "@mimt/shared";
import { ensureAccount } from "../services/accounts.js";

const ExchangeBody = z.object({
  code: z.string().min(1).max(2048),
  codeVerifier: z.string().regex(/^[A-Za-z0-9\-._~]{43,128}$/, "invalid PKCE code_verifier"),
  redirectUri: z.url(),
  nonce: z.string().max(256).optional(),
});
const RefreshBody = z.object({ refreshToken: z.string().min(20).max(256) });
const OtpStartBody = z.object({ phone: z.string().regex(NANP_E164, "phone must be a Canada/US E.164 number") });
const OtpVerifyBody = OtpStartBody.extend({ code: z.string().regex(/^\d{4,10}$/) });

const authRateLimit = { rateLimit: { max: 20, timeWindow: "1 minute" } };

export async function authRoutes(app: FastifyInstance, deps: AppDeps) {
  const { repo, sessions } = deps;

  app.get("/.well-known/jwks.json", async () => ({ keys: [sessions.publicJwk] }));

  app.post("/v1/auth/takatak/exchange", { config: authRateLimit }, async (req): Promise<AuthTokensResponse> => {
    const body = parse(ExchangeBody, req.body);
    const id = await deps.takatak.exchangeCode(body);
    const now = deps.now();

    let user = await repo.findUserByGlobalId(id.globalUserId);
    if (!user) {
      user = await repo.createUser({
        globalUserId: id.globalUserId,
        locale: id.locale?.toLowerCase().startsWith("en") ? "en-CA" : "fr-CA",
        displayName: id.name,
        email: id.email,
        phoneE164: null,
        phoneVerifiedAt: id.phoneVerified ? now : null,
      });
      await repo.audit({ actorUserId: user.id, action: "user.created", targetType: "user", targetId: user.id, ip: req.ip, meta: { via: "takatak" } });
    } else {
      if (user.status === "deleted") throw forbidden("account_deleted");
      user = await repo.updateUser(user.id, {
        email: id.email ?? user.email,
        ...(id.phoneVerified && !user.phoneVerifiedAt ? { phoneVerifiedAt: now } : {}),
      });
    }
    if (user.status === "suspended") throw forbidden("account_suspended");

    const account = await ensureAccount(repo, user);
    if (id.workspaceId && !account.workspaceId) {
      await repo.updateAccount(account.id, { workspaceId: id.workspaceId, businessId: id.businessId ?? account.businessId });
    }
    return sessions.issue(user.id);
  });

  app.post("/v1/auth/refresh", { config: authRateLimit }, async (req): Promise<AuthTokensResponse> => {
    const { refreshToken } = parse(RefreshBody, req.body);
    return sessions.refresh(refreshToken);
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    const { refreshToken } = parse(RefreshBody, req.body);
    await sessions.logout(refreshToken);
    return reply.code(204).send();
  });

  /**
   * Twilio Verify errors as clear answers. The public Twilio code is kept in the message: it is not a secret and it
   * is the only way to tell "wrong phone number" from "service misconfigured" without log access.
   */
  function verifyError(err: unknown, phase: "start" | "check", log: { warn: (o: object, m: string) => void }): HttpError {
    const code = (err as { code?: number }).code;
    if (code === 60200 || code === 21211 || code === 60205 || code === 21614) {
      return new HttpError(400, "invalid_phone", "Ce numéro ne peut pas recevoir de texto. Vérifiez-le ou utilisez un cellulaire.");
    }
    if (code === 60203 || code === 60212) return new HttpError(429, "rate_limited", "Trop de codes demandés. Réessayez dans 10 minutes.");
    if (code === 60410 || code === 60605) return new HttpError(403, "phone_blocked", "Ce numéro ne peut pas recevoir de code pour le moment.");
    if (phase === "check" && code === 20404) return unauthorized("Invalid code");
    log.warn({ err }, "Twilio Verify failed");
    return new HttpError(503, "verify_unavailable", `La connexion par texto est momentanément indisponible.${code ? ` (code ${code})` : ""}`);
  }

  // Fallback login (no TAKATAK account) through Twilio Verify.
  const verify = () => {
    if (!deps.twilio || !deps.config.TWILIO_VERIFY_SERVICE_SID) throw notConfigured("Phone verification");
    return deps.twilio;
  };

  app.post("/v1/auth/otp/start", { config: authRateLimit }, async (req, reply) => {
    const twilio = verify();
    const { phone } = parse(OtpStartBody, req.body);
    if (!(await deps.rateLimiter.take(`otp:${phone}`, { capacity: 3, windowSeconds: 600 }))) {
      throw new HttpError(429, "rate_limited", "Too many codes requested for this number");
    }
    const locale = String(req.headers["accept-language"] ?? "fr");
    try {
      await twilio.startVerification(phone, locale);
    } catch (err) {
      throw verifyError(err, "start", req.log);
    }
    const res: OtpStartResponse = { status: "pending" };
    return reply.code(202).send(res);
  });

  app.post("/v1/auth/otp/verify", { config: authRateLimit }, async (req): Promise<AuthTokensResponse> => {
    const twilio = verify();
    const { phone, code } = parse(OtpVerifyBody, req.body);
    if (!(await deps.rateLimiter.take(`otp-check:${phone}`, { capacity: 5, windowSeconds: 600 }))) {
      throw new HttpError(429, "rate_limited", "Too many attempts");
    }
    let approved: boolean;
    try {
      approved = await twilio.checkVerification(phone, code);
    } catch (err) {
      throw verifyError(err, "check", req.log);
    }
    if (!approved) throw unauthorized("Invalid code");
    const now = deps.now();
    let user = await repo.findUserByPhone(phone);
    if (!user) {
      user = await repo.createUser({ globalUserId: null, locale: "fr-CA", displayName: null, phoneE164: phone, phoneVerifiedAt: now });
      await repo.audit({ actorUserId: user.id, action: "user.created", targetType: "user", targetId: user.id, ip: req.ip, meta: { via: "otp" } });
    } else if (user.status === "deleted" || user.status === "suspended") {
      throw forbidden("account_unavailable");
    } else if (!user.phoneVerifiedAt) {
      user = await repo.updateUser(user.id, { phoneVerifiedAt: now });
    }
    await ensureAccount(repo, user);
    return deps.sessions.issue(user.id);
  });
}
