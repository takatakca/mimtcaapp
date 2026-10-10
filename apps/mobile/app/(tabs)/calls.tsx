import { Ionicons } from "@expo/vector-icons";
import { isEmergencyNumber, type RateResponse } from "@mimt/shared";
import * as Contacts from "expo-contacts/legacy";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { api } from "../../src/api/client";
import type { CallRecord } from "../../src/api/types";
import { useSession } from "../../src/auth/session";
import { AdBanner } from "../../src/components/Ads";
import { DialPad } from "../../src/components/DialPad";
import { RoundButton } from "../../src/components/RoundButton";
import { EmergencyBanner } from "../../src/components/EmergencyBanner";
import { Body, ErrorText, Notice, Row, Screen, Title } from "../../src/components/ui";
import { useI18n, type TKey } from "../../src/i18n";
import { canPlaceCall, formatAsYouType, formatPhone, normalizeDialInput, rateQuoteTarget } from "../../src/lib/dial";
import { rateNotice } from "../../src/lib/rates";
import { formatDuration, formatWhen } from "../../src/lib/format";
import { useAsync } from "../../src/lib/useAsync";
import { callService } from "../../src/services/call";
import { colors, radius, spacing, TAP } from "../../src/theme";

export default function Calls() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"keypad" | "recents">("keypad");
  return (
    <Screen scroll={false} edges={["top"]}>
      <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.md }}>
        <Title>{t("calls.title")}</Title>
        <View style={styles.segment} accessibilityRole="tablist">
          {(["keypad", "recents"] as const).map((k) => (
            <Pressable
              key={k}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === k }}
              accessibilityLabel={t(k === "keypad" ? "calls.keypad" : "calls.recents")}
              onPress={() => setTab(k)}
              style={[styles.segmentItem, tab === k && styles.segmentOn]}
            >
              <Text style={[styles.segmentText, tab === k && { color: colors.navy }]}>
                {t(k === "keypad" ? "calls.keypad" : "calls.recents")}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      {tab === "keypad" ? <Keypad /> : <Recents />}
      <AdBanner />
    </Screen>
  );
}

/** Asks GET /v1/rates once typing pauses on a complete number; null while typing or for Canada/US. */
function useRateQuote(input: string): { rate: RateResponse | null; loading: boolean } {
  const target = rateQuoteTarget(input);
  const [rate, setRate] = useState<RateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setRate(null);
    if (!target) return setLoading(false);
    let alive = true;
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .rate(target)
        .then((r) => alive && setRate(r))
        .catch(() => undefined) // No rate line on error: the server still enforces credit and destinations.
        .finally(() => alive && setLoading(false));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [target]);
  return { rate, loading };
}

function Keypad() {
  const { t, lang } = useI18n();
  const { me } = useSession();
  const [input, setInput] = useState("");
  const [errorKey, setErrorKey] = useState<TKey | null>(null);
  const emergency = isEmergencyNumber(input);
  const allowed = canPlaceCall(input, me?.e911);
  const blockedByE911 = !emergency && !!input && !!me && !(me.e911.addressRegistered && me.e911.noticeAccepted);
  const quote = useRateQuote(emergency ? "" : input);
  const notice = quote.rate ? rateNotice(quote.rate, lang) : null;

  async function pickContact() {
    setErrorKey(null);
    const { granted } = await Contacts.requestPermissionsAsync();
    if (!granted) return setErrorKey("contacts.denied");
    const contact = await Contacts.presentContactPickerAsync();
    const number = contact?.phoneNumbers?.[0]?.number;
    if (contact && !number) return setErrorKey("calls.noPhone");
    if (number) setInput(normalizeDialInput(number));
  }

  async function call() {
    setErrorKey(null);
    // 9-1-1 is never blocked: canPlaceCall() returns true for it whatever the plan or onboarding state.
    if (!allowed) return setErrorKey(blockedByE911 ? "calls.blockedNoE911" : "messages.invalidTo");
    await callService.connect(input);
  }

  return (
    <View style={styles.keypad}>
      {emergency ? <EmergencyBanner /> : null}
      <Text
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
        style={styles.display}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {formatAsYouType(input) || " "}
      </Text>
      {blockedByE911 ? <Notice tone="warning">{t("calls.blockedNoE911")}</Notice> : null}
      {notice ? (
        <Notice tone={notice.tone === "warning" ? "warning" : "info"}>
          {notice.lines.map((l) => t(l.key, l.vars)).join("\n")}
        </Notice>
      ) : quote.loading && input.startsWith("+") ? (
        <Body muted style={{ textAlign: "center" }}>{t("calls.rateLoading")}</Body>
      ) : null}
      {errorKey ? <ErrorText>{t(errorKey)}</ErrorText> : null}
      <DialPad onKey={(k) => setInput((v) => normalizeDialInput(v + k).slice(0, 16))} />
      <View style={styles.actions}>
        <RoundButton icon="people" label={t("calls.contacts")} onPress={pickContact} />
        <RoundButton
          icon="call"
          label={input ? t("calls.callNumber", { number: formatPhone(input) }) : t("calls.call")}
          onPress={call}
          color={emergency ? colors.danger : colors.success}
          big
        />
        <RoundButton icon="backspace" label={t("calls.delete")} onPress={() => setInput((v) => v.slice(0, -1))} />
      </View>
    </View>
  );
}

