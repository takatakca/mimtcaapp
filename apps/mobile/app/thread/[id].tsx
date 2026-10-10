import { Ionicons } from "@expo/vector-icons";
import { planHas } from "@mimt/shared";
import * as ImagePicker from "expo-image-picker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../../src/api/client";
import { toErrorKey } from "../../src/api/errors";
import type { MessageDto } from "../../src/api/types";
import { useSession } from "../../src/auth/session";
import { Button, ErrorText, Field, Notice } from "../../src/components/ui";
import { useI18n, type TKey } from "../../src/i18n";
import { canBlock, isBlockedPeer } from "../../src/lib/callControls";
import { formatPhone, toDialable } from "../../src/lib/dial";
import { formatWhen } from "../../src/lib/format";
import { confirmBlockToggle } from "../../src/services/blocks";
import { callService } from "../../src/services/call";
import { colors, radius, spacing, TAP } from "../../src/theme";

/** A message as shown in the thread: the API DTO, plus local-only fields for optimistic sends. */
type ThreadMessage = MessageDto & { mediaUrls?: string[] };

/** The API pages newest first; the thread shows oldest first. */
const chronological = (list: MessageDto[]) => [...list].reverse();

/** Conversation thread. Route "/thread/new" starts a new conversation with a "To" field. */
export default function Thread() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { me } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === "new";
  const [to, setTo] = useState("");
  const peer = isNew ? toDialable(to) : decodeURIComponent(id ?? "");
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [errorKey, setErrorKey] = useState<TKey | null>(null);
  const [mmsHint, setMmsHint] = useState(false);
  const listRef = useRef<FlatList<ThreadMessage>>(null);
  const stickToEnd = useRef(true);
  const canMms = !!me && planHas(me.account.plan, "mms");
  const from = me?.numbers[0]?.e164;
  const [blocked, setBlocked] = useState(false);
  const [info, setInfo] = useState<TKey | null>(null);

  useEffect(() => {
    if (isNew || !peer || !canBlock(peer)) return;
    api
      .blocks()
      .then((r) => setBlocked(isBlockedPeer(r.blocks, peer)))
      .catch(() => undefined);
  }, [isNew, peer]);

  /** Thread menu: "Bloquer" / "Débloquer" (never offered for 9-1-1). */
  async function toggleBlock() {
    if (!peer) return;
    const key = await confirmBlockToggle(t, peer, blocked);
    if (!key) return;
    setInfo(key);
    if (key === "blocks.blocked" || key === "blocks.unblocked") setBlocked(key === "blocks.blocked");
  }

  useEffect(() => {
    if (isNew || !peer) return;
    api
      .messages(peer)
      .then((r) => {
        stickToEnd.current = true;
        setMessages(chronological(r.messages));
        setOlderCursor(r.nextCursor);
      })
      .catch((e) => setErrorKey(toErrorKey(e)));
  }, [isNew, peer]);

  async function loadOlder() {
    if (!peer || !olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const r = await api.messages(peer, olderCursor);
      stickToEnd.current = false;
      setMessages((m) => [...chronological(r.messages), ...m]);
      setOlderCursor(r.nextCursor);
    } catch (e) {
      setErrorKey(toErrorKey(e));
    } finally {
      setLoadingOlder(false);
    }
  }

  async function send(body: string, mediaUrls?: string[], retryId?: string) {
    if (!peer || peer === "911") return setErrorKey("messages.invalidTo");
    if (!from || (!body.trim() && !mediaUrls?.length)) return;
    const tempId = retryId ?? `local-${Date.now()}`;
    const optimistic: ThreadMessage = {
      id: tempId,
      direction: "outbound",
      ourNumber: from,
      peer,
      body,
      status: "queued",
      segments: 1,
      numMedia: mediaUrls?.length ?? 0,
      createdAt: new Date().toISOString(),
      ...(mediaUrls ? { mediaUrls } : {}),
    };
    stickToEnd.current = true;
    setMessages((m) => [...m.filter((x) => x.id !== tempId), optimistic]);
    setDraft("");
    setErrorKey(null);
    try {
      const sent = await api.sendMessage({ from, to: peer, body, ...(mediaUrls ? { mediaUrls } : {}) });
      setMessages((m) => m.map((x) => (x.id === tempId ? sent : x)));
      if (isNew) router.replace(`/thread/${encodeURIComponent(peer)}`);
    } catch (e) {
      setErrorKey(toErrorKey(e));
      setMessages((m) => m.map((x) => (x.id === tempId ? { ...x, status: "failed" } : x)));
    }
  }

  async function attach() {
    if (!canMms) return setMmsHint(true);
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (picked.canceled || !picked.assets[0]) return;
    // TODO(api): upload the image (POST /v1/messages/media → signed URL) and send its URL.
    // Until the upload endpoint exists, MMS cannot be sent.
    setErrorKey("error.featureRequired");
  }

  return (
    <SafeAreaView style={styles.screen} edges={["bottom"]}>
      <Stack.Screen
        options={{
          title: isNew ? t("messages.new") : formatPhone(peer ?? ""),
          headerBackTitle: t("common.back"),
          headerRight: () =>
            !isNew && peer ? (
              <View style={{ flexDirection: "row" }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("messages.call")}
                  onPress={() => callService.connect(peer)}
                  style={styles.headerButton}
                >
                  <Ionicons name="call" size={24} color={colors.electric} />
                </Pressable>
                {canBlock(peer) ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t(blocked ? "blocks.unblock" : "blocks.block")}
                    onPress={toggleBlock}
                    style={styles.headerButton}
                  >
                    <Ionicons name={blocked ? "checkmark-circle" : "ban"} size={24} color={blocked ? colors.electric : colors.silver} />
                  </Pressable>
                ) : null}
              </View>
            ) : null,
        }}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
        {isNew ? (
          <View style={{ padding: spacing.md }}>
            <Field
              label={t("messages.to")}
              placeholder={t("messages.toPlaceholder")}
              value={to}
              onChangeText={setTo}
              keyboardType="phone-pad"
              autoFocus
            />
          </View>
        ) : null}
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}
          onContentSizeChange={() => stickToEnd.current && listRef.current?.scrollToEnd({ animated: false })}
          ListHeaderComponent={
            olderCursor ? (
              <Button variant="ghost" icon="time" label={t("messages.loadEarlier")} loading={loadingOlder} onPress={loadOlder} />
            ) : null
          }
          renderItem={({ item }) => {
            const mine = item.direction === "outbound";
            // Twilio reports "failed" or "undelivered"; "queued" from the API means accepted, only local drafts are still sending.
            const failed = item.status === "failed" || item.status === "undelivered";
            const sending = item.id.startsWith("local-") && item.status === "queued";
            return (
              <Pressable
                accessibilityRole={failed ? "button" : "text"}
                accessibilityLabel={`${item.body}. ${formatWhen(item.createdAt, locale, t)}${failed ? `. ${t("messages.failed")}` : ""}`}
                disabled={!failed}
                onPress={() => send(item.body, item.mediaUrls, item.id)}
                style={[styles.bubble, mine ? styles.mine : styles.theirs, failed && { borderColor: colors.danger, borderWidth: 1 }]}
              >
                <Text style={[styles.bubbleText, mine && { color: colors.white }]}>{item.body}</Text>
                <Text style={styles.meta}>
                  {sending
                    ? t("messages.sending")
                    : failed
                      ? t("messages.failed")
                      : formatWhen(item.createdAt, locale, t)}
                </Text>
              </Pressable>
            );
          }}
        />
        {blocked ? <Notice tone="warning">{t("blocks.isBlocked")}</Notice> : null}
        {info ? <Notice tone={info.startsWith("error.") ? "warning" : "success"}>{t(info)}</Notice> : null}
        {mmsHint ? <Notice>{t("messages.attachPremium")}</Notice> : null}
        {errorKey ? (
          <View style={{ paddingHorizontal: spacing.md }}>
            <ErrorText>{t(errorKey)}</ErrorText>
          </View>
        ) : null}
        <View style={styles.composer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={canMms ? t("messages.attach") : t("messages.attachPremium")}
            onPress={attach}
            style={styles.iconButton}
          >
            <Ionicons name="image" size={26} color={canMms ? colors.electric : colors.silver} />
          </Pressable>
          <TextInput
            accessibilityLabel={t("messages.placeholder")}
            placeholder={t("messages.placeholder")}
            placeholderTextColor="#6F7F99"
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={1600}
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("messages.send")}
            accessibilityState={{ disabled: !draft.trim() || !peer }}
            disabled={!draft.trim() || !peer}
            onPress={() => send(draft.trim())}
            style={[styles.send, (!draft.trim() || !peer) && { opacity: 0.4 }]}
          >
            <Ionicons name="send" size={22} color={colors.white} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.navy },
  headerButton: { width: TAP, height: TAP, alignItems: "center", justifyContent: "center" },
  bubble: { maxWidth: "80%", borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  mine: { alignSelf: "flex-end", backgroundColor: colors.brandBlue, borderBottomRightRadius: 4 },
  theirs: { alignSelf: "flex-start", backgroundColor: colors.midnightRaised, borderBottomLeftRadius: 4 },
  bubbleText: { color: colors.white, fontSize: 17, lineHeight: 23 },
  meta: { color: colors.silver, fontSize: 12, marginTop: 2, alignSelf: "flex-end" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    padding: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.midnight,
  },
  iconButton: { width: TAP, height: TAP, alignItems: "center", justifyContent: "center" },
  input: {
    flex: 1,
    minHeight: TAP,
    maxHeight: 140,
    color: colors.white,
    fontSize: 17,
    backgroundColor: colors.navy,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingTop: 12,
    paddingBottom: 12,
  },
  send: { width: TAP, height: TAP, borderRadius: TAP / 2, backgroundColor: colors.brandBlue, alignItems: "center", justifyContent: "center" },
});
