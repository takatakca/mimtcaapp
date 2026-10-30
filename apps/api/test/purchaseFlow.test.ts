// Purchase-time auth flow (decided 2026-10-29): at phone-number purchase → SMS OTP verify →
// passkey enrollment on the device → full dashboard unlocked. Later logins use the passkey only
// (one SMS per customer lifetime).
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebAuthnGateway } from "../src/auth/webauthn.js";
import { holdTokenHash } from "../src/routes/numberPicker.js";
import { provisionHeldNumber } from "../src/services/numberProvisioning.js";
import { makeUser, setup, type Ctx } from "./helpers.js";

const PHONE = "+15145550199";
const E164 = "+15145550142";

/** Fake WebAuthn: the library's cryptography is mocked, everything around it (challenges, counters, policy) is real. */
function fakeWebAuthn(): WebAuthnGateway {
  const challenge = () => randomBytes(32).toString("base64url");
  return {
    async registrationOptions() {
      return { challenge: challenge(), rp: { id: "mimt.ca", name: "MIMT" } };
    },
    async verifyRegistration({ response }) {
      const r = response as { id: string; good?: boolean };
      return r.good ? { credentialId: r.id, publicKey: "cHVibGljLWtleQ", counter: 0, transports: ["internal"], deviceType: "multiDevice", backedUp: true } : null;
    },
    async authenticationOptions() {
      return { challenge: challenge(), rpId: "mimt.ca" };
    },
    async verifyAuthentication({ response, credential }) {
      return (response as { good?: boolean }).good ? { newCounter: credential.counter + 1 } : null;
    },
  };
}

const clientData = (challenge: string) =>
  Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: "https://app.mimt.ca" })).toString("base64url");
const credResponse = (id: string, challenge: string, good = true) => ({ id, rawId: id, type: "public-key", good, response: { clientDataJSON: clientData(challenge) } });

let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup({ config: { TWILIO_VERIFY_SERVICE_SID: "VAtest" } });
  ctx.deps.webauthn = fakeWebAuthn();
});
afterEach(() => ctx.app.close());

const call = (method: string, url: string, headers: Record<string, string> = {}, payload?: unknown) =>
  ctx.app.inject({ method: method as "GET", url, headers, ...(payload === undefined ? {} : { payload: payload as object }) });

/** A hold in "checkout" state, as left by the Stripe checkout creation. Returns the hold and its secret token. */
async function checkoutHold(accountId: string) {
  const token = randomBytes(24).toString("base64url");
  const now = new Date();
  const hold = (await ctx.repo.numberHolds.create({
    e164: E164,
    tokenHash: holdTokenHash(token),
    ipHash: "iphash-test",
    expiresAt: new Date(now.getTime() + 3600_000),
    now,
  }))!;
  const started = await ctx.repo.numberHolds.startCheckout(hold.id, {
    telecomAccountId: accountId,
    checkoutSessionId: "cs_test_123",
    expiresAt: new Date(now.getTime() + 3600_000),
    now,
  });
  expect(started).toBe(true);
  return { hold: (await ctx.repo.numberHolds.get(hold.id))!, token };
}

describe("purchase gate (provisionHeldNumber)", () => {
  it("defers provisioning while the owner's phone is unverified, keeps the hold live", async () => {
    const { user, account } = await makeUser(ctx, { verified: false });
    const { hold } = await checkoutHold(account.id);
    const outcome = await provisionHeldNumber(ctx.deps, hold.id, account);
    expect(outcome).toBe("awaiting_verification");
    expect((await ctx.repo.numberHolds.get(hold.id))!.status).toBe("checkout");
    expect(ctx.twilio!.purchaseNumber).not.toHaveBeenCalled();
    expect(user.onboardingStage).toBe("signed_up");
  });

  it("provisions as before when the owner's phone is verified (old behavior)", async () => {
    const { account } = await makeUser(ctx);
    const { hold } = await checkoutHold(account.id);
    const outcome = await provisionHeldNumber(ctx.deps, hold.id, account);
    expect(outcome).toBe("provisioned");
    expect((await ctx.repo.numberHolds.get(hold.id))!.status).toBe("converted");
    expect(ctx.twilio!.purchaseNumber).toHaveBeenCalledTimes(1);
    expect(await ctx.repo.getNumberByE164(E164)).toMatchObject({ state: "active", telecomAccountId: account.id });
  });
});

