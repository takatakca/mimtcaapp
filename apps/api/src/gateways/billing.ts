import Stripe from "stripe";

export interface CheckoutLine {
  name: string;
  description: string;
  unitAmountCents: number;
  quantity: number;
  recurring?: "month" | "year";
}

export interface BillingGateway {
  createCustomer(input: { accountId: string; email: string | null; name: string | null; locale: string }): Promise<string>;
  createCheckout(input: {
    customerId: string;
    mode: "subscription" | "payment";
    line: CheckoutLine;
    /** TPS, TVQ and the Quebec 9-1-1 tax, shown as their own invoice lines. */
    taxLines?: CheckoutLine[];
    metadata: Record<string, string>;
    successUrl: string;
    cancelUrl: string;
    locale: "fr-CA" | "en-CA";
  }): Promise<{ id: string; url: string }>;
  createPortal(customerId: string, returnUrl: string): Promise<string>;
  /** Verifies the Stripe-Signature header against the raw body. Throws on mismatch. */
  constructEvent(rawBody: Buffer, signature: string): Stripe.Event;
  retrieveSubscription(id: string): Promise<Stripe.Subscription>;
  /**
   * Card fingerprint of a paid invoice or payment (same card = same fingerprint across customers), used by the
   * referral anti-fraud check. Null when unknown (not a card, not paid yet). Optional: absent = no check.
   */
  paymentFingerprint?(ref: { invoiceId?: string; paymentIntentId?: string }): Promise<string | null>;
  /** Adds a credit to the customer's Stripe balance (taken off the next invoice). Used for referral rewards. */
  creditBalance?(input: { customerId: string; amountCents: number; description: string; idempotencyKey: string }): Promise<void>;
  /** Resale (catalog): adds the offer's monthly price to the customer's services subscription on activation. */
  createServiceItem?(input: ServiceItemInput): Promise<{ subscriptionId: string; itemId: string }>;
  /** Resale: removes the item when the service is cancelled (prorated). */
  removeServiceItem?(input: { itemId: string; idempotencyKey: string }): Promise<void>;
}

export interface ServiceItemInput {
  customerId: string;
  /** Existing services subscription of the account to add the item to; null creates a new one. */
  subscriptionId: string | null;
  offer: { code: string; name: string; monthlyPriceCents: number; stripePriceId: string | null };
  /** One-time activation / install fee added to the next invoice. */
  setupFeeCents: number;
  setupFeeDescription: string;
  metadata: Record<string, string>;
  /** Stable per order: retries never double-bill. */
  idempotencyKey: string;
}

