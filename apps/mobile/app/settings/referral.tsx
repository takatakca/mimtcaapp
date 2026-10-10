import { PLANS, type ReferralStatus } from "@mimt/shared";
import { Stack } from "expo-router";
import { useState } from "react";
import { Share, StyleSheet, Text } from "react-native";
import { api } from "../../src/api/client";
import { toErrorKey } from "../../src/api/errors";
import { Body, Button, Card, ErrorText, Field, Heading, Label, Notice, Row, Screen } from "../../src/components/ui";
import { useI18n, type TKey } from "../../src/i18n";
import { useAsync } from "../../src/lib/useAsync";
import { colors, spacing } from "../../src/theme";

const STATUS_KEY: Record<ReferralStatus, TKey> = {
  pending: "referral.statusPending",
  rewarded: "referral.statusRewarded",
  rejected: "referral.statusRejected",
};
const STATUS_ICON = { pending: "time", rewarded: "gift", rejected: "close-circle" } as const;

/** Parrainage: my code to share, my invitations, and a field to enter a friend's code (new accounts only). */
export default function Referral() {
  const { t, lang, locale } = useI18n();
  const data = useAsync(() => api.referrals());
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<TKey | null>(null);
  const [done, setDone] = useState(false);
  const info = data.data;

  async function share() {
    if (!info) return;
    await Share.share({ message: t("referral.shareMessage", { code: info.code, url: info.shareUrl }) });
  }

  async function redeem() {
    setBusy(true);
    setErrorKey(null);
    try {
      await api.redeemReferral({ code: code.trim() });
      setDone(true);
      setCode("");
      await data.reload();
    } catch (e) {
      setErrorKey(toErrorKey(e));
    } finally {
      setBusy(false);
    }
  }

  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });

  return (
    <Screen edges={["bottom"]}>
      <Stack.Screen options={{ title: t("referral.title"), headerBackTitle: t("common.back") }} />
      {data.errorKey ? <ErrorText>{t(data.errorKey)}</ErrorText> : null}
      {info ? (
        <>
          <Body muted>{t("referral.intro", { months: info.reward.months, plan: PLANS[info.reward.plan].name[lang] })}</Body>
          <Card>
            <Label>{t("referral.yourCode").toUpperCase()}</Label>
            <Text style={styles.code} accessibilityLabel={`${t("referral.yourCode")}: ${info.code.split("").join(" ")}`} selectable>
              {info.code}
            </Text>
            <Button icon="share-social" label={t("referral.share")} onPress={share} />
          </Card>

          <Heading>{t("referral.friends")}</Heading>
          <Card>
            {info.referrals.length === 0 ? <Body muted>{t("referral.none")}</Body> : null}
            {info.referrals.map((r) => (
              <Row key={r.id} icon={STATUS_ICON[r.status]} title={t(STATUS_KEY[r.status])} subtitle={t("referral.since", { date: date(r.createdAt) })} />
            ))}
          </Card>

          {info.referredBy ? (
            <Notice tone={info.referredBy.status === "rejected" ? "warning" : "info"}>
              {t("referral.referredBy", { status: t(STATUS_KEY[info.referredBy.status]).toLowerCase() })}
            </Notice>
          ) : (
            <Card>
              <Heading>{t("referral.haveCode")}</Heading>
              <Field
                label={t("referral.codeLabel")}
                value={code}
                onChangeText={(v) => setCode(v.toUpperCase())}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={16}
              />
              <Button label={t("referral.redeem")} onPress={redeem} loading={busy} disabled={code.trim().length < 6} />
            </Card>
          )}
          {done ? <Notice tone="success">{t("referral.redeemed")}</Notice> : null}
          {errorKey ? <ErrorText>{t(errorKey)}</ErrorText> : null}
          <Body muted style={{ marginTop: spacing.sm }}>{t("referral.rules")}</Body>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: { color: colors.cyan, fontSize: 34, fontWeight: "800", letterSpacing: 4, textAlign: "center", marginVertical: spacing.md },
});
