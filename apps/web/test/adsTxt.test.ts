// ads.txt for AdSense (lib/adsTxt.ts): published on the root domain only when a real publisher id is set.
import assert from "node:assert/strict";
import { test } from "node:test";
import { adsensePublisherId, adsTxt } from "../lib/adsTxt.ts";

test("no publisher id, no ads.txt (never invented)", () => {
  assert.equal(adsTxt(undefined), null);
  assert.equal(adsTxt(""), null);
  assert.equal(adsTxt("pub-123"), null);
  assert.equal(adsTxt("ca-pub-XXXXXXXXXXXXXXXX"), null);
});

test("accepts pub-… and ca-pub-… and writes Google's DIRECT line", () => {
  assert.equal(adsensePublisherId(" ca-pub-0123456789012345 "), "pub-0123456789012345");
  assert.equal(adsTxt("pub-0123456789012345"), "google.com, pub-0123456789012345, DIRECT, f08c47fec0942fa0\n");
});
