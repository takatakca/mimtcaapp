// Stripe Checkout for a plan bought outside /v1/billing/checkout (MIMT Affaires lines, PBX-01).
// Same line, tax lines and metadata as the billing route, so checkout.session.completed syncs it the same way.

import type { PlanCode } from "@mimt/shared";
import { planOf } from "../plansConfig.js";
import type { AppDeps } from "../deps.js";
import type { TelecomAccount, User } from "../repo/types.js";
import { quebecTaxLines } from "./taxes.js";

export async function createPlanCheckout(
  deps: AppDeps,
  input: { account: TelecomAccount; user: User; plan: PlanCode; quantity: number },
): Promise<{ id: string; url: string }> {
  const billing = deps.billing!;
  const { account, user } = input;
  const fr = user.locale === "fr-CA";
  const plan = planOf(input.plan);
  const appUrl = deps.config.APP_BASE_URL.replace(/\/$/, "");
  let customerId = account.stripeCustomerId;
  if (!customerId) {
    customerId = await billing.createCustomer({ accountId: account.id, email: user.email, name: user.displayName, locale: user.locale });
    await deps.repo.updateAccount(account.id, { stripeCustomerId: customerId });
  }
  const line = {
    name: `MIMT ${fr ? plan.name.fr : plan.name.en}`,
    description: fr ? "Prix avant taxes (TPS/TVQ et taxe 9-1-1 en sus)." : "Price before taxes (GST/QST and 9-1-1 tax extra).",
    unitAmountCents: plan.monthlyPriceCents,
    quantity: input.quantity,
    recurring: "month" as const,
  };
  return billing.createCheckout({
    customerId,
    mode: "subscription",
    line,
    taxLines: quebecTaxLines({ baseUnitCents: line.unitAmountCents, quantity: line.quantity, recurring: "month", chargeE911: true, locale: user.locale }),
    metadata: { telecom_account_id: account.id, kind: "plan", code: input.plan },
    successUrl: `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${appUrl}/billing/cancel`,
    locale: user.locale,
  });
}
