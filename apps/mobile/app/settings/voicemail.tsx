import { GREETING_MAX_S } from "@mimt/shared";
import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from "expo-audio";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Platform, Switch, View } from "react-native";
import { api } from "../../src/api/client";
import { toErrorKey } from "../../src/api/errors";
import type { VoicemailSettingsDto } from "../../src/api/types";
import { Body, Button, Card, ErrorText, Heading, Notice, Row, Screen } from "../../src/components/ui";
import { useI18n, type TKey } from "../../src/i18n";
import { useAsync } from "../../src/lib/useAsync";
import { uploadMedia } from "../../src/services/upload";
import { colors, spacing } from "../../src/theme";

/**
 * Twilio <Play> accepts MP3 and WAV only. iOS records WAV (16 kHz mono PCM, about 2 MB per minute).
 * Android cannot record WAV, so it records the greeting by phone call instead (Twilio produces the MP3).
 */
const CAN_RECORD_IN_APP = Platform.OS === "ios";
const GREETING_RECORDING: RecordingOptions = {
  extension: ".wav",
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 256000,
  android: { outputFormat: "default", audioEncoder: "default" },
  ios: {
    extension: ".wav",
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: AudioQuality.HIGH,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {},
};

/** Voicemail settings: custom greeting and voicemail to email (paid plans). */
export default function VoicemailSettings() {
  const { t } = useI18n();
  const settings = useAsync(() => api.voicemailSettings());
  const [busy, setBusy] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<TKey | null>(null);
  const [info, setInfo] = useState<TKey | null>(null);
  const recorder = useAudioRecorder(GREETING_RECORDING);
  const recorderState = useAudioRecorderState(recorder);
  const s = settings.data;

  async function run(id: string, fn: () => Promise<VoicemailSettingsDto | void>, done?: TKey) {
    setBusy(id);
    setErrorKey(null);
    setInfo(null);
    try {
      const next = await fn();
      if (next) settings.setData(next);
      if (done) setInfo(done);
    } catch (e) {
      setErrorKey(toErrorKey(e));
    } finally {
      setBusy(null);
    }
  }

  // Stop automatically at the greeting limit.
  useEffect(() => {
    if (recorderState.isRecording && recorderState.durationMillis >= GREETING_MAX_S * 1000) void stopAndSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorderState.isRecording, recorderState.durationMillis]);

  async function startRecording() {
    setErrorKey(null);
    setInfo(null);
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) return setErrorKey("vmSettings.micDenied");
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

  async function stopAndSave() {
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    const uri = recorder.uri;
    if (!uri) return setErrorKey("error.generic");
    await run(
      "record",
      async () => {
        const mediaId = await uploadMedia("greeting", uri, "audio/wav");
        return api.setGreeting(mediaId);
      },
      "vmSettings.saved",
    );
  }

  function confirmReset() {
    Alert.alert(t("vmSettings.greeting"), t("vmSettings.resetConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.delete"), style: "destructive", onPress: () => void run("reset", () => api.resetGreeting()) },
    ]);
  }

  const paid = !!s && (s.available.greeting || s.available.email);
  return (
    <Screen edges={["bottom"]}>
      <Stack.Screen options={{ title: t("vmSettings.title"), headerBackTitle: t("common.back") }} />
      {settings.errorKey ? <ErrorText>{t(settings.errorKey)}</ErrorText> : null}
      {s && !paid ? <Notice>{t("vmSettings.paidOnly")}</Notice> : null}

      {s?.available.greeting ? (
        <Card>
          <Heading>{t("vmSettings.greeting")}</Heading>
          <Body muted>{s.greeting ? t("vmSettings.greetingCustom") : t("vmSettings.greetingDefault")}</Body>
          {s.greeting?.url ? <GreetingPreview url={s.greeting.url} /> : null}
          <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
            {CAN_RECORD_IN_APP ? (
              recorderState.isRecording ? (
                <Button
                  icon="stop"
                  variant="danger"
                  label={`${t("vmSettings.stop")} · ${t("vmSettings.recording", { seconds: String(Math.floor(recorderState.durationMillis / 1000)) })}`}
                  onPress={() => void stopAndSave()}
                />
              ) : (
                <Button icon="mic" label={t("vmSettings.record")} loading={busy === "record"} onPress={() => void startRecording()} />
              )
            ) : null}
            <Button
              icon="call"
              variant="secondary"
              label={t("vmSettings.recordByCall")}
              loading={busy === "call"}
              onPress={() => void run("call", async () => void (await api.recordGreetingByCall()), "vmSettings.calling")}
            />
            <Body muted>{t("vmSettings.recordByCallHint")}</Body>
            {s.greeting ? (
              <Button icon="refresh" variant="ghost" label={t("vmSettings.reset")} loading={busy === "reset"} onPress={confirmReset} />
            ) : null}
          </View>
        </Card>
      ) : null}

      {s?.available.email ? (
        <Card>
          <Row
            title={t("vmSettings.email")}
            subtitle={s.email ? t("vmSettings.emailHint", { address: s.email }) : t("vmSettings.emailNoAddress")}
            right={
              <Switch
                accessibilityLabel={t("vmSettings.email")}
                value={s.emailEnabled}
                disabled={!s.email || busy === "email"}
                trackColor={{ true: colors.electric, false: colors.midnightRaised }}
                onValueChange={(v) => void run("email", () => api.updateVoicemailSettings({ emailEnabled: v }))}
              />
            }
          />
        </Card>
      ) : null}

      {info ? <Notice tone="success">{t(info)}</Notice> : null}
      {errorKey ? <ErrorText>{t(errorKey)}</ErrorText> : null}
    </Screen>
  );
}

function GreetingPreview({ url }: { url: string }) {
  const { t } = useI18n();
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);
  return (
    <Button
      icon={status.playing ? "pause" : "play"}
      variant="secondary"
      label={status.playing ? t("voicemail.pause") : t("vmSettings.listen")}
      onPress={() => {
        if (status.playing) player.pause();
        else {
          if (status.didJustFinish) player.seekTo(0);
          player.play();
        }
      }}
      style={{ marginTop: spacing.sm }}
    />
  );
}
