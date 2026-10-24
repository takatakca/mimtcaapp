#!/usr/bin/env node
// Generates the MIMT app icon, Android adaptive icon (foreground + monochrome), splash image,
// Android notification icon and the Google Play feature graphic from one SVG mark.
//
// Usage (from the repo root):  node apps/mobile/scripts/make-icons.mjs
// Needs the Playwright Chromium that the e2e package already uses (`pnpm --filter @mimt/e2e exec playwright install chromium`).
//
// This is the MIMT product mark (a bold "M" with a call wave), not the TAKATAK logo. When official
// MIMT files arrive, replace the SVG in markSvg() or drop the PNGs into apps/mobile/assets/ directly:
// app.config.ts only points at the file names below.
//
// Colours: docs/BRAND.md (electric blue #1F8BFF and cyan #29C3FF on navy #060D1F).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, "..", "assets");
const sources = join(assets, "brand");

const NAVY = "#060D1F";
const MIDNIGHT = "#0B1B3D";
const ELECTRIC = "#1F8BFF";
const CYAN = "#29C3FF";
const WHITE = "#F5F8FC";

/**
 * The mark, drawn in a 1024 box: an "M" in one thick rounded stroke and two call-wave arcs
 * at its upper right. `scale` shrinks it around the centre (Android adaptive icons must keep
 * the art inside the central 66 % circle). `mono` paints everything in one colour.
 */
function mark({ scale = 1, mono = null, id = "m" } = {}) {
  const stroke = mono ?? `url(#${id}-grad)`;
  const wave = mono ?? CYAN;
  const defs = mono
    ? ""
    : `<defs>
    <linearGradient id="${id}-grad" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="${ELECTRIC}"/>
      <stop offset="1" stop-color="${CYAN}"/>
    </linearGradient>
    <filter id="${id}-glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="18" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>`;
  const filter = mono ? "" : ` filter="url(#${id}-glow)"`;
  return `${defs}
  <g transform="translate(512 512) scale(${scale}) translate(-600 -452)"${filter}>
    <path d="M262 742 V322 L512 592 L762 322 V742" fill="none" stroke="${stroke}" stroke-width="112"
      stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M806 196 A120 120 0 0 1 906 296" fill="none" stroke="${wave}" stroke-width="44" stroke-linecap="round"/>
    <path d="M800 92 A224 224 0 0 1 1010 302" fill="none" stroke="${wave}" stroke-width="44" stroke-linecap="round"
      opacity="${mono ? 1 : 0.7}"/>
  </g>`;
}

const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>\n`;

const ground = (id, w = 1024, h = 1024) => `<defs>
    <radialGradient id="${id}-bg" cx="50%" cy="46%" r="70%">
      <stop offset="0" stop-color="${MIDNIGHT}"/>
      <stop offset="1" stop-color="${NAVY}"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#${id}-bg)"/>`;

const files = {
  // iOS + Android legacy icon: full bleed, opaque (App Store rejects transparency).
  "icon.png": { w: 1024, h: 1024, transparent: false, body: ground("i") + mark({ scale: 0.78, id: "i" }) },
  // Android adaptive foreground: transparent, art inside the 66 % safe zone; background colour is navy.
  "adaptive-icon.png": { w: 1024, h: 1024, transparent: true, body: mark({ scale: 0.58, id: "a" }) },
  // Android 13+ themed icon: one colour on transparent.
  "adaptive-icon-monochrome.png": { w: 1024, h: 1024, transparent: true, body: mark({ scale: 0.58, mono: WHITE }) },
  // Splash image (expo-splash-screen centres it on navy).
  "splash-icon.png": { w: 1024, h: 1024, transparent: true, body: mark({ scale: 0.9, id: "s" }) },
  // Android status-bar notification icon: white silhouette on transparent.
  "notification-icon.png": { w: 96, h: 96, transparent: true, body: `<g transform="scale(0.09375)">${mark({ scale: 0.86, mono: "#FFFFFF" })}</g>` },
  // Google Play listing icon (512 x 512).
  "brand/play-icon-512.png": {
    w: 512,
    h: 512,
    transparent: false,
    body: `<g transform="scale(0.5)">${ground("p")}${mark({ scale: 0.78, id: "p" })}</g>`,
  },
  // Google Play feature graphic (1024 x 500, required for the store listing). French first.
  "brand/play-feature-graphic.png": {
    w: 1024,
    h: 500,
    transparent: false,
    body: `${ground("f", 1024, 500)}
  <g transform="translate(40 -10) scale(0.5)">${mark({ scale: 0.8, id: "f" })}</g>
  <text x="560" y="230" font-family="Montserrat, 'DejaVu Sans', Arial, sans-serif" font-weight="800" font-size="120"
    fill="${WHITE}" letter-spacing="6">MIMT</text>
  <text x="564" y="300" font-family="Montserrat, 'DejaVu Sans', Arial, sans-serif" font-weight="600" font-size="30"
    fill="${CYAN}">Votre numéro canadien</text>
  <text x="564" y="342" font-family="Montserrat, 'DejaVu Sans', Arial, sans-serif" font-weight="600" font-size="30"
    fill="${CYAN}">dans une app</text>`,
  },
};

// Playwright is a dependency of the e2e package; reuse it instead of adding an image library here.
const require = createRequire(join(here, "..", "..", "..", "e2e", "package.json"));
const { chromium } = require("playwright");

// Montserrat (OFL) is self-hosted by the website; embed it so the feature graphic matches the brand type.
const montserrat = (await readFile(join(here, "..", "..", "web", "fonts", "montserrat-latin-wght-normal.woff2"))).toString("base64");
const fontCss = `@font-face{font-family:Montserrat;font-weight:100 900;src:url(data:font/woff2;base64,${montserrat}) format("woff2")}`;

await mkdir(sources, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [name, f] of Object.entries(files)) {
    const source = svg(f.w, f.h, f.body);
    await writeFile(join(sources, name.replace(/^brand\//, "").replace(/\.png$/, ".svg")), source);
    await page.setViewportSize({ width: f.w, height: f.h });
    await page.setContent(
      `<!doctype html><html><head><style>${fontCss}</style></head><body style="margin:0;background:transparent">${source}</body></html>`,
    );
    await page.evaluate(() => document.fonts.ready);
    const out = join(assets, name);
    await mkdir(dirname(out), { recursive: true });
    await page.locator("svg").screenshot({ path: out, omitBackground: f.transparent });
    console.log(`wrote ${name} (${f.w}x${f.h}${f.transparent ? ", transparent" : ""})`);
  }
} finally {
  await browser.close();
}
