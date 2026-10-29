"use client";

import { useEffect } from "react";
import { captureAffiliateTouch, readAffiliateTouch, withAffiliateParam } from "@/lib/affiliate-link";
import { APP_URL } from "@/lib/site";

/**
 * Small progressive enhancements, all in one place (≈1 kB): shrinking sticky header, scroll reveal,
 * counters, button ripple, card tilt and Escape for the mobile menu. Without JavaScript, or with prefers-reduced-motion,
 * everything is visible and still.
 */
export function SiteEffects() {
  useEffect(() => {
    const root = document.documentElement;
    // Affiliate link (?aff=CODE): first touch kept for the number picker and the web app (lib/affiliate-link.ts).
    const store = () => window.localStorage;
    captureAffiliateTouch(window.location.search, store);
    const onAppLink = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (a && a.href.startsWith(APP_URL)) a.href = withAffiliateParam(a.href, readAffiliateTouch(store));
    };
    document.addEventListener("click", onAppLink, true);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Header shrinks once the page scrolls; a thin bar at the top shows how far down the page you are.
    const onScroll = () => {
      root.toggleAttribute("data-scrolled", window.scrollY > 16);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      root.style.setProperty("--scroll", max > 0 ? (window.scrollY / max).toFixed(4) : "0");
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    // Scroll reveal + counters.
    const reveal = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
    const counters = [...document.querySelectorAll<HTMLElement>("[data-count]")];
    let io: IntersectionObserver | undefined;
    if (reduce || !("IntersectionObserver" in window)) {
      reveal.forEach((el) => el.classList.add("is-visible"));
    } else {
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            const el = e.target as HTMLElement;
            io?.unobserve(el);
            if (el.hasAttribute("data-count")) countUp(el);
            else el.classList.add("is-visible");
          }
        },
        { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
      );
      reveal.forEach((el) => io!.observe(el));
      counters.forEach((el) => io!.observe(el));
    }

    // Ripple on buttons (pointer only; keyboard users get the focus ring).
    const onDown = (e: PointerEvent) => {
      if (reduce) return;
      const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>(".btn");
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const dot = document.createElement("span");
      dot.className = "ripple";
      dot.style.left = `${e.clientX - r.left}px`;
      dot.style.top = `${e.clientY - r.top}px`;
      btn.appendChild(dot);
      window.setTimeout(() => dot.remove(), 650);
    };
    document.addEventListener("pointerdown", onDown);

    // Spotlight: cards light up where the pointer is (mouse only; CSS reads --mx / --my).
    const fine = window.matchMedia("(pointer: fine)").matches;
    const spots = reduce || !fine ? [] : [...document.querySelectorAll<HTMLElement>(".plan, .card.feature, .offer, .biz-card, .aidemo__pick, .faq details")];
    const spot = (e: PointerEvent) => {
      const el = e.currentTarget as HTMLElement;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    spots.forEach((el) => {
      el.classList.add("spot");
      el.addEventListener("pointermove", spot);
    });

    // Gentle 3D tilt on cards marked data-tilt (mouse only).
    const tilts = reduce || !fine ? [] : [...document.querySelectorAll<HTMLElement>("[data-tilt]")];
    const move = (e: PointerEvent) => {
      const el = e.currentTarget as HTMLElement;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      el.style.setProperty("--ry", `${(x * 6).toFixed(2)}deg`);
      el.style.setProperty("--rx", `${(-y * 6).toFixed(2)}deg`);
    };
    const leave = (e: PointerEvent) => {
      const el = e.currentTarget as HTMLElement;
      el.style.removeProperty("--rx");
      el.style.removeProperty("--ry");
    };
    tilts.forEach((el) => {
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerleave", leave);
    });

    // Mobile menu (<details class="nav-mobile">): Escape closes it and returns focus to its toggle.
    // An open modal (download prompt) handles Escape itself and keeps priority.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const menu = document.querySelector<HTMLDetailsElement>("details.nav-mobile[open]");
      if (!menu) return;
      e.preventDefault();
      menu.open = false;
      menu.querySelector<HTMLElement>("summary")?.focus();
    };
    document.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onAppLink, true);
      document.removeEventListener("pointerdown", onDown);
      io?.disconnect();
      spots.forEach((el) => el.removeEventListener("pointermove", spot));
      tilts.forEach((el) => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerleave", leave);
      });
    };
  }, []);
  return null;
}

/** Counts from 0 to the number already rendered in the element (so the static HTML stays correct). */
function countUp(el: HTMLElement) {
  const target = Number(el.dataset.count);
  if (!Number.isFinite(target) || target <= 0) return;
  const fmt = new Intl.NumberFormat(document.documentElement.lang || "fr-CA");
  const start = performance.now();
  const dur = 1200;
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt.format(Math.round(target * eased));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
