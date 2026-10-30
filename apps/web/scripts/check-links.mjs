// Crawls the static export in out/ like a visitor would: starts at / and /en/, follows every internal link, and
// fails when a link points to a page or file that is not in out/, or when a page has almost no main content.
// Runs after verify-out.mjs in `pnpm build` (AdSense reviewers flag broken links and empty pages).
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const out = fileURLToPath(new URL("../out/", import.meta.url));
const MIN_WORDS = 120;
const errors = [];

/** out/ file for a site path, or null. */
function fileFor(path) {
  const clean = decodeURIComponent(path.split("#")[0].split("?")[0]);
  const candidates = clean.endsWith("/") ? [join(out, clean, "index.html")] : [join(out, clean), join(out, clean, "index.html"), join(out, `${clean}.html`)];
  return candidates.find((f) => existsSync(f) && statSync(f).isFile()) ?? null;
}

function mainWords(html) {
  const main = html.match(/<main[\s\S]*?<\/main>/)?.[0] ?? "";
  const text = main
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ");
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const queue = ["/", "/en/"];
const seen = new Set(queue);
let pages = 0;
while (queue.length) {
  const path = queue.shift();
  const file = fileFor(path);
  if (!file) continue; // reported where it was linked from
  if (!file.endsWith(".html")) continue;
  pages++;
  const html = readFileSync(file, "utf8");
  const words = mainWords(html);
  if (words < MIN_WORDS) errors.push(`${path}: only ${words} words of main content`);
  for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
    const href = m[1].replace(/&amp;/g, "&");
    if (/^(https?:|mailto:|tel:|#|javascript:)/.test(href)) continue;
    const target = href.startsWith("/") ? href : new URL(href, `https://x${path}`).pathname;
    const bare = target.split("#")[0].split("?")[0];
    if (!fileFor(bare)) {
      errors.push(`${path}: broken link to ${href}`);
      continue;
    }
    if (!seen.has(bare)) {
      seen.add(bare);
      queue.push(bare);
    }
  }
}

if (errors.length) {
  console.error(`check-links: ${errors.length} problem(s)\n- ${[...new Set(errors)].join("\n- ")}`);
  process.exit(1);
}
console.log(`check-links: ${pages} pages reached from / and /en/, no broken internal link, none under ${MIN_WORDS} words.`);
