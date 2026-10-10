// Checks the static export in out/ after `next build`: every page exists with its SEO basics, and the
// files search engines and AI assistants read (sitemap.xml, robots.txt, llms.txt) are there.
// Exits non-zero on the first broken build so a bad site never reaches the FTP upload.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const out = fileURLToPath(new URL("../out/", import.meta.url));
const errors = [];
const fail = (msg) => errors.push(msg);

for (const f of ["sitemap.xml", "robots.txt", "llms.txt", "404.html", "og.png", "favicon.svg"]) {
  if (!existsSync(join(out, f))) fail(`missing out/${f}`);
}

const sitemap = existsSync(join(out, "sitemap.xml")) ? readFileSync(join(out, "sitemap.xml"), "utf8") : "";
const site = (sitemap.match(/<loc>(https?:\/\/[^/<]+)\//) ?? [])[1] ?? "https://mimt.ca";
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (locs.length < 20) fail(`sitemap.xml lists only ${locs.length} URLs`);
if (!sitemap.includes('hreflang="fr-CA"') || !sitemap.includes('hreflang="en-CA"')) fail("sitemap.xml has no fr-CA/en-CA alternates");

const robots = existsSync(join(out, "robots.txt")) ? readFileSync(join(out, "robots.txt"), "utf8") : "";
if (!/Sitemap: \S+\/sitemap\.xml/.test(robots)) fail("robots.txt does not point to the sitemap");
if (/Disallow: \/\s*$/m.test(robots)) fail("robots.txt blocks the whole site");

const llms = existsSync(join(out, "llms.txt")) ? readFileSync(join(out, "llms.txt"), "utf8") : "";
if (!llms.startsWith("# MIMT")) fail("llms.txt does not start with '# MIMT'");

for (const url of locs) {
  const path = url.slice(site.length);
  const file = join(out, path, "index.html");
  if (!existsSync(file)) {
    fail(`${path}: no index.html for a sitemap URL`);
    continue;
  }
  const html = readFileSync(file, "utf8");
  const en = path.startsWith("/en/");
  if (!html.includes(`<html lang="${en ? "en-CA" : "fr-CA"}"`)) fail(`${path}: wrong or missing <html lang>`);
  if (!html.includes(`<link rel="canonical" href="${url}"`)) fail(`${path}: canonical is not ${url}`);
  if (!html.includes('hrefLang="fr-CA"') || !html.includes('hrefLang="en-CA"')) fail(`${path}: missing hreflang alternates`);
  if (!/<meta name="description" content="[^"]{50,}"/.test(html)) fail(`${path}: missing meta description`);
  if (!html.includes('property="og:image"') || !html.includes('name="twitter:card"')) fail(`${path}: missing Open Graph / Twitter tags`);
  const h1 = (html.match(/<h1[\s>]/g) ?? []).length;
  if (h1 !== 1) fail(`${path}: ${h1} <h1> elements (want 1)`);
  for (const img of html.match(/<img\b[^>]*>/g) ?? []) if (!/\balt="/.test(img)) fail(`${path}: <img> without alt`);
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (scripts.length === 0) fail(`${path}: no JSON-LD`);
  for (const s of scripts) {
    try {
      const data = JSON.parse(s[1]);
      const types = (data["@graph"] ?? [data]).map((n) => n["@type"]);
      if (!types.includes("Organization")) fail(`${path}: JSON-LD has no Organization`);
      if (types.includes("LocalBusiness")) fail(`${path}: LocalBusiness without a street address in the repo`);
    } catch (e) {
      fail(`${path}: invalid JSON-LD (${e.message})`);
    }
  }
}

if (errors.length) {
  console.error(`verify-out: ${errors.length} problem(s)\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log(`verify-out: ${locs.length} pages OK; sitemap.xml, robots.txt and llms.txt present.`);
