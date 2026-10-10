import { isEmergencyNumber } from "@mimt/shared";
import { Stack } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../../src/api/client";
import { toErrorKey } from "../../src/api/errors";
import type { BlockedCallAction } from "../../src/api/types";
import { useSession } from "../../src/auth/session";
import { Body, Button, Card, ErrorText, Field, Heading, Label, Notice, Row, Screen } from "../../src/components/ui";
import { useI18n, type TKey } from "../../src/i18n";
import { canBlock } from "../../src/lib/callControls";
import { formatPhone } from "../../src/lib/dial";
import { useAsync } from "../../src/lib/useAsync";
import { colors, radius, spacing, TAP } from "../../src/theme";

/** Blocked numbers: list, add, unblock, and what happens to their calls (reject or voicemail). */
export default function BlockedNumbers() {
  const { t } = useI18n();
  const { me, refreshMe } = useSession();
  const list = useAsync(() => api.blocks());
  const [number, setNumber] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<TKey | null>(null);
  const [info, setInfo] = useState<TKey | null>(null);
  const action = me?.callSettings?.blockedCallAction ?? "reject";

  async function run(id: string, fn: () => Promise<TKey | null>) {
    setBusy(id);
    setErrorKey(null);
    setInfo(null);
    try {
      setInfo(await fn());
    } catch (e) {
      setErrorKey(toErrorKey(e));
    } finally {
      setBusy(null);
    }
  }

  const add = () => {
    // 9-1-1 is never blockable; the API refuses it as well.
    if (!canBlock(number)) return setErrorKey(isEmergencyNumber(number) ? "error.cannotBlockEmergency" : "error.validation");
    return run("add", async () => {
      await api.block({ number, ...(label.trim() ? { label: label.trim() } : {}) });
      setNumber("");
      setLabel("");
      await list.reload();
      return "blocks.blocked";
    });
  };

  const unblock = (id: string) =>
    run(`del-${id}`, async () => {
      await api.unblock(id);
      await list.reload();
      return "blocks.unblocked";
    });

  const setAction = (next: BlockedCallAction) =>
    run("action", async () => {
      await api.updateMe({ blockedCallAction: next });
      await refreshMe();
      return null;
    });

  return (
    <Screen edges={["bottom"]}>
      <Stack.Screen options={{ title: t("blocks.title"), headerBackTitle: t("common.back") }} />
      <Body muted>{t("blocks.intro")}</Body>

      <Card>
        <Field
          label={t("blocks.number")}
          placeholder={t("blocks.numberPlaceholder")}
          value={number}
          onChangeText={setNumber}
          keyboardType="phone-pad"
        />
        <Field label={t("blocks.label")} value={label} onChangeText={setLabel} maxLength={80} />
        <Button icon="ban" label={t("blocks.add")} loading={busy === "add"} disabled={!number.trim()} onPress={add} />
      </Card>

      <Card>
        <Label>{t("blocks.action").toUpperCase()}</Label>
        <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel={t("blocks.action")}>
          {(["reject", "voicemail"] as const).map((a) => (
            <Pressable
              key={a}
              accessibilityRole="radio"
              accessibilityState={{ selected: action === a }}
              accessibilityLabel={t(a === "reject" ? "blocks.actionReject" : "blocks.actionVoicemail")}
              onPress={() => setAction(a)}
              style={[styles.option, action === a && styles.optionOn]}
            >
              <Text style={[styles.optionText, action === a && { color: colors.navy }]}>
                {t(a === "reject" ? "blocks.actionReject" : "blocks.actionVoicemail")}
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>

      {errorKey ? <ErrorText>{t(errorKey)}</ErrorText> : null}
      {info ? <Notice tone="success">{t(info)}</Notice> : null}
      {list.errorKey ? <ErrorText>{t(list.errorKey)}</ErrorText> : null}

      <Heading>{t("blocks.title")}</Heading>
      <Card>
        {list.data && list.data.blocks.length === 0 ? <Body muted>{t("blocks.empty")}</Body> : null}
        {list.data?.blocks.map((b) => (
          <Row
            key={b.id}
            icon="ban"
            title={formatPhone(b.e164)}
            {...(b.label ? { subtitle: b.label } : {})}
            right={
              <Button
                variant="ghost"
                label={t("blocks.unblock")}
                loading={busy === `del-${b.id}`}
                onPress={() => unblock(b.id)}
                style={{ minHeight: TAP }}
              />
            }
          />
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: "row", gap: spacing.sm },
  option: {
    flex: 1,
    minHeight: TAP,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  optionOn: { backgroundColor: colors.electric, borderColor: colors.electric },
  optionText: { color: colors.white, fontWeight: "700", fontSize: 16, textAlign: "center" },
});
