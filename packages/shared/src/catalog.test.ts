import { describe, expect, it } from "vitest";
import {
  consumerCodeFor,
  filterOffersForPostalCode,
  fsaOf,
  nextOrderState,
  normalizePostalCode,
  ORDER_EVENTS,
  ORDER_STATES,
  type OrderEvent,
  type OrderState,
} from "./catalog.js";

// Every allowed transition. Everything not listed must be refused (null).
const ALLOWED: Record<OrderState, Partial<Record<OrderEvent, OrderState>>> = {
  draft: { submit: "submitted", cancel_requested: "cancelled", fail: "failed" },
  submitted: { credit_check_started: "credit_check", credit_approved: "pending_provider", cancel_requested: "cancelled", fail: "failed" },
  credit_check: { credit_approved: "pending_provider", credit_declined: "failed", cancel_requested: "cancelled", fail: "failed" },
  pending_provider: {
    provider_accepted: "pending_provider",
    appointment_scheduled: "scheduled",
    activated: "active",
    provider_rejected: "failed",
    cancel_requested: "cancel_requested",
    fail: "failed",
  },
  scheduled: { appointment_scheduled: "scheduled", activated: "active", provider_rejected: "failed", cancel_requested: "cancel_requested", fail: "failed" },
  active: { suspended: "suspended", cancel_requested: "cancel_requested" },
  suspended: { restored: "active", cancel_requested: "cancel_requested" },
  cancel_requested: { cancel_confirmed: "cancelled" },
  cancelled: {},
  failed: {},
};

describe("nextOrderState (exhaustive)", () => {
  for (const state of ORDER_STATES) {
    for (const event of ORDER_EVENTS) {
      const expected = ALLOWED[state][event] ?? null;
      it(`${state} + ${event} → ${expected ?? "refused"}`, () => {
        expect(nextOrderState({ state }, event)).toBe(expected);
      });
    }
  }

  it("walks the happy path draft → active → cancelled", () => {
    const path: OrderEvent[] = ["submit", "credit_check_started", "credit_approved", "provider_accepted", "appointment_scheduled", "activated", "cancel_requested", "cancel_confirmed"];
    let s: OrderState = "draft";
    for (const e of path) s = nextOrderState({ state: s }, e)!;
    expect(s).toBe("cancelled");
  });

  it("terminal states accept nothing", () => {
    for (const e of ORDER_EVENTS) {
      expect(nextOrderState({ state: "cancelled" }, e)).toBeNull();
      expect(nextOrderState({ state: "failed" }, e)).toBeNull();
    }
  });
});

describe("postal codes and availability", () => {
  it("normalizes Canadian postal codes", () => {
    expect(normalizePostalCode("h2x1y4")).toBe("H2X 1Y4");
    expect(normalizePostalCode("H2X-1Y4")).toBe("H2X 1Y4");
    expect(normalizePostalCode("D2X 1Y4")).toBeNull();
    expect(normalizePostalCode("90210")).toBeNull();
    expect(fsaOf("g1r 2k5")).toBe("G1R");
    expect(fsaOf("J4K")).toBe("J4K");
    expect(fsaOf("nope")).toBeNull();
  });

  it("keeps active offers sold at the FSA, cheapest first", () => {
    const offers = [
      { code: "a", status: "active" as const, availableFsas: ["H"], monthlyPriceCents: 6000 },
      { code: "b", status: "active" as const, availableFsas: null, monthlyPriceCents: 3000 },
      { code: "c", status: "draft" as const, availableFsas: null, monthlyPriceCents: 1000 },
      { code: "d", status: "active" as const, availableFsas: ["G1R", "J4K"], monthlyPriceCents: 4000 },
      { code: "e", status: "retired" as const, availableFsas: ["H"], monthlyPriceCents: 2000 },
    ];
    expect(filterOffersForPostalCode(offers, "H2X 1Y4").map((o) => o.code)).toEqual(["b", "a"]);
    expect(filterOffersForPostalCode(offers, "G1R 2K5").map((o) => o.code)).toEqual(["b", "d"]);
    expect(filterOffersForPostalCode(offers, "not a code")).toEqual([]);
  });

  it("maps product lines to consumer codes", () => {
    expect(consumerCodeFor("mobile")).toBe("wireless");
    expect(consumerCodeFor("internet_residential")).toBe("internet");
    expect(consumerCodeFor("internet_business")).toBe("internet");
    expect(consumerCodeFor("voip_consumer")).toBe("none");
  });
});
