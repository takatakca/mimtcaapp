// MIMT Points in the shell: the sidebar entry with the balance badge, the top-bar shortcut, and the celebration toast
// for points earned elsewhere (a paid bill, a store renewal, a friend who subscribed, a campaign). Missions have
// their own toast (MissionToaster). Reads GET /v1/points when the app opens and after a redemption (POINTS_EVENT).
import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import type { PointsEntryDto } from "@mimt/shared";
import { api } from "../api/client";
import { useI18n } from "../i18n/I18nProvider";
import { MISSION_EVENT } from "../lib/missions";
import { entryLabel, formatPoints, newCredits, POINTS_EVENT } from "../lib/points";
import { Icon } from "./Icon";

const SEEN_KEY = "mimt.points.lastSeen";
const SHOW_MS = 7000;

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}
function writeSeen(id: string): void {
  try {
    localStorage.setItem(SEEN_KEY, id);
  } catch {
    // Storage blocked: the toast may show again, nothing else breaks.
  }
}

/** Balance shared by the badge and the toaster (one read per change). */
function usePointsFeed() {
  const [balance, setBalance] = useState<number | null>(null);
  const [credits, setCredits] = useState<PointsEntryDto[]>([]);
  useEffect(() => {
    let active = true;
    const load = () =>
      api
        .points()
        .then((r) => {
          if (!active) return;
          setBalance(r.enabled || r.balance > 0 ? r.balance : null);
          const seen = readSeen();
          // First visit in this browser: nothing to celebrate yet, only remember where we are ("" = empty history).
          const fresh = seen === null ? [] : newCredits(r.history, seen).slice(0, 3);
          writeSeen(r.history[0]?.id ?? "");
          if (fresh.length) setCredits((q) => [...q, ...fresh]);
        })
        .catch(() => undefined);
    void load();
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent<number | undefined>).detail;
      if (typeof detail === "number") setBalance(detail);
      void load();
    };
    window.addEventListener(POINTS_EVENT, onEvent);
    // A mission just granted by a route answer (its own toast): only the badge needs the new balance.
    window.addEventListener(MISSION_EVENT, onEvent);
    return () => {
      active = false;
      window.removeEventListener(POINTS_EVENT, onEvent);
      window.removeEventListener(MISSION_EVENT, onEvent);
    };
  }, []);
  return { balance, credits, setCredits };
}

/** Sidebar entry, top-bar shortcut and toast, for Shell.tsx. */
export function usePointsShell() {
  const { t, lang } = useI18n();
  const { balance, credits, setCredits } = usePointsFeed();
  // « Portefeuille » covers the balance (/points) and the missions (/missions, its « Gagner » side).
  const { pathname } = useLocation();
  const inWallet = pathname === "/points" || pathname === "/missions";
  const current = credits[0];
  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(() => setCredits((q) => q.slice(1)), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [current, setCredits]);
  return {
    side: (
      <Link to="/points" className={`side__link${inWallet ? " is-active" : ""}`} aria-current={inWallet ? "page" : undefined}>
        <Icon name="wallet" />
        <span>{t("nav.points")}</span>
        {balance !== null ? (
          <span className="pts-badge" aria-label={t("nav.pointsBadge", { points: formatPoints(balance, lang) })}>
            {formatPoints(balance, lang)}
          </span>
        ) : null}
      </Link>
    ),
    top: (
      <NavLink to="/points" className="icon-btn" aria-label={t("nav.points")}>
        <Icon name="wallet" />
      </NavLink>
    ),
    toast: current ? (
      <div className="toast-region pts-toast-region" role="status" aria-live="polite">
        <div className="toast pts-toast">
          <span className="pts-toast__icon" aria-hidden="true">
            <Icon name="wallet" size={22} />
          </span>
          <Link to="/points" className="pts-toast__text" onClick={() => setCredits((q) => q.slice(1))}>
            {t("points.toast", { points: formatPoints(current.delta, lang), label: entryLabel(current, lang) })}
          </Link>
          <button type="button" className="icon-btn" aria-label={t("points.toastClose")} onClick={() => setCredits((q) => q.slice(1))}>
            <Icon name="close" size={18} />
          </button>
        </div>
      </div>
    ) : null,
  };
}
