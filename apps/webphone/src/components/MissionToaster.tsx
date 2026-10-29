// Celebration toast for Missions MIMT. Mounted once in the signed-in shell: listens for grants announced by the
// pages (lib/missions.ts celebrateGrant) and, when the app opens, reads GET /v1/missions for grants made elsewhere
// (SMS sign-in, Stripe webhook, a friend subscribing). Each mission is celebrated once per browser.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import { useI18n } from "../i18n/I18nProvider";
import { celebrationsOf, firstTimeSeen, missionLabel, MISSION_EVENT, type MissionCelebration } from "../lib/missions";
import { Icon } from "./Icon";

const SHOW_MS = 7000;

export function MissionToaster() {
  const { t, lang } = useI18n();
  const [queue, setQueue] = useState<MissionCelebration[]>([]);

  useEffect(() => {
    const push = (c: MissionCelebration) => {
      if (firstTimeSeen(c)) setQueue((q) => [...q, c]);
    };
    const onEvent = (e: Event) => push((e as CustomEvent<MissionCelebration>).detail);
    window.addEventListener(MISSION_EVENT, onEvent);
    let active = true;
    api
      .missions()
      .then((r) => {
        if (active && r.enabled) celebrationsOf(r.missions).forEach(push);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      window.removeEventListener(MISSION_EVENT, onEvent);
    };
  }, []);

  const current = queue[0];
  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(() => setQueue((q) => q.slice(1)), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [current]);

  if (!current) return null;
  const label = missionLabel(current.id, lang);
  const text = current.pending
    ? t("mission.toastPending", { label, minutes: current.minutes })
    : (current.points ?? 0) > 0
      ? t("mission.toast", { label, points: (current.points ?? 0).toLocaleString(lang === "fr" ? "fr-CA" : "en-CA") })
      : t("mission.toastNoMinutes", { label });
  return (
    <div className="toast-region mission-toast-region" role="status" aria-live="polite">
      <div className="toast mission-toast">
        <span className="mission-toast__icon" aria-hidden="true">
          <Icon name="sparkle" size={22} />
        </span>
        <Link to="/missions" className="mission-toast__text" onClick={() => setQueue((q) => q.slice(1))}>
          {text}
        </Link>
        <button type="button" className="icon-btn" aria-label={t("mission.toastClose")} onClick={() => setQueue((q) => q.slice(1))}>
          <Icon name="close" size={18} />
        </button>
      </div>
    </div>
  );
}
