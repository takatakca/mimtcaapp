// « Guides » (lib/guides.ts, lib/guides-more.ts): enough original articles, long enough, in both languages, each one
// listed in llms.txt, with search-friendly metadata and official sources.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GUIDES, guidePath, guideWordCount } from "../lib/guides.ts";
import { llmsTxt } from "../lib/llms.ts";
import { SITE_URL } from "../lib/site.ts";

const LANGS = ["fr", "en"] as const;

test("at least 10 guides, each at least 800 words in French and in English", () => {
  assert.ok(GUIDES.length >= 10, `${GUIDES.length} guides`);
  for (const g of GUIDES) for (const lang of LANGS) assert.ok(guideWordCount(g, lang) >= 800, `${g.id}/${lang}: ${guideWordCount(g, lang)} words`);
});

test("guide ids, slugs and titles are unique; paths live under /guides/ and /en/guides/", () => {
  const ids = GUIDES.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const lang of LANGS) {
    const paths = GUIDES.map((g) => guidePath(g, lang));
    assert.equal(new Set(paths).size, paths.length);
    const titles = GUIDES.map((g) => g.copy(lang).title);
    assert.equal(new Set(titles).size, titles.length);
    for (const p of paths) assert.match(p, lang === "fr" ? /^\/guides\/[a-z0-9-]+\/$/ : /^\/en\/guides\/[a-z0-9-]+\/$/);
  }
});

test("guide metadata fits search results, and every guide cites at least one official source", () => {
  for (const g of GUIDES) {
    for (const lang of LANGS) {
      const c = g.copy(lang);
      assert.ok(`${c.title} | MIMT`.length <= 60, `${g.id}/${lang} title ${c.title.length}`);
      assert.ok(c.description.length >= 50 && c.description.length <= 170, `${g.id}/${lang} description ${c.description.length}`);
      assert.ok(c.sources.length >= 1, g.id);
      for (const s of c.sources) assert.match(s.url, /^https:\/\//, `${g.id}: ${s.url}`);
    }
  }
});

test("every guide is in llms.txt, in French and English", () => {
  const txt = llmsTxt();
  for (const g of GUIDES) for (const lang of LANGS) assert.ok(txt.includes(SITE_URL + guidePath(g, lang)), `${g.id}/${lang}`);
});

test("guides name no competitor and use no false urgency", () => {
  for (const g of GUIDES) {
    for (const lang of LANGS) {
      const text = JSON.stringify(g.copy(lang));
      assert.doesNotMatch(text, /textnow|fongo|\bfizz\b|magicjack|ooma/i, g.id);
      assert.doesNotMatch(text, /plus que \d|dernière chance|compte à rebours|offre se termine|places limitées|only \d+ left|last chance|countdown|hurry|le plus populaire|most popular/i, g.id);
    }
  }
});
