// Free-plan ads in the signed-in shell (rules in adsense.ts). <AdsProvider> sits in Shell: it reads the
// user's "ads_personalised" consent, then lazy-loads AdSense after the first render, only for accounts
// that see ads. <AdSlot> renders a banner (list pages) or a desktop sidebar unit, with « Publicité »
// and « Enlever les publicités » next to it.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { api } from "../api/client";
import { useSession } from "../auth/SessionProvider";
import { env } from "../env";
import { useI18n } from "../i18n/I18nProvider";
import { usePhone } from "../phone/PhoneProvider";
import { adMode, adSenseConfig, applyAdConsent, callInProgress, loadAdSense, mobileAppUrl, requestAd, shouldLoadAdSense, type AdMode, type AdPlacement, type AdSenseConfig } from "./adsense";

export interface AdsState {
  plan: import("@mimt/shared").PlanCode | undefined;
  addOns: readonly string[];
  config: AdSenseConfig | null;
  mock: boolean;
  inCall: boolean;
  /** "ads_personalised" consent (false until read, and on any error). */
  personalised: boolean;
  setPersonalised: (granted: boolean) => void;
}

export const AdsContext = createContext<AdsState | null>(null);

/** Null outside <AdsProvider> (e.g. pages rendered alone in tests). */
export const useAds = () => useContext(AdsContext);

export function AdsProvider({ children, config = adSenseConfig(env.adsense) }: { children: ReactNode; config?: AdSenseConfig | null }) {
  const { me } = useSession();
  const { state } = usePhone();
  const plan = me?.account.plan;
  const addOns = useMemo(() => me?.account.addOns ?? [], [me?.account.addOns]);
  const [personalised, setPersonalisedState] = useState(false);
  const [consentRead, setConsentRead] = useState(false);
  const load = shouldLoadAdSense({ plan, addOns, config, mock: env.mock });

  useEffect(() => {
    if (!load) return;
    let active = true;
    // Fail closed: no answer or an error means non-personalised ads.
    api
      .consents()
      .then(({ consents }) => {
        if (active) setPersonalisedState(consents.find((c) => c.kind === "ads_personalised")?.granted === true);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setConsentRead(true);
      });
    return () => {
      active = false;
    };
  }, [load]);

  // After the first render and the consent read: inject adsbygoogle.js once, flag first.
  useEffect(() => {
    if (load && consentRead && config) loadAdSense(config.client, personalised);
  }, [load, consentRead, config, personalised]);

  const setPersonalised = useCallback((granted: boolean) => {
    setPersonalisedState(granted);
    applyAdConsent(granted);
  }, []);

  const value = useMemo<AdsState>(
    () => ({ plan, addOns, config, mock: env.mock, inCall: callInProgress(state.status), personalised, setPersonalised }),
    [plan, addOns, config, state.status, personalised, setPersonalised],
  );
  return <AdsContext.Provider value={value}>{children}</AdsContext.Provider>;
}

export function useAdMode(placement: AdPlacement): AdMode {
  const ads = useAds();
  const { pathname } = useLocation();
  if (!ads) return "none";
  return adMode({ plan: ads.plan, addOns: ads.addOns, config: ads.config, mock: ads.mock, pathname, inCall: ads.inCall, placement });
}

function LiveUnit({ client, slot, placement }: { client: string; slot: string; placement: AdPlacement }) {
  useEffect(() => requestAd(), []);
  return (
    <ins
      className="adsbygoogle ad__unit"
      style={{ display: "block" }}
      data-ad-client={client}
      data-ad-slot={slot}
      data-ad-format={placement === "banner" ? "horizontal" : "auto"}
      data-full-width-responsive="true"
    />
  );
}

/** One ad unit with its « Publicité » label and the « Enlever les publicités » link. Renders nothing when no ad applies. */
export function AdSlot({ placement }: { placement: AdPlacement }) {
  const { t, lang } = useI18n();
  const ads = useAds();
  const { pathname } = useLocation();
  const mode = useAdMode(placement);
  if (mode === "none" || !ads) return null;
  const slot = placement === "banner" ? ads.config?.slotBanner : ads.config?.slotSidebar;
  return (
    <aside className={`ad ad--${placement}`} aria-label={t("ads.label")} data-ad-mode={mode}>
      <span className="ad__label">{t("ads.label")}</span>
      {mode === "live" && ads.config && slot ? (
        // A new unit per page: AdSense fills each <ins> once.
        <LiveUnit key={pathname} client={ads.config.client} slot={slot} placement={placement} />
      ) : (
        <div className={`ad__placeholder ad__placeholder--${placement}`}>{t("ads.placeholder")}</div>
      )}
      <div className="ad__links">
        <Link to="/compte#sans-pub" className="ad__remove">
          {t("ads.remove")}
        </Link>
        {placement === "banner" ? (
          <a href={mobileAppUrl(lang)} rel="noopener" className="ad__reward">
            {t("ads.rewardedApp")}
          </a>
        ) : null}
      </div>
    </aside>
  );
}
