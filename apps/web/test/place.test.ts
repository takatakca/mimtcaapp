// Number picker place names (lib/place.ts): readable rate centres, area-code region when Twilio has none.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as placeModule from "../lib/place.ts";
import { placeName } from "../lib/place.ts";

test("run-together rate centres are spelled out", () => {
  assert.equal(placeName("+14382553958", "Pointeclaire", "QC", true), "Pointe-Claire");
  assert.equal(placeName("+14382553958", "Roxboro", "QC", true), "Roxboro");
});

test("a missing locality falls back to the area code's region, never just « QC »", () => {
  assert.equal(placeName("+14382313397", null, "QC", true), "Montréal");
  assert.equal(placeName("+14505550000", null, "QC", false), "Greater Montréal");
  assert.equal(placeName("+18195550000", undefined, "QC", true), "Ouest et Nord du Québec");
  assert.equal(placeName("+17805550000", null, "AB", true), "AB");
});

test("memorable numbers get a badge, ordinary ones do not", () => {
  const { memorable } = placeModule;
  assert.equal(memorable("+14385551111", true), "Quatre chiffres pareils");
  assert.equal(memorable("+14385551234", true), "Suite de chiffres");
  assert.equal(memorable("+14385553300", true), "Finit par 00");
  assert.equal(memorable("+14385552323", false), "Repeating pattern");
  assert.equal(memorable("+14385551221", false), "Reads both ways");
  assert.equal(memorable("+14382313397", true), null);
});
