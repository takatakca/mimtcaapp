// Feature carousel geometry (lib/carousel.ts): dots select the clicked slide at every viewport, and
// off-screen slides are the ones made inert.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { maxScroll, nearestSlide, scrollLeftFor, shownSlides, wrapIndex, type TrackGeometry } from "../lib/carousel.ts";

/** n slides of equal width with a gap, as laid out by .carousel__track (styles/home.css). */
function track(n: number, clientWidth: number, perView: number, gap: number, scrollLeft = 0): TrackGeometry {
  const width = (clientWidth - gap * (Math.ceil(perView) - 1)) / perView;
  const lefts = Array.from({ length: n }, (_, i) => i * (width + gap));
  return { lefts, widths: lefts.map(() => width), scrollLeft, clientWidth, scrollWidth: lefts[n - 1]! + width };
}

const VIEWPORTS = [
  { name: "1440 px, 3 per view", g: track(9, 1200, 3, 20) },
  { name: "800 px, 2 per view", g: track(9, 720, 2, 16) },
  { name: "390 px, 84% slides", g: track(9, 342, 1 / 0.84, 16) },
];

test("carousel: every dot scrolls so its own slide is on screen, at every viewport", () => {
  for (const { name, g } of VIEWPORTS) {
    for (let i = 0; i < g.lefts.length; i++) {
      const left = scrollLeftFor(i, g);
      assert.ok(left >= 0 && left <= maxScroll(g), `${name}: dot ${i + 1} scrolls inside the track`);
      assert.equal(shownSlides(g, left)[i], true, `${name}: dot ${i + 1} shows slide ${i + 1}`);
    }
  }
});

test("carousel: with 3 slides per view, the last dots share the end of the track (so the component keeps the requested slide)", () => {
  const g = track(9, 1200, 3, 20);
  const end = maxScroll(g);
  assert.equal(scrollLeftFor(6, g), end);
  assert.equal(scrollLeftFor(7, g), end);
  assert.equal(scrollLeftFor(8, g), end);
  // Guessing the active slide back from that position cannot tell dots 7, 8 and 9 apart: the audit bug.
  assert.equal(nearestSlide({ ...g, scrollLeft: end }), 8);
  // The component therefore never derives the active slide from the scroll after a dot click
  // (components/FeatureCarousel.tsx keeps `requested`); this guards that wiring.
  const src = readFileSync(fileURLToPath(new URL("../components/FeatureCarousel.tsx", import.meta.url)), "utf8");
  assert.match(src, /requested\.current = target;\s*setIndex\(target\);/);
  assert.match(src, /if \(requested\.current === null\) setIndex\(nearestSlide\(g\)\)/);
});

test("carousel: free scrolling picks the slide nearest the left edge, the last one at the very end", () => {
  const g = track(9, 1200, 3, 20);
  const step = g.lefts[1]!;
  assert.equal(nearestSlide({ ...g, scrollLeft: 0 }), 0);
  assert.equal(nearestSlide({ ...g, scrollLeft: step * 2 + 10 }), 2);
  assert.equal(nearestSlide({ ...g, scrollLeft: maxScroll(g) }), 8);
  const phone = track(9, 342, 1 / 0.84, 16);
  for (let i = 0; i < 9; i++) assert.equal(nearestSlide({ ...phone, scrollLeft: scrollLeftFor(i, phone) }), i, `390 px: swipe to slide ${i + 1}`);
});

test("carousel: only slides at least half on screen stay focusable", () => {
  const g = track(9, 1200, 3, 20);
  assert.deepEqual(shownSlides(g), [true, true, true, false, false, false, false, false, false]);
  assert.deepEqual(shownSlides(g, maxScroll(g)), [false, false, false, false, false, false, true, true, true]);
  const phone = track(9, 342, 1 / 0.84, 16);
  // The 16% peek of the next slide on phones is not "on screen": its link is skipped by Tab.
  assert.deepEqual(shownSlides(phone).slice(0, 3), [true, false, false]);
  const src = readFileSync(fileURLToPath(new URL("../components/FeatureCarousel.tsx", import.meta.url)), "utf8");
  assert.match(src, /inert=\{shown\[i\] === false \? true : undefined\}/);
});

test("carousel: arrows and autoplay wrap around", () => {
  assert.equal(wrapIndex(9, 9), 0);
  assert.equal(wrapIndex(-1, 9), 8);
  assert.equal(wrapIndex(4, 9), 4);
  assert.equal(wrapIndex(3, 0), 0);
});
