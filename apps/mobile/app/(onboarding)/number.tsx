import { QUEBEC_AREA_CODES } from "@mimt/shared";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../../src/api/client";
import { toErrorKey } from "../../src/api/errors";
import { useSession } from "../../src/auth/session";
import { Body, Button, Card, ErrorText, Heading, Label, Loading, Row, Screen, Title } from "../../src/components/ui";
import { useI18n, type TKey } from "../../src/i18n";
import { formatPhone } from "../../src/lib/dial";
import { sortAreaCodes } from "../../src/lib/onboarding";
import { useAsync } from "../../src/lib/useAsync";
import { STORE_MODE } from "../../src/services/iap";
import { colors, radius, spacing, TAP } from "../../src/theme";

const AREA_CODES = sortAreaCodes(QUEBEC_AREA_CODES);

export default function ChooseNumber() {
  const { t } = useI18n();
  const router = useRouter();
  const { refreshMe } = useSession();
  const [areaCode, setAreaCode] = useState(AREA_CODES[0] ?? "514");
  const [claimError, setClaimError] = useState<TKey | null>(null);
  const available = useAsync(() => api.availableNumbers(areaCode), [areaCode]);

  async function claim(e164: string) {
    setClaimError(null);
    try {
      await api.claimNumber(e164);
      await refreshMe();
      router.replace({ pathname: "/done", params: { number: e164 } });
    } catch (e) {
      setClaimError(toErrorKey(e));
      available.reload();
    }
  }

  function confirm(e164: string) {
    Alert.alert(t("number.title"), t("number.confirm", { number: formatPhone(e164) }), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("number.choose"), onPress: () => claim(e164) },
    ]);
  }

  const numbers = available.data?.numbers ?? [];
  return (
    <Screen>
      <Title>{t("number.title")}</Title>
      <Label>{t("number.areaCode")}</Label>
      <View style={styles.codes} accessibilityRole="radiogroup" accessibilityLabel={t("number.areaCode")}>
        {AREA_CODES.map((code) => (
          <Pressable
            key={code}
            accessibilityRole="radio"
            accessibilityLabel={code.split("").join(" ")}
            accessibilityState={{ selected: code === areaCode }}
            onPress={() => setAreaCode(code)}
            style={[styles.code, code === areaCode && styles.codeOn]}
          >
            <Text style={[styles.codeText, code === areaCode && { color: colors.navy }]}>{code}</Text>
          </Pressable>
        ))}
      </View>
      <Heading>{t("number.available")}</Heading>
      {claimError ? <ErrorText>{t(claimError)}</ErrorText> : null}
      {/* Companion builds sell nothing and point nowhere (App Review 3.1.3(f)): the button exists only with in-app purchase. */}
      {claimError === "error.numberNeedsPlan" && STORE_MODE === "iap" ? (
        <Button icon="arrow-up-circle" label={t("number.seePlans")} onPress={() => router.replace("/account")} />
      ) : null}
      {available.loading ? <Loading label={t("common.loading")} /> : null}
      {available.errorKey ? <ErrorText>{t(available.errorKey)}</ErrorText> : null}
      {!available.loading && !available.errorKey && numbers.length === 0 ? <Body muted>{t("number.none")}</Body> : null}
      <Card>
        {numbers.map((n) => (
          <Row
            key={n.e164}
            icon="call"
            title={formatPhone(n.e164)}
            subtitle={n.locality ?? undefined}
            label={`${t("number.choose")} ${formatPhone(n.e164)}`}
            onPress={() => confirm(n.e164)}
          />
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  codes: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  code: {
    minHeight: TAP,
    minWidth: 72,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  codeOn: { backgroundColor: colors.electric, borderColor: colors.electric },
  codeText: { color: colors.white, fontSize: 18, fontWeight: "700" },
});
