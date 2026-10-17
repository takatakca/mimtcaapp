"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/Visuals";
import { nearestSlide, scrollLeftFor, shownSlides, wrapIndex, type TrackGeometry } from "@/lib/carousel";

export interface Slide {
  icon: IconName;
  title: string;
  text: string;
  link?: { href: string; label: string };
  tone?: "blue" | "cyan" | "deep";
}

const AUTOPLAY_MS = 5000;

/**
 * Accessible feature carousel: native scroll-snap (swipe and trackpad), previous/next buttons,
 * dots, arrow keys, autoplay that pauses on hover, on focus, with the pause button, when the tab is
 * hidden and never runs under prefers-reduced-motion (WCAG 2.2.2).
 */
export function FeatureCarousel({ lang, label, slides }: { lang: Lang; label: string; slides: Slide[] }) {
  const fr = lang === "fr";
  const track = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);
  // Slides at least half on screen. Before hydration (and without JavaScript) every slide is shown.
  const [shown, setShown] = useState<boolean[]>(() => slides.map(() => true));
  const [playing, setPlaying] = useState(true);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [reduce, setReduce] = useState(true);
  // Slide picked with a dot, an arrow or autoplay. It stays the active one while the track scrolls
  // to it: when several slides fit on screen, the last ones share the same end-of-track position.
  const requested = useRef<number | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    if (mq.matches) setPlaying(false);
  }, []);

  const goTo = useCallback(
    (i: number) => {
      const el = track.current;
      if (!el) return;
      const target = wrapIndex(i, slides.length);
      requested.current = target;
      setIndex(target);
      el.scrollTo({ left: scrollLeftFor(target, geometry(el)), behavior: reduce ? "auto" : "smooth" });
    },
    [slides.length, reduce],
  );

  // Follow free scrolling (swipe, trackpad, wheel); keep the requested slide otherwise.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const g = geometry(el);
        setShown((prev) => {
          const next = shownSlides(g);
          return next.length === prev.length && next.every((v, i) => v === prev[i]) ? prev : next;
        });
        if (requested.current === null) setIndex(nearestSlide(g));
      });
    };
    const release = () => {
      requested.current = null;
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("pointerdown", release, { passive: true });
    el.addEventListener("touchstart", release, { passive: true });
    el.addEventListener("wheel", release, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      el.removeEventListener("pointerdown", release);
      el.removeEventListener("touchstart", release);
      el.removeEventListener("wheel", release);
      window.removeEventListener("resize", update);
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    if (!playing || hover || focus || reduce) return;
    const t = window.setInterval(() => {
      if (document.hidden) return;
      goTo(index + 1);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(t);
  }, [playing, hover, focus, reduce, index, goTo]);

  const auto = playing && !reduce;

  return (
    <section
      className="carousel"
      aria-roledescription={fr ? "carrousel" : "carousel"}
      aria-label={label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          goTo(index + 1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          goTo(index - 1);
        }
      }}
    >
      <div className="carousel__controls">
        {!reduce ? (
          <button type="button" className="carousel__btn carousel__btn--play" onClick={() => setPlaying((p) => !p)} aria-pressed={!playing}>
            <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
            <span className="sr-only">{playing ? (fr ? "Arrêter le défilement automatique" : "Stop automatic rotation") : fr ? "Reprendre le défilement automatique" : "Resume automatic rotation"}</span>
          </button>
        ) : null}
        <button type="button" className="carousel__btn" onClick={() => goTo(index - 1)} aria-label={fr ? "Fonction précédente" : "Previous feature"}>
          <span aria-hidden="true">←</span>
        </button>
        <button type="button" className="carousel__btn" onClick={() => goTo(index + 1)} aria-label={fr ? "Fonction suivante" : "Next feature"}>
          <span aria-hidden="true">→</span>
        </button>
      </div>

      <ul className="carousel__track" ref={track} aria-live={auto ? "off" : "polite"} tabIndex={0} aria-label={fr ? "Fonctions, faites défiler" : "Features, scroll"}>
        {slides.map((s, i) => (
          <li
            key={s.title}
            className={`carousel__slide carousel__slide--${s.tone ?? "blue"}${i === index ? " is-active" : ""}`}
            role="group"
            aria-roledescription={fr ? "diapositive" : "slide"}
            aria-label={`${i + 1} ${fr ? "sur" : "of"} ${slides.length} : ${s.title}`}
            // Off-screen slides: Tab skips their links (reach them with the arrows or the dots).
            inert={shown[i] === false ? true : undefined}
          >
            <span className="carousel__icon">
              <Icon name={s.icon} />
            </span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
            {s.link ? (
              <a className="carousel__link" href={s.link.href}>
                {s.link.label} <span aria-hidden="true">→</span>
              </a>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="carousel__dots">
        {slides.map((s, i) => (
          <button
            key={s.title}
            type="button"
            className={`carousel__dot${i === index ? " is-active" : ""}`}
            aria-label={`${fr ? "Aller à" : "Go to"} ${s.title}`}
            aria-current={i === index ? "true" : undefined}
            onClick={() => goTo(i)}
          />
        ))}
      </div>
    </section>
  );
}

type Lang = "fr" | "en";

/** Slide positions relative to the start of the track. */
function geometry(el: HTMLElement): TrackGeometry {
  const items = [...el.children] as HTMLElement[];
  return {
    lefts: items.map((it) => it.offsetLeft - el.offsetLeft),
    widths: items.map((it) => it.offsetWidth),
    scrollLeft: el.scrollLeft,
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth,
  };
}
