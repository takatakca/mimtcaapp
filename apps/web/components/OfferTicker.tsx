"use client";

import { useEffect, useState } from "react";
import { tickerOffers } from "@/lib/growth";
import type { Lang } from "@/lib/site";

/** Top banner that cycles through the real offers. Pauses on hover or focus; still with reduced motion. */
export function OfferTicker({ lang }: { lang: Lang }) {
  const offers = tickerOffers(lang);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || offers.length < 2) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % offers.length), 5000);
    return () => window.clearInterval(t);
  }, [paused, offers.length]);

  const o = offers[i % offers.length]!;
  const fr = lang === "fr";
  return (
    <div
      className="offer-banner offer-ticker"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <p key={i} className="offer-ticker__item" aria-live="polite">
        <strong>{o.strong}</strong> {o.text} <a href={o.href}>{fr ? "En profiter" : "Get it"}</a>
      </p>
      {offers.length > 1 ? (
        <button
          type="button"
          className="offer-ticker__next"
          onClick={() => setI((n) => (n + 1) % offers.length)}
          aria-label={fr ? `Offre suivante (${i + 1} sur ${offers.length})` : `Next offer (${i + 1} of ${offers.length})`}
        >
          <span aria-hidden="true">
            {i + 1}/{offers.length} ›
          </span>
        </button>
      ) : null}
    </div>
  );
}
