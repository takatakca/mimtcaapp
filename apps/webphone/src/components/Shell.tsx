// App shell: sidebar on desktop, top bar + bottom navigation on phones, floating softphone and the Pilote MIMT bar.
// Order (docs/MIMT-APP-STUDY-2026-10-28.md): Accueil, Messages, Appels, Messagerie vocale, MIMT Affaires (standard,
// réceptionniste IA), Réunions, Boutique, Portefeuille (points + missions); then Parrainer et gagner, Aide, Compte.
import { Fragment } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { DEFAULT_CALL_SETTINGS } from "@mimt/shared";
import { AdSlot, AdsProvider } from "../ads/Ads";
import { useSession } from "../auth/SessionProvider";
import { env } from "../env";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";
import { Softphone } from "../phone/Softphone";
import { Icon, type IconName } from "./Icon";
import { MissionToaster } from "./MissionToaster";
import { usePointsShell } from "./PointsNav";
import { AffiliateAttribution } from "./AffiliateAttribution";
import { PilotBar } from "../pilot/PilotBar";
import { DemoBanner, Wordmark } from "./ui";
import { meetingScopes } from "../pages/meetings/shared";
import { needsBusinessSetup } from "../lib/bizSetup";
import { availability } from "../lib/home";

interface NavItem {
  to: string;
  label: TKey;
  icon: IconName;
  short?: TKey;
  /** Other path prefixes that make this entry the current one (Boutique covers /services/*). */
  match?: string[];
}

const HOME: NavItem = { to: "/accueil", label: "nav.home", icon: "home" };
const INBOX: NavItem[] = [
  { to: "/messages", label: "tabs.messages", icon: "messages" },
  { to: "/appels", label: "tabs.calls", icon: "phone" },
  { to: "/messagerie", label: "tabs.voicemail", icon: "voicemail", short: "tabs.voicemailShort" },
];
const ACCOUNT: NavItem = { to: "/compte", label: "nav.settings", icon: "settings", short: "tabs.account" };
/** Phones: the five everyday screens. */
const BOTTOM: NavItem[] = [HOME, ...INBOX, ACCOUNT];

const MEETINGS: NavItem = { to: "/reunions", label: "nav.meetings", icon: "video" };
const SHOP: NavItem = { to: "/services/offres", label: "nav.shop", icon: "offers", match: ["/services"] };
const HELP: NavItem = { to: "/aide", label: "nav.help", icon: "help" };

/** Current when the path is the entry's own or under one of its prefixes. */
export function isCurrent(pathname: string, item: Pick<NavItem, "to" | "match">): boolean {
  const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  return under(item.to) || (item.match ?? []).some(under);
}

function SideLink({ item }: { item: NavItem }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const current = isCurrent(pathname, item);
  return (
    <Link to={item.to} className={`side__link${current ? " is-active" : ""}`} aria-current={current ? "page" : undefined}>
      <Icon name={item.icon} />
      <span>{t(item.label)}</span>
    </Link>
  );
}

