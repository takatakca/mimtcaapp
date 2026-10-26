// After `next build`: writes out/mimt-release.json = {"commit":"<sha>"} so the public site states which commit
// it serves. The website workflow compares it with the commit that passed CI. Local builds have no commit: skipped.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { releaseCommit } from "../lib/releaseManifest.ts";

const commit = releaseCommit(process.env);
if (commit) {
  writeFileSync(fileURLToPath(new URL("../out/mimt-release.json", import.meta.url)), `${JSON.stringify({ commit })}\n`);
  console.log(`mimt-release.json written for ${commit}`);
} else {
  console.log("mimt-release.json skipped: no GITHUB_SHA or SOURCE_COMMIT");
}
