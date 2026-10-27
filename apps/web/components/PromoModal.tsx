"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { isExitIntent, promptModeFor, scrolledEnough, type StoreGetter } from "@/lib/download-prompt";
import { PROMO_DESKTOP_DELAY_MS, markPromoSeen, missionMinutesTotal, promoDue, yearlyOfferLive } from "@/lib/growth";
import { href, type Lang } from "@/lib/site";

const store: StoreGetter = () => window.localStorage;

/**
 * « Essayez-nous » promo, at most once every 7 days per visitor (lib/growth.ts).
 * Desktop: after 20 s or on exit intent, as a modal. Phone: a small bottom sheet after half the page,
 * never a full-screen interstitial. Only real offers; no timer, no invented scarcity.
 */
export function PromoModal({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  const titleId = useId();
  const [mode, setMode] = useState<"modal" | "sheet" | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setMode(null), []);

  useEffect(() => {
    if (!promoDue(store)) return;
    const m = promptModeFor(window.innerWidth, window.matchMedia?.("(pointer: fine)").matches ?? false);
    let done = false;
    const show = () => {
      if (done) return;
      done = true;
      markPromoSeen(store);
      setMode(m);
    };
    if (m === "modal") {
      const t = window.setTimeout(show, PROMO_DESKTOP_DELAY_MS);
      const onOut = (e: MouseEvent) => isExitIntent(e) && show();
      document.addEventListener("mouseout", onOut);
      return () => {
        window.clearTimeout(t);
        document.removeEventListener("mouseout", onOut);
      };
    }
    const onScroll = () => scrolledEnough(window.scrollY, window.innerHeight, document.documentElement.scrollHeight) && show();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!mode) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, close]);

  if (!mode) return null;
  const yearly = yearlyOfferLive();
  const title = yearly
    ? fr ? "1 mois gratuit sur l'annuel" : "1 month free on yearly"
    : fr ? `Jusqu'à ${missionMinutesTotal()} minutes bonus` : `Up to ${missionMinutesTotal()} bonus minutes`;
  const text = yearly
    ? fr
      ? "Payez votre forfait à l'année : 12 mois pour le prix de 11. Votre numéro canadien, actif dès le paiement."
      : "Pay your plan yearly: 12 months for the price of 11. Your Canadian number, live as soon as you pay."
    : fr
      ? "Configurez votre compte et gagnez des minutes : @nom, notifications, votre numéro. Vérifié, sans tirage."
      : "Set up your account and earn minutes: @name, notifications, your number. Verified, no draw.";

  const body = (
    <div className={`promo promo--${mode}`} role="dialog" aria-modal={mode === "modal"} aria-labelledby={titleId}>
      <button ref={closeRef} type="button" className="promo__close" onClick={close} aria-label={fr ? "Fermer" : "Close"}>
        <span aria-hidden="true">×</span>
      </button>
      <p className="promo__tag">{fr ? "Essayez MIMT" : "Try MIMT"}</p>
      <h2 id={titleId}>{title}</h2>
      <p className="promo__text">{text}</p>
      <div className="promo__actions">
        <a className="btn btn--primary" href={`${href(lang, "home")}#numero`} onClick={close}>
          {fr ? "Choisir mon numéro" : "Pick my number"}
        </a>
        <a className="btn btn--outline-light" href={href(lang, "rewards")} onClick={close}>
          {fr ? "Voir les missions" : "See the missions"}
        </a>
      </div>
      <p className="promo__fine">{fr ? "Taxes en sus. Sans contrat. Détails sur la page Récompenses." : "Taxes extra. No contract. Details on the Rewards page."}</p>
    </div>
  );
  return mode === "modal" ? (
    <div className="promo-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
      {body}
    </div>
  ) : (
    body
  );
}