export class StripeGateway implements BillingGateway {
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
  ) {
    this.stripe = new Stripe(secretKey, { maxNetworkRetries: 2, appInfo: { name: "mimt-api" } });
  }

  async createCustomer(input: { accountId: string; email: string | null; name: string | null; locale: string }) {
    const c = await this.stripe.customers.create({
      ...(input.email ? { email: input.email } : {}),
      ...(input.name ? { name: input.name } : {}),
      preferred_locales: [input.locale.startsWith("fr") ? "fr-CA" : "en"],
      metadata: { telecom_account_id: input.accountId },
    });
    return c.id;
  }

  async createCheckout(input: Parameters<BillingGateway["createCheckout"]>[0]) {
    const { line } = input;
    const session = await this.stripe.checkout.sessions.create({
      mode: input.mode,
      customer: input.customerId,
      client_reference_id: input.metadata.telecom_account_id,
      locale: input.locale === "fr-CA" ? "fr-CA" : "en",
      currency: "cad",
      // Taxes: Stripe Tax is off until GST/QST registration is done (MIMT-REGULATORY.md §11).
      automatic_tax: { enabled: false },
      line_items: [line, ...(input.taxLines ?? [])].map((item) => ({
        quantity: item.quantity,
        price_data: {
          currency: "cad",
          unit_amount: item.unitAmountCents,
          product_data: { name: item.name, description: item.description },
          ...(item.recurring ? { recurring: { interval: item.recurring } } : {}),
        },
      })),
      custom_text: {
        submit: {
          message:
            input.locale === "fr-CA"
              ? "La TPS, la TVQ et la taxe municipale 9-1-1 du Québec figurent comme lignes distinctes sur la facture."
              : "GST, QST and the Quebec municipal 9-1-1 tax are separate lines on this invoice.",
        },
      },
      metadata: input.metadata,
      ...(input.mode === "subscription" ? { subscription_data: { metadata: input.metadata } } : { payment_intent_data: { metadata: input.metadata } }),
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    });
    if (!session.url) throw new Error("Stripe returned no checkout URL");
    return { id: session.id, url: session.url };
  }

  async createPortal(customerId: string, returnUrl: string) {
    const s = await this.stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
    return s.url;
  }

  constructEvent(rawBody: Buffer, signature: string) {
    return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }

  retrieveSubscription(id: string) {
    return this.stripe.subscriptions.retrieve(id);
  }

  async paymentFingerprint(ref: { invoiceId?: string; paymentIntentId?: string }): Promise<string | null> {
    let paymentIntentId = ref.paymentIntentId ?? null;
    if (!paymentIntentId && ref.invoiceId) {
      const payments = await this.stripe.invoicePayments.list({ invoice: ref.invoiceId, status: "paid", limit: 1 });
      const pi = payments.data[0]?.payment.payment_intent;
      paymentIntentId = typeof pi === "string" ? pi : (pi?.id ?? null);
    }
    if (!paymentIntentId) return null;
    const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["payment_method"] });
    const method = intent.payment_method;
    return typeof method === "object" && method ? (method.card?.fingerprint ?? null) : null;
  }

  async creditBalance(input: { customerId: string; amountCents: number; description: string; idempotencyKey: string }) {
    await this.stripe.customers.createBalanceTransaction(
      input.customerId,
      { amount: -Math.abs(input.amountCents), currency: "cad", description: input.description },
      { idempotencyKey: input.idempotencyKey },
    );
  }

  /** One CAD monthly price per (offer, amount), found by lookup_key so it is created only once. */
  private async offerPrice(offer: ServiceItemInput["offer"]): Promise<string> {
    if (offer.stripePriceId) return offer.stripePriceId;
    const lookupKey = `mimt_offer_${offer.code}_${offer.monthlyPriceCents}`;
    const found = await this.stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    if (found.data[0]) return found.data[0].id;
    const price = await this.stripe.prices.create(
      {
        currency: "cad",
        unit_amount: offer.monthlyPriceCents,
        recurring: { interval: "month" },
        lookup_key: lookupKey,
        product_data: { name: offer.name, metadata: { offer_code: offer.code } },
        metadata: { offer_code: offer.code },
      },
      { idempotencyKey: `price:${lookupKey}` },
    );
    return price.id;
  }

  async createServiceItem(input: ServiceItemInput) {
    const price = await this.offerPrice(input.offer);
    if (input.setupFeeCents > 0) {
      await this.stripe.invoiceItems.create(
        { customer: input.customerId, currency: "cad", amount: input.setupFeeCents, description: input.setupFeeDescription, metadata: input.metadata },
        { idempotencyKey: `${input.idempotencyKey}:setup` },
      );
    }
    if (input.subscriptionId) {
      const item = await this.stripe.subscriptionItems.create(
        { subscription: input.subscriptionId, price, quantity: 1, proration_behavior: "create_prorations", metadata: input.metadata },
        { idempotencyKey: `${input.idempotencyKey}:item` },
      );
      return { subscriptionId: input.subscriptionId, itemId: item.id };
    }
    const sub = await this.stripe.subscriptions.create(
      {
        customer: input.customerId,
        currency: "cad",
        items: [{ price, quantity: 1, metadata: input.metadata }],
        // Taxes: Stripe Tax stays off until GST/QST registration (MIMT-REGULATORY.md §11).
        automatic_tax: { enabled: false },
        payment_behavior: "allow_incomplete",
        metadata: { ...input.metadata, kind: "resale_services" },
      },
      { idempotencyKey: `${input.idempotencyKey}:sub` },
    );
    const item = sub.items.data[0];
    if (!item) throw new Error("Stripe returned a subscription without items");
    return { subscriptionId: sub.id, itemId: item.id };
  }

  async removeServiceItem(input: { itemId: string; idempotencyKey: string }) {
    await this.stripe.subscriptionItems.del(input.itemId, { proration_behavior: "create_prorations" }, { idempotencyKey: input.idempotencyKey });
  }
}
