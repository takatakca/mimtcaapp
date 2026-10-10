// MIMT Affaires for members: my businesses, my extension, the business number, calls shown with the
// business number, and claiming email invitations. No admin screens on mobile: app.mimt.ca has them.
import { isEmergencyNumber, type Extension } from "@mimt/shared";
import { Stack } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Text, View } from "react-native";
import { toErrorKey } from "../../src/api/errors";
import { businessApi } from "../../src/api/features";
import { useSession } from "../../src/auth/session";
import { settingsHeader } from "../../src/components/settingsHeader";
import { Body, Button, Card, ErrorText, Field, Heading, Label, Notice, Row, Screen } from "../../src/components/ui";
import { useI18n, type TKey } from "../../src/i18n";
import { BUSINESS_PORTAL_URL, businessLines, type BusinessLine } from "../../src/lib/business";
import { canPlaceCall, formatPhone } from "../../src/lib/dial";
import { useAsync } from "../../src/lib/useAsync";
import { callService } from "../../src/services/call";
import { colors, spacing } from "../../src/theme";

async function loadLines(userId: string | undefined): Promise<BusinessLine[]> {
  const { businesses } = await businessApi.list();
  const byBusiness: Record<string, Extension[]> = {};
  await Promise.all(
    businesses.map(async ({ business }) => {
      // A member who cannot list extensions still sees the business; only the extension is missing.
      byBusiness[business.id] = await businessApi
        .extensions(business.id)
        .then((r) => r.extensions)
        .catch(() => []);
    }),
  );
  return businessLines(businesses, byBusiness, userId);
}

export default function BusinessScreen() {
  const { t } = useI18n();
  const { me } = useSession();
  const userId = me?.user.id;
  const lines = useAsync(() => loadLines(userId), [userId]);
  const [claiming, setClaiming] = useState(false);
  const [claimInfo, setClaimInfo] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<TKey | null>(null);

  async function claim() {
    setClaiming(true);
    setClaimInfo(null);
    setErrorKey(null);
    try {
      const { claimed } = await businessApi.claimInvites();
      setClaimInfo(claimed.length ? t("business.claimed", { count: claimed.length }) : t("business.claimedNone"));
      if (claimed.length) await lines.reload();
    } catch (e) {
      setErrorKey(toErrorKey(e));
    } finally {
      setClaiming(false);
    }
  }

  return (
    <Screen edges={["bottom"]}>
      <Stack.Screen options={{ ...settingsHeader, title: t("business.title"), headerBackTitle: t("common.back") }} />
      {lines.errorKey ? <ErrorText>{t(lines.errorKey)}</ErrorText> : null}
      {!lines.loading && lines.data?.length === 0 ? <Body muted>{t("business.empty")}</Body> : null}
      {(lines.data ?? []).map((line) => (
        <BusinessCard key={line.businessId} line={line} />
      ))}

      <Card>
        <Body muted>{t("business.claimHint")}</Body>
        <Button icon="mail-open" variant="secondary" label={t("business.claim")} loading={claiming} onPress={claim} />
        {claimInfo ? <Notice tone="success">{claimInfo}</Notice> : null}
        {errorKey ? <ErrorText>{t(errorKey)}</ErrorText> : null}
      </Card>

      <Card>
        <Row
          icon="desktop"
          title={t("business.portal")}
          subtitle={t("business.portalHint")}
          onPress={() => WebBrowser.openBrowserAsync(BUSINESS_PORTAL_URL)}
        />
      </Card>
    </Screen>
  );
}

function BusinessCard({ line }: { line: BusinessLine }) {
  const { t } = useI18n();
  const { me } = useSession();
  const [input, setInput] = useState("");
  const [errorKey, setErrorKey] = useState<TKey | null>(null);

  async function call() {
    setErrorKey(null);
    // Same gate as the keypad; 9-1-1 is always allowed and connect() never sends a business caller ID for it.
    if (!canPlaceCall(input, me?.e911)) {
      const e911Missing = !isEmergencyNumber(input) && !!me && !(me.e911.addressRegistered && me.e911.noticeAccepted);
      return setErrorKey(e911Missing ? "calls.blockedNoE911" : "messages.invalidTo");
    }
    await callService.connect(input, { callerId: line.callerId });
  }

  return (
    <Card>
      <Heading>{line.name}</Heading>
      <Body muted>{t(`business.role.${line.role}`)}</Body>
      <View style={{ marginTop: spacing.sm }}>
        <Text style={{ color: colors.cyan, fontSize: 20, fontWeight: "700" }}>
          {line.extension ? t("business.extension", { number: line.extension }) : t("business.noExtension")}
        </Text>
      </View>
      {line.mainNumber ? (
        <View style={{ marginTop: spacing.sm }}>
          <Label>{t("business.mainNumber").toUpperCase()}</Label>
          <Body>{formatPhone(line.mainNumber)}</Body>
        </View>
      ) : null}
      {line.callerId ? (
        <View style={{ marginTop: spacing.md }}>
          <Field
            label={t("business.dial")}
            value={input}
            onChangeText={setInput}
            keyboardType="phone-pad"
            placeholder={t("messages.toPlaceholder")}
          />
          <Button
            icon="call"
            variant="success"
            label={t("business.callAs", { name: line.name })}
            hint={t("business.callAsHint", { number: formatPhone(line.callerId) })}
            disabled={!input.trim()}
            onPress={call}
          />
          <Body muted>{t("business.callAsHint", { number: formatPhone(line.callerId) })}</Body>
          {errorKey ? <ErrorText>{t(errorKey)}</ErrorText> : null}
        </View>
      ) : (
        <Notice>{t("business.noCallerId")}</Notice>
      )}
      <Body muted style={{ marginTop: spacing.sm }}>
        {t("business.emergencyNote")}
      </Body>
    </Card>
  );
}
