// How the native store builds handle paid plans (pure, unit-tested). Set at build time with STORE_PURCHASES
// (app.config.ts → extra.storePurchases):
// - "iap" (default): plans and "Sans pub" are sold with Apple / Google in-app purchase (services/iap.ts).
// - "companion": nothing is sold in the app (App Review Guideline 3.1.3(f), Play "consumption-only"): no prices,
//   no buy buttons, no text pointing to a website. A plan bought on mimt.ca still shows as active.
// Either way the app never opens Stripe: the web (mimt.ca, app.mimt.ca) keeps Stripe as its own channel.

export type StorePurchasesMode = "iap" | "companion";

export function resolveStoreMode(value: unknown): StorePurchasesMode {
  return value === "companion" ? "companion" : "iap";
}
