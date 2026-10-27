import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { requireUser } from "../auth/guard.js";
import { badRequest, conflict, forbidden, notConfigured } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { grantMission } from "../services/missions.js";

const DEVICE_KEY = /^[A-Za-z0-9_-]{8,256}$/;
const CHALLENGE_TTL_S = 300;

const AttestBody = z.object({
  platform: z.enum(["ios", "android"]),
  deviceKey: z.string().regex(DEVICE_KEY),
  challenge: z.string().min(16).max(128),
  challengeToken: z.string().min(20).max(4096),
  assertion: z.string().min(1).max(20_000),
});

/** One attested device, one MIMT user. A second account on the same device cannot take a free number. */
export async function deviceRoutes(app: FastifyInstance, deps: AppDeps) {
  const auth = { preHandler: requireUser(deps) };

  app.post("/v1/devices/challenge", auth, async (req) => {
    const challenge = randomBytes(32).toString("base64url");
    const signed = await deps.sessions.signMedia(`device-attest:${req.userId}:${challenge}`, CHALLENGE_TTL_S);
    return { challenge, challengeToken: signed.token };
  });

  app.post("/v1/devices/attest", auth, async (req) => {
    const body = parse(AttestBody, req.body);
    const resource = `device-attest:${req.userId}:${body.challenge}`;
    if (!(await deps.sessions.verifyMedia(body.challengeToken, resource))) throw badRequest("invalid_challenge");
    if (!(await deps.repo.useOnce(`device-challenge:${body.challenge}`, new Date(deps.now().getTime() + CHALLENGE_TTL_S * 1000)))) {
      throw conflict("challenge_already_used");
    }
    const result = await deps.deviceVerifier.verify(body);
    if (result === "not_configured") throw notConfigured("Device attestation");
    if (result !== "ok") throw forbidden("attestation_failed", "Cet appareil n'a pas pu être confirmé.");
    const bound = await deps.repo.bindDevice({
      platform: body.platform,
      deviceKey: body.deviceKey,
      userId: req.userId!,
      verifiedAt: deps.now(),
    });
    if (bound === "taken") throw conflict("device_already_used", "Cet appareil est déjà lié à un autre compte MIMT.");
    await deps.repo.updateUser(req.userId!, { deviceVerifiedAt: deps.now() });
    await deps.repo.audit({ actorUserId: req.userId, action: "device.attested", targetType: "user", targetId: req.userId, ip: req.ip, meta: { platform: body.platform } });
    // Mission « Installez l'app mobile »: App Attest / Play Integrity just proved a genuine MIMT app on a real device.
    // Once per account and once per device (keyed hash of the device key).
    const account = await deps.repo.getAccountByOwner(req.userId!);
    const missionGranted = account
      ? await grantMission(deps, { account, mission: "install_app", sourceRef: `device:${body.platform}`, deviceKey: body.deviceKey, log: req.log })
      : null;
    return missionGranted ? { verified: true, missionGranted } : { verified: true };
  });
}
