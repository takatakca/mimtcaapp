import { NUMBER_CHECKOUT_HOLD_MINUTES } from "@mimt/shared";
import type { AppDeps } from "../deps.js";
import { conflict, forbidden, notFound } from "../lib/errors.js";
import { classifyDestination } from "../lib/phone.js";
import { holdTokenMatches } from "../routes/numberPicker.js";
import { e911Ready } from "../routes/e911.js";
import type { TelecomAccount, User } from "../repo/types.js";
import { getFeatures, HELD_STATES, outboundBlocked } from "./accounts.js";

/**
 * Checks before paying for a number held in the live picker: the same rules as POST /v1/numbers/claim (9-1-1
 * address and notice, verified phone or device, Canadian number, a free number slot), plus a live hold owned by
 * whoever has the token. Returns when the Stripe session (and the hold) should expire.
 */
export async function checkHoldForCheckout(
  deps: AppDeps,
  input: { user: User; account: TelecomAccount; id: string; token: string },
): Promise<{ id: string; e164: string; checkoutExpiresAt: Date }> {
  const { repo } = deps;
  const { user, account } = input;
  const now = deps.now();
  const hold = await repo.numberHolds.get(input.id);
  if (!hold || !holdTokenMatches(hold, input.token)) throw notFound("hold_not_found");
  if (!(hold.status === "held" || hold.status === "checkout") || hold.expiresAt <= now) {
    throw conflict("hold_expired", "La réservation de ce numéro a expiré. Choisissez-en un autre.");
  }
  if (hold.telecomAccountId && hold.telecomAccountId !== account.id) throw notFound("hold_not_found");

  if (outboundBlocked(account)) throw forbidden("account_restricted");
  const e911 = await e911Ready(deps, user.id, account.id);
  if (!e911.address) throw forbidden("e911_address_required", "Inscrivez d'abord l'adresse 9-1-1 où vous utiliserez MIMT.");
  if (!e911.ack) throw forbidden("e911_ack_required", "Acceptez d'abord l'avis sur les limites du 9-1-1.");
  if (!user.phoneVerifiedAt && !user.deviceVerifiedAt) throw forbidden("verification_required", "Confirmez d'abord votre cellulaire.");
  if (classifyDestination(hold.e164) !== "ca") throw forbidden("canadian_numbers_only");

  const { extraNumbers } = await getFeatures(repo, account.id);
  const held = (await repo.listNumbersByAccount(account.id)).filter((n) => HELD_STATES.has(n.state));
  if (held.length >= 1 + extraNumbers) throw forbidden("number_limit_reached", "Votre forfait ne permet pas un autre numéro.");
  const existing = await repo.getNumberByE164(hold.e164);
  if (existing && existing.state !== "released") throw conflict("number_unavailable", "Ce numéro vient d'être pris. Choisissez-en un autre.");

  // Stripe sessions live at least 30 minutes; the hold follows the session so payment and hold end together.
  const checkoutExpiresAt = new Date(now.getTime() + NUMBER_CHECKOUT_HOLD_MINUTES * 60_000 + 60_000);
  return { id: hold.id, e164: hold.e164, checkoutExpiresAt };
}
