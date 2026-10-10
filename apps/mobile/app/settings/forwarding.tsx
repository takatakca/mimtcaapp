import {
  FORWARDING_TIMEOUT_DEFAULT_S,
  FORWARDING_TIMEOUT_MAX_S,
  FORWARDING_TIMEOUT_MIN_S,
  planHas,
} from "@mimt/shared";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../../src/api/client";
import { toErrorKey } from "../../src/api/errors";
import type { ForwardingMode } from "../../src/api/types";
import { useSession } from "../../src/auth/session";
import { Body, Button, Card, ErrorText, Field, Label, Notice, Screen } from "../../src/components/ui";
import { useI18n, type TKey } from "../../src/i18n";
import { formatPhone } from "../../src/lib/dial";
import { colors, radius, spacing, TAP } from "../../src/theme";

const MODES: { mode: ForwardingMode; key: TKey }[] = [
  { mode: "off", key: "forwarding.modeOff" },
  { mode: "always", key: "forwarding.modeAlways" },
  { mode: "no_answer", key: "forwarding.modeNoAnswer" },
];
const STEP_S = 5;

/** Consumer call forwarding (Premium and Business): always, or after the app rings unanswered. */
export default function Forwarding() {
  const { t } = useI18n();
  const { me, refreshMe } = useSession();
  const current = me?.callSettings?.forwarding;
  const [mode, setMode] = useState<ForwardingMode>(current?.mode ?? "off");
  const [target, setTarget] = useState(current?.target ? formatPhone(current.target) : "");
  const [timeoutS, setTimeoutS] = useState(current?.timeoutS ?? FORWARDING_TIMEOUT_DEFAULT_S);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<TKey | null>(null);
  const [saved, setSaved] = useState(false);
  const allowed = !!me && planHas(me.account.plan, "call_forwarding");

  useEffect(() => {
    if (!current) return;
    setMode(current.mode);
    setTarget(current.target ? formatPhone(current.target) : "");
    setTimeoutS(current.timeoutS);
  }, [current?.mode, current?.target, current?.timeoutS]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setBusy(true);
    setErrorKey(null);
    setSaved(false);
    try {
      await api.updateMe({ forwarding: { mode, ...(target.trim() ? { target: target.trim() } : {}), timeoutS } });
      await refreshMe();
      setSaved(true);
    } catch (e) {
      setErrorKey(toErrorKey(e));
    } finally {
      setBusy(false);
    }
  }

  const bump = (delta: number) =>
    setTimeoutS((s) => Math.min(FORWARDING_TIMEOUT_MAX_S, Math.max(FORWARDING_TIMEOUT_MIN_S, s + delta)));

  return (
    <Screen edges={["bottom"]}>
      <Stack.Screen options={{ title: t("forwarding.title"), headerBackTitle: t("common.back") }} />
      <Body muted>{t("forwarding.intro")}</Body>
      {!allowed ? <Notice tone="warning">{t("forwarding.premium")}</Notice> : null}

      <Card>
        <Label>{t("forwarding.mode").toUpperCase()}</Label>
        <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel={t("forwarding.mode")}>
          {MODES.map(({ mode: m, key }) => (
            <Pressable
              key={m}
              accessibilityRole="radio"
              accessibilityState={{ selected: mode === m, disabled: !allowed && m !== "off" }}
              accessibilityLabel={t(key)}
              disabled={!allowed && m !== "off"}
              onPress={() => setMode(m)}
              style={[styles.option, mode === m && styles.optionOn, !allowed && m !== "off" && { opacity: 0.4 }]}
            >
              <Text style={[styles.optionText, mode === m && { color: colors.navy }]}>{t(key)}</Text>
            </Pressable>
          ))}
        </View>

        {mode !== "off" ? (
          <View style={{ marginTop: spacing.md }}>
            <Field
              label={t("forwarding.target")}
              placeholder={t("blocks.numberPlaceholder")}
              value={target}
              onChangeText={setTarget}
              keyboardType="phone-pad"
            />
          </View>
        ) : null}

        {mode === "no_answer" ? (
          <View style={styles.stepper}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`− ${STEP_S} s`}
              onPress={() => bump(-STEP_S)}
              style={styles.stepButton}
            >
              <Text style={styles.stepText}>−</Text>
            </Pressable>
            <Text style={styles.stepLabel} accessibilityLiveRegion="polite">
              {t("forwarding.timeout", { seconds: timeoutS })}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`+ ${STEP_S} s`}
              onPress={() => bump(STEP_S)}
              style={styles.stepButton}
            >
              <Text style={styles.stepText}>+</Text>
            </Pressable>
          </View>
        ) : null}

        <Button icon="save" label={t("common.save")} loading={busy} disabled={!allowed && mode !== "off"} onPress={save} />
      </Card>

      {errorKey ? <ErrorText>{t(errorKey)}</ErrorText> : null}
      {saved ? <Notice tone="success">{t("forwarding.saved")}</Notice> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  option: {
    flexGrow: 1,
    minHeight: TAP,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  optionOn: { backgroundColor: colors.electric, borderColor: colors.electric },
  optionText: { color: colors.white, fontWeight: "700", fontSize: 16, textAlign: "center" },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  stepButton: {
    width: TAP,
    height: TAP,
    borderRadius: TAP / 2,
    backgroundColor: colors.midnightRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { color: colors.white, fontSize: 24, fontWeight: "700" },
  stepLabel: { flex: 1, color: colors.white, fontSize: 16, textAlign: "center" },
});
