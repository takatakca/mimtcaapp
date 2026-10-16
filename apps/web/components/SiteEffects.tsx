"use client";

import { useEffect } from "react";

/**
 * Small progressive enhancements, all in one place (≈1 kB): shrinking sticky header, scroll reveal,
 * counters, button ripple and card tilt. Without JavaScript, or with prefers-reduced-motion,
 * everything is visible and still.
 */
export function SiteEffects() {
  useEffect(() => {
    const root = document.documentElement;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Header shrinks once the page scrolls.
    const onScroll = () => root.toggleAttribute("data-scrolled", window.scrollY > 16);
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

    // Gentle 3D tilt on cards marked data-tilt (mouse only).
    const fine = window.matchMedia("(pointer: fine)").matches;
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

    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("pointerdown", onDown);
      io?.disconnect();
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