describe("POST /v1/numbers/provision/resume", () => {
  it("answers 428 phone_verification_required with a resume token while unverified", async () => {
    const { account, auth } = await makeUser(ctx, { verified: false });
    const { hold, token } = await checkoutHold(account.id);
    const res = await call("POST", "/v1/numbers/provision/resume", auth, { holdId: hold.id, holdToken: token });
    expect(res.statusCode).toBe(428);
    expect(res.json()).toMatchObject({ code: "phone_verification_required", holdId: hold.id, resumeToken: token });
  });

  it("rejects a wrong resume token", async () => {
    const { account, auth } = await makeUser(ctx, { verified: false });
    const { hold } = await checkoutHold(account.id);
    const res = await call("POST", "/v1/numbers/provision/resume", auth, { holdId: hold.id, holdToken: "wrong-token-value-1234567890" });
    expect(res.statusCode).toBe(404);
  });

  it("provisions after OTP verification links the phone and passkey enrollment completes", async () => {
    // Google-style signup: no phone yet.
    const a = await makeUser(ctx, { verified: false });
    const { hold, token } = await checkoutHold(a.account.id);
    const deferred = await call("POST", "/v1/numbers/provision/resume", a.auth, { holdId: hold.id, holdToken: token });
    expect(deferred.statusCode).toBe(428);

    // The signed-in user verifies their cell: the phone links to THEIR account (no second user).
    const otp = await call("POST", "/v1/auth/otp/verify", a.auth, { phone: PHONE, code: "123456" });
    expect(otp.statusCode).toBe(200);
    expect(otp.json().passkeyEnrollmentRequired).toBe(true);
    const linked = await ctx.repo.getUser(a.user.id);
    expect(linked!.phoneE164).toBe(PHONE);
    expect(linked!.phoneVerifiedAt).not.toBeNull();
    expect(linked!.onboardingStage).toBe("phone_verified");
    expect(await ctx.repo.findUserByPhone(PHONE)).toMatchObject({ id: a.user.id });

    // Passkey enrollment on the fresh OTP session unlocks the full stage.
    const t = otp.json() as { accessToken: string };
    const freshAuth = { authorization: `Bearer ${t.accessToken}` };
    const opts = await call("POST", "/v1/me/passkeys/register/options", freshAuth);
    expect(opts.statusCode).toBe(200);
    const { options, challengeToken } = opts.json();
    const reg = await call("POST", "/v1/me/passkeys/register/verify", freshAuth, {
      challengeToken,
      response: credResponse(randomBytes(24).toString("base64url"), options.challenge),
      name: "iPhone",
    });
    expect(reg.statusCode).toBe(201);
    expect((await ctx.repo.getUser(a.user.id))!.onboardingStage).toBe("full");

    // Resume with the checkout-resume token: the number is bought now.
    const res = await call("POST", "/v1/numbers/provision/resume", freshAuth, { holdId: hold.id, holdToken: token });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "provisioned", holdId: hold.id });
    expect(await ctx.repo.getNumberByE164(E164)).toMatchObject({ state: "active", telecomAccountId: a.account.id });
  });

  it("keeps the old phone-identity OTP login for unauthenticated callers", async () => {
    const res = await call("POST", "/v1/auth/otp/verify", {}, { phone: PHONE, code: "123456" });
    expect(res.statusCode).toBe(200);
    const user = await ctx.repo.findUserByPhone(PHONE);
    expect(user!.globalUserId).toBeNull();
    expect(user!.onboardingStage).toBe("phone_verified");
  });
});

describe("OTP verify → stage + passkey signal", () => {
  it("advances signed_up → phone_verified and signals passkey enrollment when the user has none", async () => {
    const res = await call("POST", "/v1/auth/otp/verify", {}, { phone: PHONE, code: "123456" });
    expect(res.statusCode).toBe(200);
    expect(res.json().passkeyEnrollmentRequired).toBe(true);
    const user = await ctx.repo.findUserByPhone(PHONE);
    expect(user!.onboardingStage).toBe("phone_verified");
  });

  it("does not signal when the user already has a passkey", async () => {
    const created = await call("POST", "/v1/auth/otp/verify", {}, { phone: PHONE, code: "123456" });
    const user = (await ctx.repo.findUserByPhone(PHONE))!;
    await ctx.repo.security.addPasskey({
      userId: user.id,
      credentialId: "cred-1",
      publicKey: "cHVibGljLWtleQ",
      counter: 0,
      transports: ["internal"],
      deviceType: "singleDevice",
      backedUp: false,
      name: "iPhone",
      createdAt: new Date(),
    });
    expect(created.json().passkeyEnrollmentRequired).toBe(true);
    const again = await call("POST", "/v1/auth/otp/verify", {}, { phone: PHONE, code: "123456" });
    expect(again.statusCode).toBe(200);
    expect(again.json().passkeyEnrollmentRequired).toBeUndefined();
  });
});

describe("passkey enrollment → stage", () => {
  async function registerPasskey(auth: Record<string, string>) {
    const opts = await call("POST", "/v1/me/passkeys/register/options", auth);
    expect(opts.statusCode).toBe(200);
    const { options, challengeToken } = opts.json();
    const credId = randomBytes(24).toString("base64url");
    const res = await call("POST", "/v1/me/passkeys/register/verify", auth, {
      challengeToken,
      response: credResponse(credId, options.challenge),
      name: "iPhone",
    });
    expect(res.statusCode).toBe(201);
  }

  it("moves phone_verified → full after passkey enrollment (purchase flow)", async () => {
    // SMS sign-in like the app does: the session counts as recently authenticated.
    const otp = await call("POST", "/v1/auth/otp/verify", {}, { phone: PHONE, code: "123456" });
    expect(otp.statusCode).toBe(200);
    const t = otp.json() as { accessToken: string };
    const auth = { authorization: `Bearer ${t.accessToken}` };
    expect((await ctx.repo.findUserByPhone(PHONE))!.onboardingStage).toBe("phone_verified");
    await registerPasskey(auth);
    expect((await ctx.repo.findUserByPhone(PHONE))!.onboardingStage).toBe("full");
  });

  it("moves signed_up → passkey_enrolled when no phone was verified (settings flow)", async () => {
    const { auth, user } = await makeUser(ctx, { verified: false });
    expect(user.onboardingStage).toBe("signed_up");
    await registerPasskey(auth);
    expect((await ctx.repo.getUser(user.id))!.onboardingStage).toBe("passkey_enrolled");
  });
});
