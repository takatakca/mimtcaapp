// Checks the static export in out/ after `next build`: every page exists with its SEO basics, and the
// files search engines and AI assistants read (sitemap.xml, robots.txt, llms.txt) are there.
// Exits non-zero on the first broken build so a bad site never reaches the FTP upload.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLANS, formatCad } from "@mimt/shared";

const out = fileURLToPath(new URL("../out/", import.meta.url));
const errors = [];
const fail = (msg) => errors.push(msg);

for (const f of ["sitemap.xml", "robots.txt", "llms.txt", "404.html", "og.png", "favicon.svg", "ads.txt"]) {
  if (!existsSync(join(out, f))) fail(`missing out/${f}`);
}

// Apache (MochaHost) config: HTTPS + www redirects, security headers, branded 404 (public/.htaccess).
const htaccess = existsSync(join(out, ".htaccess")) ? readFileSync(join(out, ".htaccess"), "utf8") : "";
if (!htaccess) fail("missing out/.htaccess (copied from public/.htaccess)");
else {
  for (const needle of ["ErrorDocument 404 /404.html", "Strict-Transport-Security", "Content-Security-Policy", "RewriteRule ^ https://mimt.ca%{REQUEST_URI} [R=301,L,NE]"]) {
    if (!htaccess.includes(needle)) fail(`out/.htaccess: missing ${needle}`);
  }
}

// AdSense: ads.txt holds exactly Google's DIRECT line, and every page loads the ad tag for the same publisher.
const adsTxt = existsSync(join(out, "ads.txt")) ? readFileSync(join(out, "ads.txt"), "utf8") : "";
const adsPub = (adsTxt.match(/^google\.com, (pub-\d{16}), DIRECT, f08c47fec0942fa0\n$/) ?? [])[1];
if (!adsPub) fail(`out/ads.txt is not one "google.com, pub-…, DIRECT, f08c47fec0942fa0" line`);
if (!/script-src[^;]*https:\/\/pagead2\.googlesyndication\.com/.test(htaccess)) fail("out/.htaccess: CSP script-src does not allow AdSense");

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
  if (!/<title>[^<]{10,}<\/title>/.test(html)) fail(`${path}: missing <title>`);
  if (adsPub && !html.includes(`adsbygoogle.js?client=ca-${adsPub}`)) fail(`${path}: no AdSense tag for ca-${adsPub}`);
  if (!html.includes('"consent","default"')) fail(`${path}: no Law 25 consent defaults before the ad tag`);
  const og = (html.match(/<meta property="og:image" content="([^"]+)"/) ?? [])[1];
  if (og && !existsSync(join(out, og.replace(/^https?:\/\/[^/]+/, "")))) fail(`${path}: og:image ${og} is not in out/`);

  // Visible text only (no scripts, styles or HTML comments): honest-marketing rules.
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
  const urgency = text.match(/plus que \d|plus que quelques|dernière chance|compte à rebours|offre se termine|places limitées|only \d+ left|last chance|countdown|hurry|le plus populaire|most popular/i);
  if (urgency) fail(`${path}: false-urgency or popularity wording "${urgency[0]}"`);
  const isCompare = path === "/comparer/" || path === "/en/compare/";
  const rival = text.match(/textnow|fongo|\bfizz\b|magicjack|ooma/i);
  if (rival && !isCompare) fail(`${path}: competitor name "${rival[0]}" outside the comparison page`);
  if (/Appel suspect/.test(text)) fail(`${path}: use « Spam probable », not « Appel suspect »`);
  if (/aggregateRating|ratingValue|"review"/.test(html)) fail(`${path}: ratings or reviews in JSON-LD (MIMT has none)`);

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

// Home: the deploy workflow looks for this phrase; the funnel must keep its offers and structured data.
const home = existsSync(join(out, "index.html")) ? readFileSync(join(out, "index.html"), "utf8") : "";
if (!home.includes("Votre numéro canadien")) fail("/: must contain « Votre numéro canadien » (checked by auto-deploy-website.yml)");
for (const t of ["SoftwareApplication", "FAQPage", "Service"]) if (!home.includes(`"@type":"${t}"`)) fail(`/: JSON-LD has no ${t}`);
if (!home.includes("<!-- [À confirmer par MIMT] Mise en service gratuite")) fail("/: free-setup launch offer lost its [À confirmer par MIMT] marker");
if (!home.includes("Offre de lancement; conditions à venir.")) fail("/: free-setup launch offer lost its small print");
if (!home.includes('href="https://app.mimt.ca"')) fail("/: no link to the web app");
if (!home.includes("data-download")) fail("/: no « Télécharger » trigger");

// Prices on the plans pages come from PLANS (CAD, Quebec format in French).
for (const [path, lang] of [["forfaits/index.html", "fr"], ["en/plans/index.html", "en"]]) {
  const f = join(out, path);
  if (!existsSync(f)) continue;
  const html = readFileSync(f, "utf8").replace(/&nbsp;|\u00a0|\u202f/g, " ");
  for (const p of Object.values(PLANS)) {
    const amount = formatCad(p.monthlyPriceCents, lang).replace(/\u00a0|\u202f/g, " ");
    if (!html.includes(amount)) fail(`/${path}: price ${amount} of ${p.code} not shown`);
  }
}

if (errors.length) {
  console.error(`verify-out: ${errors.length} problem(s)\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log(`verify-out: ${locs.length} pages OK; sitemap.xml, robots.txt and llms.txt present.`);
