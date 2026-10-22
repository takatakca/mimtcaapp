import { describe, expect, it, vi } from "vitest";
import { runNumberLifecycle } from "../src/jobs/numberLifecycle.js";
import { MemoryRepository } from "../src/repo/memory.js";
import { fakeTwilio } from "./helpers.js";

const DAY = 86_400_000;
const t0 = new Date("2026-01-01T00:00:00Z");
const at = (days: number) => new Date(t0.getTime() + days * DAY);

async function world(plan?: "lock") {
  const repo = new MemoryRepository();
  const user = await repo.createUser({ globalUserId: null, locale: "fr-CA", displayName: null });
  const account = await repo.createAccount({ ownerUserId: user.id, kind: "consumer", status: "ACTIVE_INDEPENDENT", riskTier: "standard" });
  if (plan) {
    await repo.upsertSubscription({ telecomAccountId: account.id, kind: "plan", code: plan, quantity: 1, stripeSubscriptionId: "s", status: "active", source: "stripe", currentPeriodEnd: null });
  }
  const number = await repo.createNumber({ e164: "+15145550100", twilioSid: "PN1", telecomAccountId: account.id, kind: "local", state: "active", lastActivityAt: t0, stateChangedAt: t0 });
  await repo.createMessage({
    twilioSid: "SM1", telecomAccountId: account.id, direction: "inbound", ourNumber: number.e164, peer: "+15145550199",
    bodyEncrypted: "v1.x", bodyFingerprint: "f", status: "received", segments: 1, numMedia: 0,
  });
  const notifier = { notify: vi.fn(async () => {}) };
  const twilio = fakeTwilio();
  const run = (day: number) => runNumberLifecycle({ repo, twilio, notifier, now: at(day), since: new Date(0) });
  return { repo, number, notifier, twilio, run };
}

describe("number lifecycle job", () => {
  it("warns at day 20 and 27, graces at 30, quarantines after 7 days, releases after 90", async () => {
    const w = await world();
    await w.run(19);
    expect(w.notifier.notify).not.toHaveBeenCalled();
    await w.run(20);
    await w.run(21);
    expect(w.notifier.notify).toHaveBeenCalledTimes(1);
    await w.run(27);
    expect(w.notifier.notify).toHaveBeenCalledTimes(2);

    expect((await w.run(30)).transitions).toEqual([{ e164: "+15145550100", from: "active", to: "grace" }]);
    expect((await w.run(37)).transitions[0]?.to).toBe("quarantine");
    const q = (await w.repo.getNumber(w.number.id))!;
    expect(q.quarantineUntil).toEqual(at(37 + 90));

    await w.run(37 + 89);
    expect(w.twilio.releaseNumber).not.toHaveBeenCalled();
    expect((await w.run(37 + 90)).transitions[0]?.to).toBe("released");
    expect(w.twilio.releaseNumber).toHaveBeenCalledWith("PN1");
    const released = (await w.repo.getNumber(w.number.id))!;
    expect(released).toMatchObject({ state: "released", telecomAccountId: null, twilioSid: null });
    expect(w.repo.messages).toHaveLength(0);
  });

  it("never reclaims a locked number", async () => {
    const w = await world("lock");
    expect((await w.run(400)).transitions).toEqual([]);
    expect(w.notifier.notify).not.toHaveBeenCalled();
  });

  it("returns a number to active when the user comes back during grace", async () => {
    const w = await world();
    await w.run(20);
    await w.run(27);
    await w.run(30);
    await w.repo.updateNumber(w.number.id, { lastActivityAt: at(32) });
    expect((await w.run(33)).transitions[0]?.to).toBe("active");
  });

  it("sends both reminders before reclaiming a number found already idle past the limit", async () => {
    const w = await world();
    expect((await w.run(45)).transitions).toEqual([]);
    expect((await w.run(46)).transitions).toEqual([]);
    expect(w.notifier.notify).toHaveBeenCalledTimes(2);
    expect(w.notifier.notify).toHaveBeenLastCalledWith(expect.any(String), "number_inactivity_warning", { e164: "+15145550100", daysLeft: 7 });
    expect((await w.run(47)).transitions[0]?.to).toBe("grace");
  });

  it("never touches a number that existed before recycling was switched on", async () => {
    const w = await world();
    const since = new Date(Date.now() + DAY);
    for (const day of [20, 27, 30, 45, 200]) {
      const res = await runNumberLifecycle({ repo: w.repo, twilio: w.twilio, notifier: w.notifier, now: at(day), since });
      expect(res.transitions).toEqual([]);
    }
    expect(w.notifier.notify).not.toHaveBeenCalled();
    expect(w.twilio.releaseNumber).not.toHaveBeenCalled();
    expect((await w.repo.getNumber(w.number.id))?.state).toBe("active");
  });
});
