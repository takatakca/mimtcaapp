import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { api } from "../api/client";
import { ApiClientError } from "../api/errors";
import { useSession } from "../auth/session";
import { useI18n } from "../i18n";
import { adRequestOptions, adsEnabledFor, initAds, loadAdsSdk, testUnitIds } from "../services/ads";
import { spacing } from "../theme";
import { Body, Button, Notice } from "./ui";

function useAdsReady(): boolean {
  const { me } = useSession();
  const enabled = adsEnabledFor(me?.account.plan);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!enabled) return setReady(false);
    let alive = true;
    initAds().then((ok) => alive && setReady(ok));
    return () => {
      alive = false;
    };
  }, [enabled]);
  return enabled && ready;
}

/** Adaptive banner, free plans only. Renders nothing for plans with "no_ads". */
export function AdBanner() {
  const ready = useAdsReady();
  const ads = loadAdsSdk();
  if (!ready || !ads) return null;
  const { BannerAd, BannerAdSize } = ads;
  return (
    <View style={{ alignItems: "center", marginVertical: spacing.sm }}>
      <BannerAd
        unitId={testUnitIds(ads).banner}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={adRequestOptions()}
      />
    </View>
  );
}

/** "Gagnez 10 minutes": rewarded ad, then POST /v1/rewards/claim. */
export function RewardButton() {
  const { t } = useI18n();
  const { me, refreshMe } = useSession();
  const userId = me?.user.id;
  const ready = useAdsReady();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"done" | "failed" | "soon" | null>(null);
  const adRef = useRef<{ show: () => Promise<void> } | null>(null);
  const unitRef = useRef("");

  useEffect(() => {
    const ads = loadAdsSdk();
    if (!ready || !ads) return;
    const { RewardedAd, RewardedAdEventType, AdEventType } = ads;
    unitRef.current = testUnitIds(ads).rewarded;
    const ad = RewardedAd.createForAdRequest(unitRef.current, adRequestOptions(userId));
    adRef.current = ad;
    const offs = [
      ad.addAdEventListener(RewardedAdEventType.LOADED, () => setLoaded(true)),
      ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, async () => {
        try {
          // Minutes are credited only after AdMob's signed callback. A 409 means that callback
          // has not arrived yet.
          await api.claimReward({ kind: "rewarded_ad_10min", adUnitId: unitRef.current });
          setResult("done");
          await refreshMe();
        } catch (e) {
          setResult(e instanceof ApiClientError && e.status === 501 ? "soon" : "failed");
        }
      }),
      ad.addAdEventListener(AdEventType.CLOSED, () => {
        setLoaded(false);
        setBusy(false);
        ad.load();
      }),
      ad.addAdEventListener(AdEventType.ERROR, () => {
        setLoaded(false);
        setBusy(false);
      }),
    ];
    ad.load();
    return () => offs.forEach((off) => off());
  }, [ready, refreshMe, userId]);

  if (!ready) return null;
  return (
    <View>
      <Body muted>{t("account.rewardHint")}</Body>
      <Button
        icon="play-circle"
        label={loaded ? t("account.reward") : t("account.rewardLoading")}
        disabled={!loaded}
        loading={busy}
        onPress={() => {
          setBusy(true);
          setResult(null);
          adRef.current?.show().catch(() => {
            setBusy(false);
            setResult("failed");
          });
        }}
      />
      {result === "done" ? <Notice tone="success">{t("account.rewardDone")}</Notice> : null}
      {result === "failed" ? <Notice tone="warning">{t("account.rewardFailed")}</Notice> : null}
      {result === "soon" ? <Notice>{t("account.rewardSoon")}</Notice> : null}
    </View>
  );
}
