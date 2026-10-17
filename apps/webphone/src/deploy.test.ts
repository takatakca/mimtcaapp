// @vitest-environment node
// Apache config (public/.htaccess) and the release manifest that the deploy workflow verifies.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { releaseCommit } from "../vite.config";

const htaccess = readFileSync(new URL("../public/.htaccess", import.meta.url), "utf8");
const csp = (htaccess.match(/Header always set Content-Security-Policy "([^"]+)"/) ?? [])[1] ?? "";
const directive = (name: string) => (csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "").split(/\s+/).slice(1);

describe("app.mimt.ca .htaccess", () => {
  it("redirects HTTP to HTTPS and keeps the SPA fallback for unknown paths only", () => {
    expect(htaccess).toContain("RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L,NE]");
    expect(htaccess).toMatch(/RewriteCond %\{REQUEST_FILENAME\} !-f\s+RewriteCond %\{REQUEST_FILENAME\} !-d\s+RewriteRule \^ index\.html \[L\]/);
  });

  it("sends the security headers inside <IfModule mod_headers.c>", () => {
    const guarded = htaccess.slice(htaccess.indexOf("<IfModule mod_headers.c>"));
    for (const h of [
      'Strict-Transport-Security "max-age=31536000; includeSubDomains"',
      'X-Content-Type-Options "nosniff"',
      'X-Frame-Options "DENY"',
      'Referrer-Policy "no-referrer"',
      'X-Robots-Tag "noindex, nofollow, noarchive"',
      'Permissions-Policy "microphone=(self), camera=(self), display-capture=(self)',
    ]) {
      expect(guarded).toContain(`Header always set ${h}`);
    }
  });

  it("has a CSP that cannot be framed and allows only what the app talks to", () => {
    expect(directive("frame-ancestors")).toEqual(["'none'"]);
    expect(directive("script-src")).toEqual(["'self'"]);
    expect(directive("object-src")).toEqual(["'none'"]);
    const connect = directive("connect-src");
    for (const origin of ["https://api.mimt.ca", "https://takatak.ca", "wss://*.twilio.com", "https://*.twilio.com", "wss://rtc.mimt.ca", "https://rtc.mimt.ca"]) {
      expect(connect).toContain(origin);
    }
    expect(directive("media-src")).toEqual(expect.arrayContaining(["blob:", "https://api.mimt.ca"]));
  });

  it("never lets the app shell or the service worker be cached long; hashed assets are immutable", () => {
    // Apache keeps backslashes inside quoted arguments, so the regex must use single escapes.
    expect(htaccess).toContain('<FilesMatch "^(index\\.html|sw\\.js|manifest\\.webmanifest|mimt-release\\.json|robots\\.txt)$">');
    expect(htaccess).not.toContain("\\\\.");
    expect(htaccess).toContain('Header always set Cache-Control "no-cache, no-store, must-revalidate"');
    expect(htaccess).toContain('<If "%{REQUEST_URI} =~ m#^/assets/#">');
    expect(htaccess).toContain('Header always set Cache-Control "public, max-age=31536000, immutable"');
  });
});

describe("mimt-release.json commit", () => {
  it("uses GITHUB_SHA in GitHub Actions", () => {
    expect(releaseCommit({ GITHUB_SHA: " 0123456789abcdef0123456789abcdef01234567 " })).toBe("0123456789abcdef0123456789abcdef01234567");
  });

  it("falls back to the local git revision (or 'unknown'), never an empty string", () => {
    expect(releaseCommit({})).toMatch(/^([0-9a-f]{40}|unknown)$/);
  });
});
