"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { LeadForm } from "@/components/LeadForm";
import { StoreBadges } from "@/components/Visuals";
import {
  DESKTOP_DELAY_MS,
  alreadyPrompted,
  isExitIntent,
  markPrompted,
  promptModeFor,
  scrolledEnough,
  type StoreGetter,
} from "@/lib/download-prompt";
import { APP_URL, type Lang } from "@/lib/site";

const store: StoreGetter = () => window.localStorage;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), select, textarea, [tabindex="0"]';

/**
 * "Télécharger maintenant": a modal opened by any element with data-download, plus at most one
 * automatic prompt per visitor (rules and tests in lib/download-prompt.ts).
 */
export function DownloadPrompt({ lang, auto = true }: { lang: Lang; auto?: boolean }) {
  const fr = lang === "fr";
  const titleId = useId();
  const sheetTitleId = useId();
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const show = useCallback((from?: HTMLElement | null) => {
    opener.current = from ?? (document.activeElement as HTMLElement | null);
    markPrompted(store);
    setSheet(false);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    opener.current?.focus?.();
  }, []);

  // Every CTA marked data-download opens the modal (its href stays as a no-JS fallback).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-download]");
      if (!el) return;
      e.preventDefault();
      show(el);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [show]);

  // Automatic prompt: once per visitor; desktop modal after 25 s or exit intent, mobile bottom sheet after 50 % scroll.
  useEffect(() => {
    if (!auto || alreadyPrompted(store)) return;
    const mode = promptModeFor(window.innerWidth, window.matchMedia("(pointer: fine)").matches);
    let done = false;
    const fire = () => {
      if (done || alreadyPrompted(store)) return;
      done = true;
      cleanup();
      if (mode === "modal") show(null);
      else {
        markPrompted(store);
        setSheet(true);
      }
    };
    const onLeave = (e: MouseEvent) => {
      if (isExitIntent(e)) fire();
    };
    const onScroll = () => {
      if (scrolledEnough(window.scrollY, window.innerHeight, document.documentElement.scrollHeight)) fire();
    };
    let timer: number | undefined;
    if (mode === "modal") {
      timer = window.setTimeout(fire, DESKTOP_DELAY_MS);
      document.documentElement.addEventListener("mouseout", onLeave);
    } else {
      window.addEventListener("scroll", onScroll, { passive: true });
    }
    function cleanup() {
      if (timer) window.clearTimeout(timer);
      document.documentElement.removeEventListener("mouseout", onLeave);
      window.removeEventListener("scroll", onScroll);
    }
    return cleanup;
  }, [auto, show]);

  // Modal behaviour: focus inside, Esc closes, Tab stays inside, page behind does not scroll.
  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    const first = node?.querySelector<HTMLElement>(".dl-modal__close");
    first?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      const a = items[0];
      const z = items[items.length - 1];
      if (!a || !z) return;
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, close]);

  return (
    <>
      {sheet && !open ? (
        <div className="dl-sheet" role="dialog" aria-modal="false" aria-labelledby={sheetTitleId}>
          <p className="dl-sheet__title" id={sheetTitleId}>
            {fr ? "Utilisez MIMT dans votre navigateur" : "Use MIMT in your browser"}
          </p>
          <div className="dl-sheet__actions">
            <a className="btn btn--primary btn--sm" href={APP_URL} rel="noopener">
              {fr ? "Ouvrir l'app Web" : "Open the web app"}
            </a>
            <button type="button" className="btn btn--ghost btn--sm" onClick={(e) => show(e.currentTarget)}>
              {fr ? "Options" : "Options"}
            </button>
          </div>
          <button type="button" className="dl-sheet__close" onClick={() => setSheet(false)} aria-label={fr ? "Fermer" : "Close"}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ) : null}

      {open ? (
        <div className="dl-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div className="dl-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}>
            <button type="button" className="dl-modal__close" onClick={close} aria-label={fr ? "Fermer" : "Close"}>
              <span aria-hidden="true">×</span>
            </button>
            <p className="dl-modal__kicker">{fr ? "Télécharger maintenant" : "Download now"}</p>
            <h2 id={titleId} className="dl-modal__title">
              {fr ? "Utilisez MIMT tout de suite dans votre navigateur" : "Use MIMT right now in your browser"}
            </h2>
            <p className="dl-modal__lead">
              {fr
                ? "L'app Web fonctionne sur ordinateur, iPhone et Android, et s'installe comme une vraie app, sans magasin d'applications."
                : "The web app works on computer, iPhone and Android, and installs like a real app, no app store needed."}
            </p>
            <a className="btn btn--primary btn--lg dl-modal__cta" href={APP_URL} rel="noopener">
              {fr ? "Ouvrir app.mimt.ca" : "Open app.mimt.ca"}
            </a>

            <div className="dl-install">
              <div>
                <h3>iPhone</h3>
                <p>
                  {fr ? (
                    <>
                      Dans Safari, touchez <strong>Partager</strong> puis <strong>{"«\u00a0Sur l'écran d'accueil\u00a0»"}</strong>.
                    </>
                  ) : (
                    <>
                      In Safari, tap <strong>Share</strong> then <strong>“Add to Home Screen”</strong>.
                    </>
                  )}
                </p>
              </div>
              <div>
                <h3>Android</h3>
                <p>
                  {fr ? (
                    <>
                      Dans Chrome, ouvrez le menu&nbsp;<strong>⋮</strong> puis <strong>{"«\u00a0Installer l'application\u00a0»"}</strong>.
                    </>
                  ) : (
                    <>
                      In Chrome, open the <strong>⋮</strong> menu then <strong>“Install app”</strong>.
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="dl-stores">
              <p className="dl-stores__label">{fr ? "Applications mobiles : bientôt" : "Mobile apps: coming soon"}</p>
              <StoreBadges lang={lang} />
            </div>

            <div className="dl-waitlist">
              <h3>{fr ? "Inscrivez-vous pour l'accès anticipé" : "Sign up for early access"}</h3>
              <p className="dl-waitlist__lead">
                {fr
                  ? "Les appels et textos ouvrent au lancement. Laissez votre courriel : on vous écrit dès que c'est prêt."
                  : "Calls and texts open at launch. Leave your email: we'll write as soon as it's ready."}
              </p>
              <LeadForm kind="waitlist" lang={lang} submitLabel={fr ? "M'inscrire" : "Sign me up"} defaults={{ interest: "mobile" }} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
