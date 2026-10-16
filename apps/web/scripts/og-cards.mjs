// Generates the Open Graph / Twitter cards (1200×630 PNG) in public/og/ from original HTML/CSS artwork.
// Run after a build (it reuses the self-hosted fonts from out/):
//   pnpm --filter @mimt/web build && node apps/web/scripts/og-cards.mjs
// Uses the Chromium that the e2e package's Playwright already has (never runs `playwright install`).
// The PNGs are committed, so CI and the FTP deploy never need a browser.
import { createServer } from "node:http";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const out = join(web, "out");
const dest = join(web, "public", "og");
const require = createRequire(join(web, "..", "..", "e2e", "package.json"));
const { chromium } = require("@playwright/test");

if (!existsSync(join(out, "index.html"))) {
  console.error("og-cards: build the site first (out/index.html is missing).");
  process.exit(1);
}
const index = readFileSync(join(out, "index.html"), "utf8");
const htmlClass = (index.match(/<html[^>]*class="([^"]*)"/) ?? [])[1] ?? "";
const links = (index.match(/<link rel="stylesheet"[^>]*>/g) ?? []).join("\n");

// Keys and languages must match OG_PAGES in lib/site.ts.
const CARDS = {
  home: {
    fr: ["Votre numéro.", "Partout.", "Un numéro canadien dans une app : appels et textos par Wi‑Fi, sur cellulaire et ordinateur."],
    en: ["Your number.", "Anywhere.", "A Canadian number in an app: calls and texts over Wi‑Fi, on your phone and computer."],
  },
  plans: {
    fr: ["Forfaits clairs.", "Dès 0 $.", "Gratuit, Verrouillage du numéro, Premium et Affaires. Toutes les limites affichées."],
    en: ["Clear plans.", "From $0.", "Free, Number Lock, Premium and Business. Every limit shown up front."],
  },
  business: {
    fr: ["Téléphonie d'affaires.", "Sans matériel.", "Postes, accueil bilingue, réceptionniste IA, fériés du Québec. Prix par ligne."],
    en: ["Business phone.", "No hardware.", "Extensions, bilingual greeting, AI receptionist, Québec holidays. Per-line pricing."],
  },
  ai: {
    fr: ["Une IA utile.", "Avec votre accord.", "Résumés vocaux, réponses suggérées, « Spam probable », réceptionniste IA."],
    en: ["Useful AI.", "With your consent.", "Voicemail summaries, suggested replies, “Likely spam”, AI receptionist."],
  },
  webapp: {
    fr: ["Votre numéro,", "sur l'ordinateur.", "app.mimt.ca : appels, textos et messagerie vocale dans le navigateur."],
    en: ["Your number,", "on your computer.", "app.mimt.ca: calls, texts and voicemail in your browser."],
  },
  compare: {
    fr: ["Comparez.", "Honnêtement.", "Ce que MIMT fait autrement, et ce qu'il ne fait pas encore."],
    en: ["Compare.", "Honestly.", "What MIMT does differently, and what it doesn't do yet."],
  },
  soon: {
    fr: ["Internet et cellulaire.", "Bientôt.", "En préparation, sans date ni prix annoncés. Inscrivez-vous pour être avisé."],
    en: ["Internet and mobile.", "Coming soon.", "In preparation, no date or price announced. Sign up to be notified."],
  },
  help: {
    fr: ["Des questions?", "Réponses courtes.", "MIMT Mobile, MIMT Affaires, IA, prix, 9-1-1, confidentialité."],
    en: ["Questions?", "Short answers.", "MIMT Mobile, MIMT Business, AI, pricing, 9-1-1, privacy."],
  },
};

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function card(lang, [a, b, sub]) {
  const fr = lang === "fr";
  return `<!doctype html><html lang="${fr ? "fr-CA" : "en-CA"}" class="${htmlClass}"><head><meta charset="utf-8">${links}
<style>
  html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#060D1F}
  .c{position:relative;width:1200px;height:630px;overflow:hidden;color:#F5F8FC;font-family:var(--font-body),sans-serif;
     background:radial-gradient(520px 380px at 12% 18%,rgba(31,139,255,.55),transparent 70%),
                radial-gradient(420px 320px at 92% 10%,rgba(41,195,255,.35),transparent 70%),
                radial-gradient(560px 420px at 78% 110%,rgba(21,101,216,.6),transparent 70%),#060D1F}
  .dots{position:absolute;inset:0;background-image:radial-gradient(rgba(184,196,211,.18) 1.2px,transparent 1.4px);background-size:28px 28px;
     -webkit-mask-image:radial-gradient(60% 70% at 30% 40%,#000 20%,transparent 80%)}
  .brand{position:absolute;left:80px;top:62px;display:flex;align-items:baseline;gap:16px}
  .brand b{font-family:var(--font-heading),sans-serif;font-weight:800;font-size:44px;letter-spacing:.06em;
     background:linear-gradient(90deg,#F5F8FC 55%,#29C3FF);-webkit-background-clip:text;color:transparent}
  .brand span{font-size:15px;font-weight:600;letter-spacing:.22em;color:#B8C4D3;text-transform:uppercase}
  .txt{position:absolute;left:80px;top:150px;width:700px;height:340px;display:flex;flex-direction:column;justify-content:center;gap:22px}
  h1{margin:0;font-family:var(--font-heading),sans-serif;font-weight:800;line-height:1.04;letter-spacing:-.02em}
  h1 em{font-style:normal;background:linear-gradient(90deg,#29C3FF,#1F8BFF 60%,#8fd8ff);-webkit-background-clip:text;color:transparent}
  p{margin:0;width:660px;font-size:26px;line-height:1.4;color:#D6DFEB}
  .foot{position:absolute;left:80px;bottom:56px;display:flex;gap:14px;align-items:center;font-size:20px;font-weight:600}
  .foot i{font-style:normal;padding:8px 16px;border-radius:999px;border:1.5px solid rgba(41,195,255,.5);color:#9fd6ff;background:rgba(31,139,255,.15)}
  .foot s{text-decoration:none;color:#B8C4D3}
  .phone{position:absolute;right:96px;top:84px;width:250px;height:470px;border-radius:44px;background:#0B1B3D;border:3px solid #29C3FF;
     box-shadow:0 0 90px rgba(31,139,255,.55),0 40px 80px rgba(0,0,0,.5);transform:rotate(6deg)}
  .screen{position:absolute;inset:14px;border-radius:32px;background:linear-gradient(#0E2350,#071330)}
  .bub{position:absolute;height:40px;border-radius:16px}
  .b1{left:16px;top:60px;width:150px;background:#1A3466}
  .b2{right:16px;top:114px;width:160px;background:linear-gradient(90deg,#1F8BFF,#1565D8)}
  .b3{left:16px;top:168px;width:110px;background:#1A3466}
  .call{position:absolute;left:16px;right:16px;bottom:22px;height:150px;border-radius:22px;background:#13306A;border:1px solid rgba(41,195,255,.35)}
  .ring{position:absolute;left:50%;top:26px;width:58px;height:58px;margin-left:-29px;border-radius:50%;background:#1565D8;box-shadow:0 0 0 10px rgba(41,195,255,.18),0 0 0 22px rgba(41,195,255,.08)}
  .wave{position:absolute;left:30px;right:30px;bottom:24px;height:26px;background:repeating-linear-gradient(90deg,#29C3FF 0 5px,transparent 5px 11px);
     -webkit-mask-image:linear-gradient(90deg,transparent,#000 20%,#000 80%,transparent)}
  .sky{position:absolute;left:0;right:0;bottom:0;height:60px;background:#0B1B3D;
     clip-path:polygon(0 70%,4% 70%,4% 40%,8% 40%,8% 60%,12% 60%,12% 20%,15% 20%,15% 55%,20% 55%,20% 35%,24% 35%,24% 65%,30% 65%,30% 10%,33% 10%,33% 50%,38% 50%,38% 30%,43% 30%,43% 60%,50% 60%,50% 25%,54% 25%,54% 45%,60% 45%,60% 15%,63% 15%,63% 55%,70% 55%,70% 35%,75% 35%,75% 60%,82% 60%,82% 20%,86% 20%,86% 50%,92% 50%,92% 30%,96% 30%,96% 65%,100% 65%,100% 100%,0 100%)}
</style></head><body><div class="c"><div class="dots"></div><div class="sky"></div>
<div class="brand"><b>MIMT</b><span>${fr ? "par GROUPE TAKATAK" : "by GROUPE TAKATAK"}</span></div>
<div class="txt"><h1 style="font-size:${Math.max(a.length, b.length) > 17 ? 60 : 76}px">${esc(a)}<br><em>${esc(b)}</em></h1>
<p>${esc(sub)}</p></div>
<div class="foot"><i>${fr ? "Fait au Québec · Français d'abord" : "Made in Québec · French first"}</i><s>mimt.ca</s></div>
<div class="phone"><div class="screen"><div class="bub b1"></div><div class="bub b2"></div><div class="bub b3"></div>
<div class="call"><div class="ring"></div><div class="wave"></div></div></div></div>
</div></body></html>`;
}

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".woff2": "font/woff2", ".js": "text/javascript" };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  const file = join(out, path);
  if (!file.startsWith(out) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

mkdirSync(dest, { recursive: true });
mkdirSync(join(out, "og"), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
try {
  for (const [key, langs] of Object.entries(CARDS)) {
    for (const [lang, copy] of Object.entries(langs)) {
      const tmp = join(out, "__og-card.html");
      writeFileSync(tmp, card(lang, copy));
      await page.goto(`http://127.0.0.1:${port}/__og-card.html`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const file = join(dest, `${key}-${lang}.png`);
      await page.screenshot({ path: file, type: "png" });
      copyFileSync(file, join(out, "og", `${key}-${lang}.png`));
      rmSync(tmp);
      console.log(`og-cards: ${key}-${lang}.png`);
    }
  }
} finally {
  await browser.close();
  server.close();
}
