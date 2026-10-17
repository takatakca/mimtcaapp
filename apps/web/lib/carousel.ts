// Pure geometry for components/FeatureCarousel.tsx (tested in test/carousel.test.ts).
// Positions are in px, relative to the start of the scrolling track.

export interface TrackGeometry {
  /** Left edge of each slide. */
  lefts: number[];
  /** Width of each slide. */
  widths: number[];
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

/** i modulo n, always in [0, n). */
export function wrapIndex(i: number, n: number): number {
  return n > 0 ? ((i % n) + n) % n : 0;
}

/** Largest scrollLeft the track allows. */
export function maxScroll(g: Pick<TrackGeometry, "scrollWidth" | "clientWidth">): number {
  return Math.max(0, g.scrollWidth - g.clientWidth);
}

/**
 * Where to scroll so slide i is shown, clamped to the track. When several slides fit on screen, the
 * last ones all map to the end of the track: that is why the component keeps the requested slide as
 * the active one instead of guessing it back from the scroll position.
 */
export function scrollLeftFor(i: number, g: TrackGeometry): number {
  const left = g.lefts[wrapIndex(i, g.lefts.length)] ?? 0;
  return Math.min(Math.max(0, left), maxScroll(g));
}

/**
 * Active slide after a free scroll (swipe, trackpad): the one closest to the left edge, or the last
 * one once the track is scrolled to its very end. Not used after a dot or arrow request.
 */
export function nearestSlide(g: TrackGeometry): number {
  if (g.lefts.length === 0) return 0;
  if (g.scrollLeft >= maxScroll(g) - 4 && maxScroll(g) > 0) return g.lefts.length - 1;
  let best = 0;
  let dist = Infinity;
  g.lefts.forEach((left, i) => {
    const d = Math.abs(left - g.scrollLeft);
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return best;
}

/**
 * Which slides are on screen: at least half of the slide inside the visible part of the track.
 * The others are made inert, so Tab skips their links and screen readers skip their text.
 */
export function shownSlides(g: TrackGeometry, scrollLeft = g.scrollLeft): boolean[] {
  const start = scrollLeft;
  const end = scrollLeft + g.clientWidth;
  return g.lefts.map((left, i) => {
    const width = g.widths[i] ?? 0;
    if (width <= 0) return false;
    const inside = Math.min(end, left + width) - Math.max(start, left);
    return inside >= width / 2;
  });
}
