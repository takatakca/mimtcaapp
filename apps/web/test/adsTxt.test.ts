// ads.txt for AdSense (lib/adsTxt.ts): always published on the root domain, MIMT's account unless overridden.
import assert from "node:assert/strict";
import { test } from "node:test";
import { adsenseClient, adsensePublisherId, adsTxt } from "../lib/adsTxt.ts";

test("unset: MIMT's own publisher line, exactly as AdSense asks", () => {
  assert.equal(adsTxt(undefined), "google.com, pub-4518068873401341, DIRECT, f08c47fec0942fa0\n");
  assert.equal(adsTxt(" "), "google.com, pub-4518068873401341, DIRECT, f08c47fec0942fa0\n");
  assert.equal(adsenseClient(undefined), "ca-pub-4518068873401341");
});

test("malformed override: no file (the build fails instead of publishing a wrong line)", () => {
  assert.equal(adsTxt("pub-123"), null);
  assert.equal(adsenseClient("pub-123"), null);
  assert.equal(adsTxt("ca-pub-XXXXXXXXXXXXXXXX"), null);
});

test("accepts pub-… and ca-pub-… and writes Google's DIRECT line", () => {
  assert.equal(adsensePublisherId(" ca-pub-0123456789012345 "), "pub-0123456789012345");
  assert.equal(adsTxt("pub-0123456789012345"), "google.com, pub-0123456789012345, DIRECT, f08c47fec0942fa0\n");
});
