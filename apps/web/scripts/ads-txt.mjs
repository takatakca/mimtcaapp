// After `next build`: writes out/ads.txt from NEXT_PUBLIC_ADSENSE_PUBLISHER_ID (pub-… or ca-pub-…).
// Unset: no ads.txt is published (and any stale one is removed). Malformed: the build fails.
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { adsTxt } from "../lib/adsTxt.ts";

const file = fileURLToPath(new URL("../out/ads.txt", import.meta.url));
const raw = process.env.NEXT_PUBLIC_ADSENSE_PUBLISHER_ID?.trim();
const body = adsTxt(raw);
if (raw && !body) {
  console.error("NEXT_PUBLIC_ADSENSE_PUBLISHER_ID must look like pub-0123456789012345 (or ca-pub-…)");
  process.exit(1);
}
if (body) {
  writeFileSync(file, body);
  console.log("ads.txt written for AdSense");
} else {
  if (existsSync(file)) rmSync(file);
  console.log("ads.txt skipped (NEXT_PUBLIC_ADSENSE_PUBLISHER_ID unset)");
}
