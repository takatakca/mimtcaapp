// Display helpers for catalog offers and orders (pure).
import { formatCad, type Offer, type OrderState, type ProductLine } from "@mimt/shared";
import type { Lang, TKey, Vars } from "../../i18n/core";

type T = (key: TKey, vars?: Vars) => string;

export const LINE_KEY: Record<ProductLine, TKey> = {
  voip_consumer: "line.voipConsumer",
  voip_business: "line.voipBusiness",
  internet_residential: "line.internetResidential",
  internet_business: "line.internetBusiness",
  mobile: "line.mobile",
  home_phone: "line.homePhone",
  tv: "line.tv",
};

export const ORDER_STATE_KEY: Record<OrderState, TKey> = {
  draft: "order.state.draft",
  submitted: "order.state.submitted",
  credit_check: "order.state.creditCheck",
  pending_provider: "order.state.pendingProvider",
  scheduled: "order.state.scheduled",
  active: "order.state.active",
  suspended: "order.state.suspended",
  cancel_requested: "order.state.cancelRequested",
  cancelled: "order.state.cancelled",
  failed: "order.state.failed",
};

export function orderTone(state: OrderState): "ok" | "warn" | "error" | "info" | "muted" {
  if (state === "active") return "ok";
  if (state === "failed") return "error";
  if (state === "cancelled") return "muted";
  if (state === "suspended" || state === "cancel_requested") return "warn";
  return "info";
}

/** Short feature lines for an offer card ("400 Mbit/s", "Données illimitées", "5G", "eSIM"). */
export function offerFeatures(offer: Pick<Offer, "attributes" | "productLine">, t: T): string[] {
  const a = offer.attributes;
  const out: string[] = [];
  if (a.downloadMbps) out.push(t("offer.speed", { down: a.downloadMbps, up: a.uploadMbps ?? "?" }));
  if (offer.productLine.startsWith("internet")) out.push(a.internetDataGb == null ? t("offer.unlimitedUsage") : t("offer.dataGb", { gb: a.internetDataGb }));
  if (offer.productLine === "mobile") {
    out.push(a.dataGb == null ? t("offer.unlimitedData") : t("offer.dataGb", { gb: a.dataGb }));
    out.push(a.minutes == null ? t("offer.unlimitedCalls") : t("offer.minutes", { minutes: a.minutes }));
  }
  if (a.network) out.push(a.network.toUpperCase());
  if (a.esim) out.push(t("offer.esim"));
  if (a.technology) out.push(t(a.technology === "fibre" ? "offer.fibre" : a.technology === "cable" ? "offer.cable" : "offer.fixedWireless"));
  return out;
}

export function termText(termMonths: number, t: T): string {
  return termMonths === 0 ? t("offer.noTerm") : t("offer.term", { months: termMonths });
}

export function priceText(cents: number, lang: Lang, t: T): string {
  return t("account.perMonth", { price: formatCad(cents, lang) });
}
