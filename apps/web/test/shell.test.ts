// Mobile menu, sticky CTA bar vs download sheet, and the Apache config shipped in out/.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

test("mobile menu: Escape closes it and gives focus back to its toggle, unless a modal is open", () => {
  const src = read("components/SiteEffects.tsx");
  assert.match(src, /e\.key !== "Escape"/);
  assert.match(src, /details\.nav-mobile\[open\]/);
  assert.match(src, /menu\.open = false;\s*menu\.querySelector<HTMLElement>\("summary"\)\?\.focus\(\);/);
  assert.match(src, /\[aria-modal="true"\]/);
  assert.match(read("components/Shell.tsx"), /<details className="nav-mobile">\s*<summary/);
});

test("download sheet never stacks on the sticky CTA bar", () => {
  const prompt = read("components/DownloadPrompt.tsx");
  assert.match(prompt, /root\.setAttribute\("data-sheet", ""\)/);
  assert.match(prompt, /return \(\) => root\.removeAttribute\("data-sheet"\)/);
  const css = read("styles/home.css");
  assert.match(css, /html\[data-sheet\] \.mobile-cta \{[^}]*visibility: hidden;/);
  const sheet = css.match(/\.dl-sheet \{[^}]*\}/)?.[0] ?? "";
  assert.match(sheet, /bottom: calc\(12px \+ env\(safe-area-inset-bottom\)\)/, "sheet sits at the bottom edge, where the bar was");
});

test("public/.htaccess: HTTPS and apex redirects, security headers, branded 404, caching", () => {
  const ht = read("public/.htaccess");
  for (const needle of [
    "ErrorDocument 404 /404.html",
    "RewriteCond %{HTTPS} !=on",
    "RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L,NE]",
    "RewriteCond %{HTTP_HOST} ^www\\.mimt\\.ca$ [NC]",
    "RewriteRule ^ https://mimt.ca%{REQUEST_URI} [R=301,L,NE]",
    'Header always set Strict-Transport-Security "max-age=31536000"',
    'Header always set X-Content-Type-Options "nosniff"',
    'Header always set X-Frame-Options "SAMEORIGIN"',
    'Header always set Referrer-Policy "strict-origin-when-cross-origin"',
    "frame-ancestors 'self'",
    'Header always set Cache-Control "public, max-age=31536000, immutable"',
  ]) {
    assert.ok(ht.includes(needle), `missing: ${needle}`);
  }
  // Directives that need a module stay inside their <IfModule> guard (a missing module must not 500 the site).
  const rewrite = ht.slice(ht.indexOf("<IfModule mod_rewrite.c>"), ht.indexOf("</IfModule>", ht.indexOf("<IfModule mod_rewrite.c>")));
  assert.ok(rewrite.includes("RewriteRule"), "rewrites inside <IfModule mod_rewrite.c>");
  const headers = ht.slice(ht.indexOf("<IfModule mod_headers.c>"));
  assert.equal((ht.match(/Header always set/g) ?? []).length, (headers.match(/Header always set/g) ?? []).length, "every Header inside <IfModule mod_headers.c>");
  // Apache keeps backslashes inside quoted arguments: "\\." in a regex would never match a dot.
  assert.ok(!ht.includes("\\\\."), "no doubled backslashes in regexes");
});