function Recents() {
  const { t, locale } = useI18n();
  const router = useRouter();
  // First page on focus; older pages are appended as the list scrolls (GET /v1/calls?cursor=).
  const list = useAsync(() => api.calls());
  const [loadingMore, setLoadingMore] = useState(false);
  useFocusEffect(useCallback(() => void list.reload(), [list.reload]));

  async function loadMore() {
    const current = list.data;
    if (!current?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await api.calls(current.nextCursor);
      list.setData({ calls: [...current.calls, ...next.calls], nextCursor: next.nextCursor });
    } catch {
      // Keep what is shown; pull-to-refresh retries.
    } finally {
      setLoadingMore(false);
    }
  }

  const renderItem = ({ item }: { item: CallRecord }) => {
    const kind = item.missed ? t("calls.missed") : t(item.direction === "inbound" ? "calls.incoming" : "calls.outgoing");
    return (
      <Row
        icon={item.missed ? "call-outline" : item.direction === "inbound" ? "arrow-down" : "arrow-up"}
        danger={item.missed}
        title={formatPhone(item.peer)}
        subtitle={`${kind} · ${formatWhen(item.startedAt, locale, t)}${item.durationS ? ` · ${formatDuration(item.durationS)}` : ""}`}
        label={`${t("calls.callNumber", { number: formatPhone(item.peer) })}. ${kind}`}
        onPress={() => callService.connect(item.peer)}
        right={
          item.kind === "emergency" ? undefined : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("contacts.text", { name: formatPhone(item.peer) })}
            onPress={() => router.push(`/thread/${encodeURIComponent(item.peer)}`)}
            style={styles.iconButton}
          >
            <Ionicons name="chatbubble" size={22} color={colors.electric} />
          </Pressable>
          )
        }
      />
    );
  };

  return (
    <FlatList
      data={list.data?.calls ?? []}
      keyExtractor={(c) => c.id}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      renderItem={renderItem}
      contentContainerStyle={{ padding: spacing.md }}
      refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.reload} tintColor={colors.electric} />}
      ListHeaderComponent={list.errorKey ? <ErrorText>{t(list.errorKey)}</ErrorText> : null}
      ListEmptyComponent={!list.loading ? <Body muted>{t("calls.empty")}</Body> : null}
    />
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: "row", backgroundColor: colors.midnight, borderRadius: radius.pill, padding: 4, marginBottom: spacing.sm },
  segmentItem: { flex: 1, minHeight: TAP - 4, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  segmentOn: { backgroundColor: colors.electric },
  segmentText: { color: colors.white, fontWeight: "700", fontSize: 16 },
  keypad: { flex: 1, paddingHorizontal: spacing.md, justifyContent: "center" },
  display: { color: colors.white, fontSize: 36, fontWeight: "600", textAlign: "center", marginVertical: spacing.md },
  actions: { flexDirection: "row", justifyContent: "space-around", alignItems: "center", marginTop: spacing.lg },
  iconButton: { width: TAP, height: TAP, alignItems: "center", justifyContent: "center" },
});
