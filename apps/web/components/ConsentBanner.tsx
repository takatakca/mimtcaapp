"use client";

import { useEffect, useState } from "react";
import { CONSENT_KEY, CONSENT_OPEN_EVENT, applyConsent, type ConsentChoice } from "@/lib/consent";
import { href, type Lang } from "@/lib/site";

/**
 * Law 25 ad-cookie choice. Until the visitor chooses, ads stay non-personalised (lib/root-layout sets the defaults).
 * Accept and Refuse are equally prominent; the footer link reopens it to change one's mind.
 */
export function ConsentBanner({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(CONSENT_KEY);
    } catch {
      // Storage blocked: ask every visit, ads stay non-personalised.
    }
    if (stored !== "granted" && stored !== "denied") setOpen(true);
    const reopen = () => setOpen(true);
    window.addEventListener(CONSENT_OPEN_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, reopen);
  }, []);

  const choose = (choice: ConsentChoice) => {
    try {
      localStorage.setItem(CONSENT_KEY, choice);
    } catch {
      // Not remembered, but applied for this page.
    }
    applyConsent(choice);
    setOpen(false);
  };

  if (!open) return null;
  return (
    <div className="consent" role="dialog" aria-live="polite" aria-label={fr ? "Témoins publicitaires" : "Advertising cookies"}>
      <p>
        {fr
          ? "Ce site affiche des annonces Google. Acceptez-vous les témoins qui personnalisent ces annonces? Si vous refusez, vous verrez des annonces non personnalisées."
          : "This site shows Google ads. Do you accept cookies that personalise those ads? If you refuse, you will see non-personalised ads."}{" "}
        <a href={href(lang, "privacy", "temoins")}>{fr ? "En savoir plus" : "Learn more"}</a>
      </p>
      <div className="consent__actions">
        <button type="button" className="btn btn--outline-light btn--sm" onClick={() => choose("denied")}>
          {fr ? "Refuser" : "Refuse"}
        </button>
        <button type="button" className="btn btn--outline-light btn--sm" onClick={() => choose("granted")}>
          {fr ? "Accepter" : "Accept"}
        </button>
      </div>
    </div>
  );
}

/** Footer link that reopens the banner. */
export function ConsentLink({ lang }: { lang: Lang }) {
  return (
    <button type="button" className="link-button" onClick={() => window.dispatchEvent(new Event(CONSENT_OPEN_EVENT))}>
      {lang === "fr" ? "Gérer les témoins" : "Cookie settings"}
    </button>
  );
}
