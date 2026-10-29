// The site's missions page and promo must say exactly what the API grants (packages/shared missions).
import assert from "node:assert/strict";
import { test } from "node:test";
import { MISSIONS as SERVER, MISSION_POINTS_CAP } from "@mimt/shared";
import { MISSIONS, missionPointsTotal, promoDue, markPromoSeen, PROMO_EVERY_MS, tickerOffers, yearlyOfferLive } from "../lib/growth.ts";

test("site missions match the API's missions and points", () => {
  for (const m of MISSIONS) {
    const s = SERVER.find((x) => x.id === m.id);
    assert.ok(s, m.id);
    assert.equal(m.points ?? 0, s.points, m.id);
  }
  assert.equal(missionPointsTotal(), MISSION_POINTS_CAP);
});

test("the yearly offer is announced only when plans carry a yearly price", () => {
  const announced = tickerOffers("fr").some((o) => o.text.includes("12 mois pour le prix de 11"));
  assert.equal(announced, yearlyOfferLive());
});

test("the promo shows at most once every 7 days, and never when storage is blocked", () => {
  const box = new Map<string, string>();
  const store = () => ({ getItem: (k: string) => box.get(k) ?? null, setItem: (k: string, v: string) => void box.set(k, v) });
  const t0 = new Date("2026-10-27T12:00:00Z");
  assert.equal(promoDue(store, t0), true);
  markPromoSeen(store, t0);
  assert.equal(promoDue(store, new Date(t0.getTime() + PROMO_EVERY_MS - 1)), false);
  assert.equal(promoDue(store, new Date(t0.getTime() + PROMO_EVERY_MS)), true);
  assert.equal(promoDue(() => { throw new Error("blocked"); }), false);
});
