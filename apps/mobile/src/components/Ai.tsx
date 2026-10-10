// AI (Claude) UI pieces used by existing screens: spam badge, voicemail summary, smart replies.
// Every piece hides itself when GET /v1/ai/status says AI is not configured (docs/MIMT-AI.md).
// Labels never block anything; replies are never sent automatically.
import type { SpamLabel, VoicemailDto, VoicemailInsight } from "@mimt/shared";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { aiErrorKey, aiFailure, spamKey, VOICEMAIL_SPAM_THRESHOLD } from "../api/ai";
import { aiApi } from "../api/features";
import { useI18n, type TKey } from "../i18n";
import { patchAiStatus, useAiStatus } from "../lib/useAiStatus";
import { colors, radius, spacing, TAP } from "../theme";
import { Body, Button, ErrorText, Label, Notice } from "./ui";

/** « Spam probable » / « Fraude probable ». Amber = status colour; it never blocks the call or text. */
export function SpamBadge({ label }: { label: SpamLabel | null | undefined }) {
  const { t } = useI18n();
  const key = spamKey(label);
  if (!key) return null;
  return (
    <View accessibilityRole="text" accessibilityLabel={t(key)} style={styles.badge}>
      <Ionicons name="warning" size={14} color={colors.warning} />
      <Text style={styles.badgeText}>{t(key)}</Text>
    </View>
  );
}

/** Text form for places that only take strings (Row subtitles). */
export function useSpamText() {
  const { t } = useI18n();
  return (label: SpamLabel | null | undefined): string | null => {
    const key = spamKey(label);
    return key ? t(key) : null;
  };
}

/** Shows the AI summary of a voicemail, or a « Résumer » button when there is a transcript and none yet. */
export function VoicemailAiSummary({ vm }: { vm: VoicemailDto }) {
  const { t } = useI18n();
  const router = useRouter();
  const ai = useAiStatus();
  const [insight, setInsight] = useState<VoicemailInsight | undefined>(vm.ai);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<TKey | null>(null);
  const [needsConsent, setNeedsConsent] = useState(false);

  useEffect(() => setInsight(vm.ai), [vm.ai]);

  async function summarize() {
    setBusy(true);
    setErrorKey(null);
    try {
      const updated = await aiApi.summarizeVoicemail(vm.id);
      setInsight(updated.ai);
      if (!updated.ai) setErrorKey("ai.error.unavailable");
    } catch (e) {
      const failure = aiFailure(e);
      if (failure === "hide") patchAiStatus({ configured: false });
      if (failure === "needs_consent") {
        setNeedsConsent(true);
        patchAiStatus({ consent: false });
      }
      setErrorKey(aiErrorKey(e));
    } finally {
      setBusy(false);
    }
  }

  if (insight) {
    return (
      <View style={styles.summary}>
        <Label>{t("ai.voicemail.summary").toUpperCase()}</Label>
        <View style={styles.tags}>
          {insight.spamLikelihood >= VOICEMAIL_SPAM_THRESHOLD ? <SpamBadge label="spam" /> : null}
          {insight.urgency === "high" ? <Tag icon="alert-circle" text={t("ai.voicemail.urgent")} /> : null}
          {insight.callbackSuggested ? <Tag icon="call" text={t("ai.voicemail.callback")} /> : null}
        </View>
        <Body>{insight.summary}</Body>
        {insight.callerIntent ? <Body muted>{t("ai.voicemail.intent", { intent: insight.callerIntent })}</Body> : null}
        <Text style={styles.disclaimer}>{t("ai.voicemail.disclaimer")}</Text>
      </View>
    );
  }

  // No AI on the server, or nothing to summarize: show nothing.
  if (!ai.ui.visible || !vm.transcript) return null;
  return (
    <View style={{ marginTop: spacing.sm }}>
      <Button icon="sparkles" variant="secondary" label={t("ai.voicemail.summarize")} loading={busy} onPress={summarize} />
      {errorKey ? <ErrorText>{t(errorKey)}</ErrorText> : null}
      {needsConsent ? (
        <Button variant="ghost" icon="shield-checkmark" label={t("ai.entry")} onPress={() => router.push("/settings/ai")} />
      ) : null}
    </View>
  );
}

function Tag({ icon, text }: { icon: "alert-circle" | "call"; text: string }) {
  return (
    <View style={styles.tag}>
      <Ionicons name={icon} size={14} color={colors.cyan} />
      <Text style={styles.tagText}>{text}</Text>
    </View>
  );
}

/**
 * Smart reply chips above the composer. Loads when the last message is inbound (lastInboundId) and the
 * user consented; tapping a chip only fills the draft. Without consent: a link to the consent screen.
 */
export function SmartReplies({ peer, lastInboundId, onPick }: { peer: string; lastInboundId: string | null; onPick: (text: string) => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const ai = useAiStatus();
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<TKey | null>(null);
  const usable = ai.ui.usable;

  useEffect(() => {
    setSuggestions([]);
    setErrorKey(null);
    if (!usable || !lastInboundId) return;
    let alive = true;
    setBusy(true);
    aiApi
      .suggestions(peer)
      .then((r) => alive && setSuggestions(r.suggestions.slice(0, 3)))
      .catch((e) => {
        if (!alive) return;
        const failure = aiFailure(e);
        if (failure === "hide") patchAiStatus({ configured: false });
        else if (failure === "needs_consent") patchAiStatus({ consent: false });
        else setErrorKey(aiErrorKey(e));
      })
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [peer, lastInboundId, usable]);

  if (!ai.ui.visible || !lastInboundId) return null;
  if (ai.ui.needsConsent) {
    return (
      <Pressable accessibilityRole="button" onPress={() => router.push("/settings/ai")} style={styles.enable}>
        <Ionicons name="sparkles" size={16} color={colors.electric} />
        <Text style={styles.enableText}>{t("ai.replies.enable")}</Text>
      </Pressable>
    );
  }
  if (ai.ui.budgetExhausted) return null;
  if (busy) return <ActivityIndicator style={{ marginVertical: spacing.xs }} color={colors.electric} />;
  if (errorKey) {
    return (
      <View style={{ paddingHorizontal: spacing.md }}>
        <Notice tone="warning">{t(errorKey)}</Notice>
      </View>
    );
  }
  if (!suggestions.length) return null;
  return (
    <View accessibilityLabel={t("ai.replies.title")}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
        {suggestions.map((s, i) => (
          <Pressable
            key={`${i}-${s}`}
            accessibilityRole="button"
            accessibilityLabel={t("ai.replies.use", { text: s })}
            accessibilityHint={t("ai.replies.hint")}
            onPress={() => onPick(s)}
            style={({ pressed }) => [styles.chip, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.chipText} numberOfLines={2}>
              {s}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginTop: 2,
  },
  badgeText: { color: colors.warning, fontSize: 13, fontWeight: "700" },
  summary: { marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.midnightRaised },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginBottom: spacing.xs },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  tagText: { color: colors.white, fontSize: 13, fontWeight: "600" },
  disclaimer: { color: colors.silver, fontSize: 12, marginTop: spacing.xs },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  chip: {
    minHeight: TAP - 8,
    maxWidth: 260,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.electric,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipText: { color: colors.white, fontSize: 15 },
  enable: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: TAP, paddingHorizontal: spacing.md },
  enableText: { color: colors.electric, fontSize: 15, fontWeight: "600" },
});
