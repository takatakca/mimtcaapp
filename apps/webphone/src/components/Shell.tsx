// App shell: sidebar on desktop, top bar + bottom navigation on phones, floating softphone.
import { NavLink, Outlet } from "react-router";
import { AdSlot, AdsProvider } from "../ads/Ads";
import { useSession } from "../auth/SessionProvider";
import { env } from "../env";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";
import { Softphone } from "../phone/Softphone";
import { Icon, type IconName } from "./Icon";
import { MissionToaster } from "./MissionToaster";
import { AffiliateAttribution } from "./AffiliateAttribution";
import { DemoBanner, Wordmark } from "./ui";
import { meetingScopes } from "../pages/meetings/shared";
import { needsBusinessSetup } from "../lib/bizSetup";

interface NavItem {
  to: string;
  label: TKey;
  icon: IconName;
  short?: TKey;
}

const MAIN: NavItem[] = [
  { to: "/messages", label: "tabs.messages", icon: "messages" },
  { to: "/appels", label: "tabs.calls", icon: "phone" },
  { to: "/messagerie", label: "tabs.voicemail", icon: "voicemail", short: "tabs.voicemailShort" },
  { to: "/compte", label: "tabs.account", icon: "account" },
];

const MEETINGS: NavItem = { to: "/reunions", label: "nav.meetings", icon: "video" };
const HELP: NavItem = { to: "/aide", label: "nav.help", icon: "chat" };
const MISSIONS: NavItem = { to: "/missions", label: "nav.missions", icon: "sparkle" };

const SERVICES: NavItem[] = [
  { to: "/services/offres", label: "nav.offers", icon: "offers" },
  { to: "/services/commandes", label: "nav.orders", icon: "orders" },
  { to: "/services/transfert", label: "nav.portIn", icon: "phone" },
];

function SideLink({ item }: { item: NavItem }) {
  const { t } = useI18n();
  return (
    <NavLink to={item.to} className={({ isActive }) => `side__link${isActive ? " is-active" : ""}`}>
      <Icon name={item.icon} />
      <span>{t(item.label)}</span>
    </NavLink>
  );
}

export function Shell() {
  const { t } = useI18n();
  const { businesses, me } = useSession();
  // Réunions: premium and business plans, and every member of a business.
  const scopes = meetingScopes(me, businesses);
  const showMeetings = scopes.any || scopes.member;
  const setup = needsBusinessSetup(me, businesses);
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
            {MAIN.map((i) => (
              <SideLink key={i.to} item={i} />
            ))}
            {showMeetings ? <SideLink item={MEETINGS} /> : null}
            <SideLink item={HELP} />
            <SideLink item={MISSIONS} />
            <p className="side__section">{t("nav.services")}</p>
            {SERVICES.map((i) => (
              <SideLink key={i.to} item={i} />
            ))}
            {businesses.length > 0 || setup ? <p className="side__section">{t("nav.business")}</p> : null}
            {setup ? (
              <NavLink to="/affaires/nouvelle" className={({ isActive }) => `side__link side__link--setup${isActive ? " is-active" : ""}`}>
                <Icon name="sparkle" />
                <span>{t("biz.new.nav")}</span>
              </NavLink>
            ) : null}
            {businesses.map((b) => (
              <NavLink
                key={b.business.id}
                to={`/affaires/${b.business.id}`}
                className={({ isActive }) => `side__link${isActive ? " is-active" : ""}`}
              >
                <Icon name="business" />
                <span className="side__ellipsis">{b.business.name}</span>
              </NavLink>
            ))}
          </nav>
          {/* Desktop only (the sidebar is hidden on phones); list pages only, see ads/adsense.ts. */}
          <AdSlot placement="sidebar" />
          <div className="side__foot">
            <span className="side__user">{me?.user.displayName ?? me?.numbers[0]?.e164 ?? ""}</span>
          </div>
        </aside>
        <header className="topbar">
          <Wordmark compact />
          <div className="topbar__links">
            {showMeetings ? (
              <NavLink to="/reunions" className="icon-btn" aria-label={t("nav.meetings")}>
                <Icon name="video" />
              </NavLink>
            ) : null}
            {businesses[0] ? (
              <NavLink to={`/affaires/${businesses[0].business.id}`} className="icon-btn" aria-label={t("nav.business")}>
                <Icon name="business" />
              </NavLink>
            ) : setup ? (
              <NavLink to="/affaires/nouvelle" className="icon-btn icon-btn--glow" aria-label={t("biz.new.nav")}>
                <Icon name="business" />
              </NavLink>
            ) : null}
            <NavLink to="/missions" className="icon-btn" aria-label={t("nav.missions")}>
              <Icon name="sparkle" />
            </NavLink>
            <NavLink to="/services/offres" className="icon-btn" aria-label={t("nav.services")}>
              <Icon name="offers" />
            </NavLink>
          </div>
        </header>
        <main id="main" className="main" tabIndex={-1}>
          <Outlet />
        </main>
        <nav className="bottomnav" aria-label={t("nav.main")}>
          {MAIN.map((i) => (
            <NavLink key={i.to} to={i.to} className={({ isActive }) => `bottomnav__link${isActive ? " is-active" : ""}`}>
              <Icon name={i.icon} />
              <span>{t(i.short ?? i.label)}</span>
            </NavLink>
          ))}
        </nav>
        <Softphone />
        <MissionToaster />
        <AffiliateAttribution />
      </div>
    </AdsProvider>
  );
}
