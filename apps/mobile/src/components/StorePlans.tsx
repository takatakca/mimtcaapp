// Plans and "Sans pub" sold through Apple / Google in-app purchase (store builds, STORE_PURCHASES=iap).
// Shows only store prices; links to the terms and privacy policy and the auto-renewal terms (App Review 3.1.2).
// In companion mode (STORE_PURCHASES=companion) this renders nothing: no price, no button, no website mention.
import { PLANS, type MeResponse } from "@mimt/shared";
import * as WebBrowser from "expo-web-browser";
import { Platform, StyleSheet, View } from "react-native";
import { useI18n } from "../i18n";
import type { Offer } from "../lib/purchases";
import type { StorePurchases } from "../services/iap";
import { spacing } from "../theme";
import { Body, Button, Card, Heading, Loading, Notice, Row } from "./ui";

export const TERMS_URL = { fr: "https://mimt.ca/conditions/", en: "https://mimt.ca/en/terms/" };
export const PRIVACY_URL = { fr: "https://mimt.ca/confidentialite/", en: "https://mimt.ca/en/privacy/" };

export function StorePlans({ me, store }: { me: MeResponse; store: StorePurchases }) {
  const { t, lang, locale } = useI18n();
  if (store.mode !== "iap") return null;

  const busy = store.state.phase === "buying" || store.state.phase === "verifying" || store.state.phase === "restoring";
  const plans = store.offers.filter((o) => o.kind === "plan");
  const addOns = store.offers.filter((o) => o.kind === "addon");
  const label = (o: Offer) => {
    const name = o.kind === "plan" ? PLANS[o.code as keyof typeof PLANS].name[lang] : t("account.adFree");
    return t(o.interval === "year" ? "purchase.year" : "purchase.month", { plan: name, price: o.price });
  };
  const message = store.state.messageKey;
  const tone = store.state.phase === "error" ? "warning" : store.state.phase === "done" && message === "purchase.success" ? "success" : "info";

  return (
    <Card>
      <Heading>{t("purchase.title")}</Heading>
      {store.loading ? <Loading label={t("purchase.loading")} /> : null}
      {!store.loading && !store.available && !store.manageable ? <Body muted>{t("purchase.storeUnavailable")}</Body> : null}
      {!store.loading && store.available && store.offers.length === 0 && me.account.plan === "free" ? <Body muted>{t("purchase.none")}</Body> : null}

      {[...new Set(plans.map((o) => o.code))].map((code) => {
        const caps = PLANS[code as keyof typeof PLANS].caps;
        return (
          <View key={code} style={styles.plan}>
            <Body muted>
              {t("purchase.capsLine", {
                out: caps.outboundMinutes.toLocaleString(locale),
                in: caps.inboundMinutes.toLocaleString(locale),
                msgs: caps.messages.toLocaleString(locale),
              })}
            </Body>
            {plans
              .filter((o) => o.code === code)
              .map((o) => (
                <Button
                  key={o.sku}
                  icon={o.interval === "month" ? "arrow-up-circle" : undefined}
                  variant={o.interval === "month" ? "primary" : "secondary"}
                  label={label(o)}
                  disabled={busy}
                  loading={busy && store.state.sku === o.sku}
                  onPress={() => store.buy(o)}
                />
              ))}
          </View>
        );
      })}

      {addOns.length ? (
        <View style={styles.plan}>
          <Body muted>{t("account.adFreeHint")}</Body>
          {addOns.map((o) => (
            <Button
              key={o.sku}
              icon={o.interval === "month" ? "eye-off" : undefined}
              variant="secondary"
              label={label(o)}
              disabled={busy}
              loading={busy && store.state.sku === o.sku}
              onPress={() => store.buy(o)}
            />
          ))}
        </View>
      ) : null}

      {store.state.phase === "verifying" ? <Notice>{t("purchase.verifying")}</Notice> : null}
      {message ? <Notice tone={tone}>{t(message)}</Notice> : null}

      {store.offers.length ? <Body muted>{t(Platform.OS === "ios" ? "purchase.renewalIos" : "purchase.renewalAndroid")}</Body> : null}
      {store.manageable ? <Row icon="card" title={t("purchase.manage")} onPress={store.manage} /> : null}
      {store.available ? <Row icon="refresh" title={t("purchase.restore")} onPress={store.restore} /> : null}
      <Row icon="document-text" title={t("purchase.terms")} onPress={() => WebBrowser.openBrowserAsync(TERMS_URL[lang])} />
      <Row icon="shield-checkmark" title={t("purchase.privacy")} onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL[lang])} />
    </Card>
  );
}

const styles = StyleSheet.create({
  plan: { gap: spacing.sm, marginTop: spacing.sm },
});
