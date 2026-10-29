"use client";

import { useEffect, useId, useState } from "react";
import { ShareButton } from "@/components/ShareButton";
import { href, type Lang } from "@/lib/site";

const NUDGE_KEY = "mimt.ai-nudge.v1";

/**
 * Floating « Parlez à notre IA » button with a small panel of shortcuts. A one-line nudge appears once
 * per browser session after 8 s; it never covers content and closes with Escape.
 */
export function AiLauncher({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [nudge, setNudge] = useState(false);

  useEffect(() => {
    let seen = true;
    try {
      seen = window.sessionStorage.getItem(NUDGE_KEY) !== null;
    } catch {
      /* blocked storage: stay quiet */
    }
    if (seen) return;
    const t = window.setTimeout(() => {
      setNudge(true);
      try {
        window.sessionStorage.setItem(NUDGE_KEY, "1");
      } catch {
        /* ignore */
      }
    }, 8000);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const home = href(lang, "home");
  return (
    <div className="ai-launch">
      {open ? (
        <div className="ai-launch__panel" id={panelId} role="dialog" aria-label={fr ? "Assistant MIMT" : "MIMT assistant"}>
          <p className="ai-launch__hello">
            <span className="ai-launch__status" aria-hidden="true" />
            {fr ? "Bonjour! Je suis l'IA de MIMT. Par où on commence?" : "Hi! I'm the MIMT AI. Where do we start?"}
          </p>
          <ul className="ai-launch__list">
            <li>
              <a href={`${home}#${fr ? "pilote" : "pilot"}`}>{fr ? "Voir l'IA piloter l'app" : "Watch the AI drive the app"}</a>
            </li>
            <li>
              <a href={`${home}#${fr ? "essai-ia" : "try-ai"}`}>{fr ? "Me parler à voix haute (démo)" : "Talk to me out loud (demo)"}</a>
            </li>
            <li>
              <a href={`${home}#numero`}>{fr ? "Choisir mon numéro" : "Pick my number"}</a>
            </li>
            <li>
              <a href={href(lang, "plans")}>{fr ? "Comparer les forfaits" : "Compare plans"}</a>
            </li>
            <li>
              <a href={href(lang, "rewards")}>{fr ? "Missions et points" : "Missions and points"}</a>
            </li>
            <li>
              <a href={href(lang, "help")}>{fr ? "Questions fréquentes" : "Common questions"}</a>
            </li>
          </ul>
          <ShareButton lang={lang} className="btn btn--outline-light btn--sm" />
        </div>
      ) : null}
      {nudge && !open ? (
        <div className="ai-launch__nudge">
          <button type="button" className="ai-launch__nudge-text" onClick={() => setOpen(true)}>
            {fr ? "Est-ce que l'IA peut vous aider? Parlez-moi." : "Can the AI help? Talk to me."}
          </button>
          <button type="button" className="ai-launch__x" aria-label={fr ? "Fermer" : "Close"} onClick={() => setNudge(false)}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className={`ai-launch__orb${open ? " is-open" : ""}`}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? (fr ? "Fermer l'assistant" : "Close the assistant") : fr ? "Parlez à notre IA" : "Talk to our AI"}
        onClick={() => {
          setOpen((v) => !v);
          setNudge(false);
        }}
      >
        <span className="ai-launch__ring" aria-hidden="true" />
        <span className="ai-launch__label" aria-hidden="true">
          {open ? "×" : fr ? "IA" : "AI"}
        </span>
      </button>
    </div>
  );
}