export function Shell() {
  const { t } = useI18n();
  const { businesses, me } = useSession();
  const { pathname } = useLocation();
  // Réunions: premium and business plans, and every member of a business.
  const scopes = meetingScopes(me, businesses);
  const showMeetings = scopes.any || scopes.member;
  const setup = needsBusinessSetup(me, businesses);
  const points = usePointsShell();
  const avail = availability(me?.callSettings ?? DEFAULT_CALL_SETTINGS);
  const firstBusiness = businesses[0]?.business;
  // « Pilote MIMT »: a navigation with a new pilotRun remounts the page so it shows what was just changed.
  const pilotRun = (useLocation().state as { pilotRun?: number } | null)?.pilotRun ?? 0;
  return (
    <AdsProvider>
      <div className="app">
        <a href="#main" className="skip-link">
          {t("nav.skip")}
        </a>
        {env.mock ? <DemoBanner /> : null}
        <aside className="side" aria-label={t("nav.main")}>
          <Wordmark />
          <nav className="side__nav">
            <SideLink item={HOME} />
            {INBOX.map((i) => (
              <SideLink key={i.to} item={i} />
            ))}
            {businesses.length > 0 || setup ? <p className="side__section">{t("nav.business")}</p> : null}
            {setup ? (
              <NavLink to="/affaires/nouvelle" className={({ isActive }) => `side__link side__link--setup${isActive ? " is-active" : ""}`}>
                <Icon name="sparkle" />
                <span>{t("biz.new.nav")}</span>
              </NavLink>
            ) : null}
            {firstBusiness ? (
              <NavLink
                to={`/affaires/${firstBusiness.id}/receptionniste-ia`}
                className={({ isActive }) => `side__link${isActive ? " is-active" : ""}`}
              >
                <Icon name="bot" />
                <span>{t("nav.receptionist")}</span>
              </NavLink>
            ) : null}
            {businesses.map((b) => (
              <NavLink
                key={b.business.id}
                to={`/affaires/${b.business.id}`}
                end
                className={({ isActive }) =>
                  `side__link${isActive || (pathname.startsWith(`/affaires/${b.business.id}/`) && !pathname.endsWith("/receptionniste-ia")) ? " is-active" : ""}`
                }
                title={`${t("nav.switchboard")} · ${b.business.name}`}
              >
                <Icon name="business" />
                <span className="side__ellipsis">{b.business.name}</span>
              </NavLink>
            ))}
            {businesses.length > 0 || setup ? <span className="side__rule" aria-hidden="true" /> : null}
            {showMeetings ? <SideLink item={MEETINGS} /> : null}
            <SideLink item={SHOP} />
            {points.side}
          </nav>
          {/* Desktop only (the sidebar is hidden on phones); list pages only, see ads/adsense.ts. */}
          <AdSlot placement="sidebar" />
          <nav className="side__nav side__nav--foot" aria-label={t("nav.more")}>
            <Link to="/missions#inviter" className="side__link side__link--accent">
              <Icon name="gift" />
              <span>{t("nav.referral")}</span>
            </Link>
            <SideLink item={HELP} />
            <SideLink item={ACCOUNT} />
          </nav>
          <Link to="/accueil" className="side__foot" aria-label={`${t("home.avail.label")} : ${t(avail.dnd ? "home.avail.dnd" : "home.avail.available")}`}>
            <span className="side__avatar" aria-hidden="true">
              {(me?.user.displayName ?? "M").trim().charAt(0).toUpperCase()}
            </span>
            <span className="side__who">
              <span className="side__user">{me?.user.displayName ?? me?.numbers[0]?.e164 ?? ""}</span>
              <span className="side__status">
                <span className={`status-dot${avail.dnd ? " status-dot--warn" : " status-dot--ok"}`} aria-hidden="true" />
                {t(avail.dnd ? "home.avail.dnd" : "home.avail.available")}
              </span>
            </span>
          </Link>
        </aside>
        <header className="topbar">
          <Link to="/accueil" className="topbar__brand" aria-label={t("nav.home")}>
            <Wordmark compact />
          </Link>
          <div className="topbar__links">
            {showMeetings ? (
              <NavLink to="/reunions" className="icon-btn" aria-label={t("nav.meetings")}>
                <Icon name="video" />
              </NavLink>
            ) : null}
            {firstBusiness ? (
              <NavLink to={`/affaires/${firstBusiness.id}`} className="icon-btn" aria-label={t("nav.business")}>
                <Icon name="business" />
              </NavLink>
            ) : setup ? (
              <NavLink to="/affaires/nouvelle" className="icon-btn icon-btn--glow" aria-label={t("biz.new.nav")}>
                <Icon name="business" />
              </NavLink>
            ) : null}
            {points.top}
            <NavLink to="/services/offres" className="icon-btn" aria-label={t("nav.shop")}>
              <Icon name="offers" />
            </NavLink>
            <NavLink to="/aide" className="icon-btn" aria-label={t("nav.help")}>
              <Icon name="help" />
            </NavLink>
          </div>
        </header>
        <main id="main" className="main" tabIndex={-1}>
          <Fragment key={pilotRun}>
            <Outlet />
          </Fragment>
        </main>
        <nav className="bottomnav" aria-label={t("nav.main")}>
          {BOTTOM.map((i) => {
            const current = isCurrent(pathname, i);
            return (
              <Link key={i.to} to={i.to} className={`bottomnav__link${current ? " is-active" : ""}`} aria-current={current ? "page" : undefined}>
                <Icon name={i.icon} />
                <span>{t(i.short ?? i.label)}</span>
              </Link>
            );
          })}
        </nav>
        <Softphone />
        <MissionToaster />
        {points.toast}
        <AffiliateAttribution />
        <PilotBar />
      </div>
    </AdsProvider>
  );
}
