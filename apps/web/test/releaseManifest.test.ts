// out/mimt-release.json (lib/releaseManifest.ts): which commit the public site was built from.
import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseCommit } from "../lib/releaseManifest.ts";

const sha = "0123456789abcdef0123456789abcdef01234567";

test("GitHub Actions: GITHUB_SHA", () => {
  assert.equal(releaseCommit({ GITHUB_SHA: ` ${sha} ` }), sha);
});

test("Coolify: SOURCE_COMMIT when GITHUB_SHA is absent", () => {
  assert.equal(releaseCommit({ SOURCE_COMMIT: sha.toUpperCase() }), sha);
});

test("no commit, or not a full SHA: no file rather than a wrong revision", () => {
  assert.equal(releaseCommit({}), null);
  assert.equal(releaseCommit({ SOURCE_COMMIT: "HEAD" }), null);
  assert.equal(releaseCommit({ GITHUB_SHA: "0123456" }), null);
});
