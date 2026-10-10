import { planHas } from "@mimt/shared";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, RefreshControl, View } from "react-native";
import { api } from "../../src/api/client";
import type { VoicemailDto } from "../../src/api/types";
import { useSession } from "../../src/auth/session";
import { Body, Button, Card, ErrorText, Label, Row, Screen, Title } from "../../src/components/ui";
import { useI18n } from "../../src/i18n";
import { formatPhone } from "../../src/lib/dial";
import { formatDuration, formatWhen } from "../../src/lib/format";
import { useAsync } from "../../src/lib/useAsync";
import { callService } from "../../src/services/call";
import { colors, spacing } from "../../src/theme";

export default function VoicemailTab() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const list = useAsync(() => api.voicemails().then((r) => r.voicemails));
  const [openId, setOpenId] = useState<string | null>(null);
  useFocusEffect(useCallback(() => void list.reload(), [list.reload]));

  /** Signed audio URLs are short-lived: refresh the list before opening one that is about to expire. */
  async function toggle(vm: VoicemailDto) {
    if (openId === vm.id) return setOpenId(null);
    const expires = vm.audioUrlExpiresAt ? Date.parse(vm.audioUrlExpiresAt) : Infinity;
    if (expires - Date.now() < 60_000) await list.reload();
    setOpenId(vm.id);
  }

  function remove(vm: VoicemailDto) {
    Alert.alert(t("voicemail.title"), t("voicemail.deleteConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: async () => {
          await api.deleteVoicemail(vm.id).catch(() => undefined);
          list.setData((list.data ?? []).filter((v) => v.id !== vm.id));
        },
      },
    ]);
  }

  return (
    <Screen scroll={false} edges={["top"]}>
      <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.md }}>
        <Title>{t("voicemail.title")}</Title>
        <Button icon="settings" variant="ghost" label={t("voicemail.settings")} onPress={() => router.push("/settings/voicemail")} />
        {list.errorKey ? <ErrorText>{t(list.errorKey)}</ErrorText> : null}
      </View>
      <FlatList
        data={list.data ?? []}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ padding: spacing.md }}
        refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.reload} tintColor={colors.electric} />}
        ListEmptyComponent={!list.loading ? <Body muted>{t("voicemail.empty")}</Body> : null}
        renderItem={({ item }) => (
          <Card>
            <Row
              icon="recording"
              title={item.from ? formatPhone(item.from) : t("voicemail.unknownCaller")}
              subtitle={`${formatWhen(item.createdAt, locale, t)} · ${formatDuration(item.durationS ?? 0)}`}
              onPress={() => void toggle(item)}
            />
            {openId === item.id ? <VoicemailDetail vm={item} onDelete={() => remove(item)} /> : null}
          </Card>
        )}
      />
    </Screen>
  );
}

function VoicemailDetail({ vm, onDelete }: { vm: VoicemailDto; onDelete: () => void }) {
  const { t } = useI18n();
  const { me } = useSession();
  const player = useAudioPlayer(vm.audioUrl);
  const status = useAudioPlayerStatus(player);
  const canTranscribe = !!me && planHas(me.account.plan, "vm_transcription");
  const total = vm.durationS ?? status.duration ?? 0;

  return (
    <View style={{ marginTop: spacing.sm }}>
      {vm.audioUrl ? (
        <Button
          icon={status.playing ? "pause" : "play"}
          label={`${status.playing ? t("voicemail.pause") : t("voicemail.play")} · ${formatDuration(status.currentTime)} / ${formatDuration(total)}`}
          onPress={() => {
            if (status.playing) player.pause();
            else {
              if (status.didJustFinish || (total > 0 && status.currentTime >= total)) player.seekTo(0);
              player.play();
            }
          }}
        />
      ) : (
        <Body muted>{t("voicemail.noAudio")}</Body>
      )}
      <Label>{t("voicemail.transcript")}</Label>
      <Body muted={!vm.transcript}>{vm.transcript ?? (canTranscribe ? t("common.empty") : t("voicemail.noTranscript"))}</Body>
      <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, flexWrap: "wrap" }}>
        <Button icon="call" variant="success" label={t("voicemail.callBack")} onPress={() => vm.from && callService.connect(vm.from)} style={{ flexGrow: 1 }} />
        <Button icon="trash" variant="ghost" label={t("common.delete")} onPress={onDelete} style={{ flexGrow: 1 }} />
      </View>
    </View>
  );
}
