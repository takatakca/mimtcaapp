// Account deletion (App Store 5.1.1(v), Google Play account deletion, Quebec Law 25). DELETE /v1/me closes the account
// at once (sign-out everywhere, numbers to quarantine, web subscriptions cancelled) and schedules the purge
// DELETION_DELAY_DAYS later; this daily job then deletes the personal data for good.
//
// Deleted: texts, MMS and voicemail files (storage and Twilio), voicemail settings and greeting, 9-1-1 civic address,
// blocked numbers, call settings, AI data, @name, push tokens, devices, consents, referrals, meetings hosted, port-in
// requests, number holds, and the user's name, email and phone number.
// Kept, because the law requires it (billing, telecom and 9-1-1 records, security): subscriptions and usage, call
// records, 9-1-1 notice acceptances, audit and fraud logs, the closed account row. MIMT's phone numbers go back to the
// pool through the number lifecycle (quarantine, then release; numbers older than NUMBER_LIFECYCLE_FROM stay with MIMT).
import type { FastifyBaseLogger } from "fastify";
import type { AppDeps } from "../deps.js";
import type { Subscription, TelecomAccount } from "../repo/types.js";
import { HELD_STATES, isLiveSubscription } from "../services/accounts.js";
import { addDays } from "../lib/time.js";
import { QUARANTINE_DAYS } from "@mimt/shared";

type Log = Pick<FastifyBaseLogger, "warn" | "error">;
type Deps = Pick<AppDeps, "repo" | "twilio" | "billing" | "mediaFiles">;

/** Days between the deletion request and the purge (said in the app and the privacy policy). */
export const DELETION_DELAY_DAYS = 30;

/**
 * Cancels the account's live Stripe (web) subscriptions. App Store / Google Play subscriptions cannot be cancelled by
 * MIMT: the app tells the customer to cancel them in the store. Returns the store subscriptions still live.
 */
export async function cancelWebSubscriptions(deps: Deps, account: TelecomAccount, log?: Log): Promise<Subscription[]> {
  const live = (await deps.repo.listSubscriptions(account.id)).filter((s) => isLiveSubscription(s));
  for (const s of live) {
    if (s.source !== "stripe" || !s.stripeSubscriptionId) continue;
    if (!deps.billing?.cancelSubscription) {
      log?.warn({ subscription: s.stripeSubscriptionId }, "account deletion: Stripe not configured, subscription not cancelled");
      continue;
    }
    try {
      await deps.billing.cancelSubscription(s.stripeSubscriptionId);
      // The Stripe webhook confirms it; marked here too so nothing renews if the webhook is late.
      const { id: _id, createdAt: _createdAt, ...fields } = s;
      await deps.repo.upsertSubscription({ ...fields, status: "canceled" });
    } catch (err) {
      log?.error({ err, subscription: s.stripeSubscriptionId }, "account deletion: Stripe cancel failed");
    }
  }
  return live.filter((s) => s.source === "iap_apple" || s.source === "iap_google");
}

export interface AccountDeletionResult {
  deleted: number;
  errors: number;
}

export async function runAccountDeletion(deps: Deps, opts: { now?: Date; log?: Log; limit?: number } = {}): Promise<AccountDeletionResult> {
  const { repo } = deps;
  const now = opts.now ?? new Date();
  const result: AccountDeletionResult = { deleted: 0, errors: 0 };
  for (const user of await repo.listUsersDueForDeletion(now, opts.limit ?? 100)) {
    try {
      const account = await repo.getAccountByOwner(user.id);
      if (account) {
        await cancelWebSubscriptions(deps, account, opts.log);
        // Numbers still held (e.g. a request made before quarantine existed) go to quarantine now.
        for (const n of await repo.listNumbersByAccount(account.id)) {
          if (HELD_STATES.has(n.state)) {
            await repo.updateNumber(n.id, { state: "quarantine", stateChangedAt: now, quarantineUntil: addDays(now, QUARANTINE_DAYS) });
          }
        }
      }
      const files = await repo.purgeUserData(user.id, account?.id ?? null);
      // Outside the database, after the commit. A failure is logged; the files have no owner any more.
      for (const path of files.mediaPaths) {
        await deps.mediaFiles?.delete(path).catch((err: unknown) => opts.log?.warn({ err }, "account deletion: storage delete failed"));
      }
      for (const url of files.twilioMediaUrls) {
        await deps.twilio?.deleteMedia?.(url).catch((err: unknown) => opts.log?.warn({ err }, "account deletion: Twilio media delete failed"));
      }
      for (const recordingSid of files.recordingSids) {
        await deps.twilio
          ?.deleteRecording({ recordingSid })
          .catch((err: unknown) => opts.log?.warn({ err }, "account deletion: Twilio recording delete failed"));
      }
      await repo.audit({
        actorUserId: null,
        action: "user.deleted",
        targetType: "user",
        targetId: user.id,
        meta: { files: files.mediaPaths.length + files.twilioMediaUrls.length, recordings: files.recordingSids.length },
      });
      result.deleted++;
    } catch (err) {
      result.errors++;
      opts.log?.error({ err, userId: user.id }, "account deletion failed; retried on the next run");
    }
  }
  return result;
}
