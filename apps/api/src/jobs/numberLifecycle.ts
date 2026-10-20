import { pathToFileURL } from "node:url";
import { INACTIVITY_WARNING_DAYS, nextNumberState, QUARANTINE_DAYS } from "@mimt/shared";
import { planOf } from "../plansConfig.js";
import type { TwilioGateway } from "../gateways/twilio.js";
import { addDays, daysBetween } from "../lib/time.js";
import type { PhoneNumber, Repository } from "../repo/types.js";
import { getFeatures } from "../services/accounts.js";
import type { Notifier } from "../services/notifier.js";

export interface LifecycleResult {
  warned: number;
  transitions: Array<{ e164: string; from: PhoneNumber["state"]; to: PhoneNumber["state"] }>;
  errors: number;
}

/**
 * Daily job (MIMT-MVP.md §7): inactivity warnings at day 20 and 27, active → grace → quarantine (90 days) → released.
 * Numbers are deleted at Twilio only once quarantine is over.
 */
export async function runNumberLifecycle(input: {
  repo: Repository;
  twilio: TwilioGateway | null;
  notifier: Notifier;
  now?: Date;
  log?: { error: (obj: object, msg: string) => void };
}): Promise<LifecycleResult> {
  const { repo, twilio, notifier } = input;
  const now = input.now ?? new Date();
  const result: LifecycleResult = { warned: 0, transitions: [], errors: 0 };

  for (const n of await repo.listNumbersInStates(["active", "grace", "quarantine"])) {
    try {
      const account = n.telecomAccountId ? await repo.getAccount(n.telecomAccountId) : null;
      const plan = account ? (await getFeatures(repo, account.id)).plan : "free";
      const inactivityDays = account ? planOf(plan).caps.inactivityDays : 0;

      if (n.state === "active" && inactivityDays !== null && account) {
        const idle = daysBetween(n.lastActivityAt, now);
        let sent = n.warningsSent;
        if (idle < INACTIVITY_WARNING_DAYS[0] && sent.length) {
          // The user came back: arm the warnings again for the next idle period.
          await repo.updateNumber(n.id, { warningsSent: [] });
          sent = [];
        }
        for (const day of INACTIVITY_WARNING_DAYS) {
          if (idle >= day && idle < inactivityDays && !sent.includes(day)) {
            await notifier.notify(account.ownerUserId, "number_inactivity_warning", { e164: n.e164, daysLeft: Math.ceil(inactivityDays - idle) });
            await repo.updateNumber(n.id, { warningsSent: [...sent, day] });
            sent.push(day);
            result.warned++;
          }
        }
      }

      const next = nextNumberState({ state: n.state, lastActivityAt: n.lastActivityAt, inactivityDays, stateChangedAt: n.stateChangedAt, now });
      if (!next) continue;

      if (next === "released") {
        if (n.twilioSid && twilio) await twilio.releaseNumber(n.twilioSid);
        else if (n.twilioSid) continue; // cannot release without Twilio; retry on the next run
        await repo.purgeNumberContent(n.id, n.e164);
        await repo.updateNumber(n.id, { state: "released", stateChangedAt: now, telecomAccountId: null, twilioSid: null, quarantineUntil: null, warningsSent: [] });
      } else if (next === "quarantine") {
        await repo.updateNumber(n.id, { state: "quarantine", stateChangedAt: now, quarantineUntil: addDays(now, QUARANTINE_DAYS) });
        if (account) await notifier.notify(account.ownerUserId, "number_quarantined", { e164: n.e164 });
      } else {
        await repo.updateNumber(n.id, { state: next, stateChangedAt: now, ...(next === "active" ? { warningsSent: [] } : {}) });
      }
      await repo.audit({ actorUserId: null, action: "number.lifecycle", targetType: "phone_number", targetId: n.id, meta: { from: n.state, to: next } });
      result.transitions.push({ e164: n.e164, from: n.state, to: next });
    } catch (err) {
      result.errors++;
      input.log?.error({ err, numberId: n.id }, "number lifecycle step failed");
    }
  }
  return result;
}

// Run once from the CLI / a cron container: `node dist/jobs/numberLifecycle.js`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { loadConfig } = await import("../config.js");
  const { createDeps, createLogger } = await import("../bootstrap.js");
  const config = loadConfig();
  const log = createLogger(config);
  const deps = createDeps(config, log);
  const res = await runNumberLifecycle({ repo: deps.repo, twilio: deps.twilio, notifier: deps.notifier, log });
  log.info(res, "number lifecycle done");
  await deps.repo.close();
}
