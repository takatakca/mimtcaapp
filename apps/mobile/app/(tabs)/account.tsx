import { formatCad, PLANS, type PaidPlanCode, type PlanCode } from "@mimt/shared";
import { useFocusEffect, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useState } from "react";
import { Alert, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { api, APP_VERSION } from "../../src/api/client";
import { toErrorKey } from "../../src/api/errors";
import { useSession } from "../../src/auth/session";
import { RewardButton } from "../../src/components/Ads";
import { UsageBar } from "../../src/components/UsageBar";
import { Body, Button, Card, ErrorText, Heading, Label, Notice, Row, Screen, Title } from "../../src/components/ui";
import { useI18n, type TKey } from "../../src/i18n";
import { formatPhone } from "../../src/lib/dial";
import { usageRows } from "../../src/lib/usage";
import { callService } from "../../src/services/call";
import { colors, radius, spacing, TAP } from "../../src/theme";

const CCTS_URL = { fr: "https://www.ccts-cprst.ca/fr/", en: "https://www.ccts-cprst.ca/" };
const SUPPORT_URL = { fr: "https://mimt.ca/soutien", en: "https://mimt.ca/en/support" };
const USAGE_LABEL: Record<string, TKey> = {
  outboundMinutes: "account.usageOutMin",
  inboundMinutes: "account.usageInMin",
  outboundSms: "account.usageSms",
};
// Consumer upgrades shown in the app. Business plans are sold on the web from the TAKATAK dashboard.
const UPGRADES: Partial<Record<PlanCode, PaidPlanCode[]>> = { free: ["lock", "premium"], lock: ["premium"] };

export default function Account() {
  const { t, lang, setLang, locale } = useI18n();
  const router = useRouter();
  const { me, refreshMe, signOut } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<TKey | null>(null);
  const [info, setInfo] = useState<TKey | null>(null);
  useFocusEffect(useCallback(() => void refreshMe(), [refreshMe]));

  const plan = me ? PLANS[me.account.plan] : null;
  const rows = me ? usageRows(me.account.plan, me.usage) : [];
  const worst = rows.some((r) => r.level === "full") ? "full" : rows.some((r) => r.level === "warn") ? "warn" : "ok";

  async function run(id: string, fn: () => Promise<void>) {
    setBusy(id);
    setErrorKey(null);
    setInfo(null);
    try {
      await fn();
    } catch (e) {
      setErrorKey(toErrorKey(e));
    } finally {
      setBusy(null);
    }
  }

  // TODO(store-billing): consumer subscriptions bought in the iOS/Android app must go through
  // Apple/Google in-app purchase (MIMT-MVP §6). Web checkout is used until IAP is implemented.
  const upgrade = (code: PaidPlanCode) =>
    run(`upgrade-${code}`, async () => {
      const { checkoutUrl } = await api.checkout(code);
      await WebBrowser.openBrowserAsync(checkoutUrl);
      await refreshMe();
    });

  const changeLang = (next: "fr" | "en") =>
    run("lang", async () => {
      await setLang(next);
      await api.updateMe({ locale: next === "fr" ? "fr-CA" : "en-CA" }).catch(() => undefined);
    });

  const exportData = () =>
    run("export", async () => {
      // GET /v1/me/export needs the bearer token, so the app downloads the JSON and hands it to the share sheet.
      const data = await api.exportData();
      setInfo("account.exportStarted");
      await Share.share({ title: `mimt-export-${data.exportedAt.slice(0, 10)}.json`, message: JSON.stringify(data, null, 2) });
    });

  const deleteAccount = () =>
    Alert.alert(t("account.delete"), t("account.deleteConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () =>
          run("delete", async () => {
            await api.deleteAccount();
            await callService.unregister();
            await signOut();
            router.replace("/welcome");
          }),
      },
    ]);

  const logout = () =>
    run("logout", async () => {
      await callService.unregister();
      await signOut();
      router.replace("/welcome");
    });

  return (
    <Screen edges={["top"]}>
      <Title>{t("account.title")}</Title>

      {me && plan ? (
        <Card>
          <Label>{t("account.plan").toUpperCase()}</Label>
          <Text style={styles.planName}>{plan.name[lang]}</Text>
          <Body muted>
            {plan.monthlyPriceCents === 0 ? t("account.free") : t("account.perMonth", { price: formatCad(plan.monthlyPriceCents, lang) })}
          </Body>
          {me.numbers[0] ? (
            <View style={{ marginTop: spacing.sm }}>
              <Label>{t("account.number").toUpperCase()}</Label>
              <Text style={styles.number}>{formatPhone(me.numbers[0].e164)}</Text>
            </View>
          ) : null}
        </Card>
      ) : null}

      {me ? (
        <Card>
          <Heading>{t("account.usage")}</Heading>
          {rows.map((row) => (
            <UsageBar
              key={row.key}
              row={row}
              label={t(USAGE_LABEL[row.key]!)}
              ofText={t("account.usageOf", {
                used: row.used.toLocaleString(locale),
                cap: row.cap.toLocaleString(locale),
              })}
            />
          ))}
          {worst === "warn" ? <Notice tone="warning">{t("account.usageWarn")}</Notice> : null}
          {worst === "full" ? <Notice tone="warning">{t("account.usageFull")}</Notice> : null}
          <RewardButton />
        </Card>
      ) : null}

      {me && UPGRADES[me.account.plan]?.length ? (
        <Card>
          {UPGRADES[me.account.plan]!.map((code) => (
            <Button
              key={code}
              icon="arrow-up-circle"
              label={`${t("account.upgrade", { plan: PLANS[code].name[lang] })} · ${t("account.perMonth", {
                price: formatCad(PLANS[code].monthlyPriceCents, lang),
              })}`}
              hint={t("account.upgradeHint")}
              loading={busy === `upgrade-${code}`}
              onPress={() => upgrade(code)}
            />
          ))}
          <Body muted>{t("account.upgradeHint")}</Body>
        </Card>
      ) : null}

      {errorKey ? <ErrorText>{t(errorKey)}</ErrorText> : null}
      {info ? <Notice tone="success">{t(info)}</Notice> : null}

      <Heading>{t("account.settings")}</Heading>
      <Card>
        <Label>{t("account.language").toUpperCase()}</Label>
        <View style={styles.langRow} accessibilityRole="radiogroup" accessibilityLabel={t("account.language")}>
          {(["fr", "en"] as const).map((l) => (
            <Pressable
              key={l}
              accessibilityRole="radio"
              accessibilityState={{ selected: lang === l }}
              accessibilityLabel={l === "fr" ? t("account.languageFr") : t("account.languageEn")}
              onPress={() => changeLang(l)}
              style={[styles.lang, lang === l && styles.langOn]}
            >
              <Text style={[styles.langText, lang === l && { color: colors.navy }]}>
                {l === "fr" ? t("account.languageFr") : t("account.languageEn")}
              </Text>
            </Pressable>
          ))}
        </View>
        <Row icon="location" title={t("account.e911Address")} onPress={() => router.push("/settings/address")} />
        <Row icon="alert-circle" title={t("account.e911Notice")} onPress={() => router.push("/settings/notice")} />
        <Row icon="shield-checkmark" title={t("account.privacy")} onPress={() => router.push("/settings/privacy")} />
        <Row icon="sparkles" title={t("ai.entry")} subtitle={t("ai.entryHint")} onPress={() => router.push("/settings/ai")} />
        <Row icon="business" title={t("business.entry")} subtitle={t("business.entryHint")} onPress={() => router.push("/settings/business")} />
        <Row icon="download" title={t("account.export")} onPress={exportData} />
        <Row icon="help-buoy" title={t("account.support")} onPress={() => WebBrowser.openBrowserAsync(SUPPORT_URL[lang])} />
        <Row
          icon="megaphone"
          title={t("account.complaints")}
          subtitle={t("account.complaintsHint")}
          onPress={() => WebBrowser.openBrowserAsync(CCTS_URL[lang])}
        />
      </Card>
      <Card>
        <Row icon="log-out" title={t("account.logout")} onPress={logout} />
        <Row icon="trash" danger title={t("account.delete")} onPress={deleteAccount} />
      </Card>
      <Body muted style={{ textAlign: "center", marginTop: spacing.md }}>
        {`${t("app.name")} · ${t("app.by")} · ${t("account.version", { version: APP_VERSION })}`}
      </Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  planName: { color: colors.white, fontSize: 26, fontWeight: "800" },
  number: { color: colors.cyan, fontSize: 22, fontWeight: "700" },
  langRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  lang: {
    flex: 1,
    minHeight: TAP,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  langOn: { backgroundColor: colors.electric, borderColor: colors.electric },
  langText: { color: colors.white, fontWeight: "700", fontSize: 16 },
});
