// AI features and the Law 25 "ai_processing" consent (docs/MIMT-AI.md §2). Separate, specific and
// optional; withdrawal takes effect immediately on the server. Hidden content when AI is not configured.
import { formatCad } from "@mimt/shared";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Switch } from "react-native";
import { aiErrorKey } from "../../src/api/ai";
import { aiApi } from "../../src/api/features";
import { Body, Card, ErrorText, Heading, Loading, Notice, Row, Screen } from "../../src/components/ui";
import { useI18n, type TKey } from "../../src/i18n";
import { patchAiStatus, useAiStatus } from "../../src/lib/useAiStatus";
import { colors } from "../../src/theme";
import { settingsHeader } from "../../src/components/settingsHeader";

export default function AiSettings() {
  const { t, lang } = useI18n();
  const { status, ui, loaded, refresh } = useAiStatus();
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<TKey | null>(null);
  const [errorKey, setErrorKey] = useState<TKey | null>(null);

  // Always show the server's current consent and budget here.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function setConsent(granted: boolean) {
    setSaving(true);
    setInfo(null);
    setErrorKey(null);
    try {
      await aiApi.setConsent(granted);
      patchAiStatus({ consent: granted });
      setInfo(granted ? "ai.consentGranted" : "ai.consentWithdrawn");
    } catch (e) {
      setErrorKey(aiErrorKey(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen edges={["bottom"]}>
      <Stack.Screen options={{ ...settingsHeader, title: t("ai.title"), headerBackTitle: t("common.back") }} />
      {!loaded ? <Loading label={t("common.loading")} /> : null}
      {loaded && !status?.configured ? <Notice>{t("ai.notConfigured")}</Notice> : null}
      {status?.configured ? (
        <>
          <Body muted>{t("ai.intro")}</Body>
          <Card>
            <Body>{t("ai.features")}</Body>
          </Card>
          <Heading>{t("ai.consentTitle")}</Heading>
          <Card>
            <Body>{t("ai.consentBody")}</Body>
            <Row
              title={t("ai.consentToggle")}
              right={
                <Switch
                  accessibilityLabel={t("ai.consentToggle")}
                  value={status.consent}
                  disabled={saving}
                  trackColor={{ true: colors.electric, false: colors.midnightRaised }}
                  onValueChange={(v) => void setConsent(v)}
                />
              }
            />
          </Card>
          {info ? <Notice tone="success">{t(info)}</Notice> : null}
          {errorKey ? <ErrorText>{t(errorKey)}</ErrorText> : null}
          {ui.planHasAi ? (
            <Body muted>
              {t("ai.budget", {
                used: formatCad(Math.min(status.usedCadCents, status.monthlyBudgetCadCents), lang),
                budget: formatCad(status.monthlyBudgetCadCents, lang),
              })}
            </Body>
          ) : (
            <Notice>{t("ai.noBudget")}</Notice>
          )}
          {ui.budgetExhausted ? <Notice tone="warning">{t("ai.budgetExhausted")}</Notice> : null}
          <Body muted>{t("ai.spamNote")}</Body>
        </>
      ) : null}
    </Screen>
  );
}
