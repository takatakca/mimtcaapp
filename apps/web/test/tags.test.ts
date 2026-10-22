// Google tags (lib/tags.ts): switched on by valid ids only, always behind Consent Mode defaults.
import assert from "node:assert/strict";
import { test } from "node:test";
import { tagBootstrap, tagIds } from "../lib/tags.ts";

test("only valid ids turn a tag on", () => {
  assert.deepEqual(tagIds({ NEXT_PUBLIC_GA4_ID: "G-ABC123XYZ9", NEXT_PUBLIC_GADS_ID: "AW-1234567890" }, null), { adsenseClient: null, ga4: "G-ABC123XYZ9", ads: "AW-1234567890" });
  assert.deepEqual(tagIds({ NEXT_PUBLIC_GA4_ID: "UA-123", NEXT_PUBLIC_GADS_ID: "123" }, null), { adsenseClient: null, ga4: null, ads: null });
});

test("consent defaults come first and every signal starts denied without a stored choice", () => {
  const js = tagBootstrap({ adsenseClient: "ca-pub-4518068873401341", ga4: "G-ABC123XYZ9", ads: "AW-1234567890" });
  const consent = js.indexOf('gtag("consent","default"');
  assert.ok(consent >= 0 && consent < js.indexOf("googletagmanager") && consent < js.indexOf("adsbygoogle.js"));
  assert.match(js, /ad_storage:g,ad_user_data:g,ad_personalization:g,analytics_storage:g/);
  assert.match(js, /var g=c==="granted"\?"granted":"denied"/);
  assert.match(js, /gtag\("config","G-ABC123XYZ9"\)/);
  assert.match(js, /gtag\("config","AW-1234567890"\)/);
});

test("no GA4 or Ads id: no gtag.js is loaded", () => {
  const js = tagBootstrap({ adsenseClient: "ca-pub-4518068873401341" });
  assert.doesNotMatch(js, /googletagmanager/);
  assert.match(js, /adsbygoogle\.js\?client=ca-pub-4518068873401341/);
});
