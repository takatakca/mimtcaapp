// Réunions MIMT: the user's live and upcoming meetings. Joining opens app.mimt.ca in the browser
// (camera, microphone and screen sharing there); native video comes later.
import type { Meeting } from "@mimt/shared";
import { Stack } from "expo-router";
import * as Linking from "expo-linking";
import { Body, Button, Card, ErrorText, Heading, Notice, Screen } from "../../src/components/ui";
import { ApiClientError } from "../../src/api/errors";
import { meetingsApi } from "../../src/api/meetings";
import { settingsHeader } from "../../src/components/settingsHeader";
import { useI18n } from "../../src/i18n";
import { activeMeetings, meetingWebUrl, MEETINGS_WEB_URL } from "../../src/lib/meetings";
import { useAsync } from "../../src/lib/useAsync";

async function load(): Promise<{ meetings: Meeting[]; unavailable: boolean }> {
  try {
    const { meetings } = await meetingsApi.list();
    return { meetings: activeMeetings(meetings), unavailable: false };
  } catch (e) {
    if (e instanceof ApiClientError && e.status === 503) return { meetings: [], unavailable: true };
    throw e;
  }
}

export default function MeetingsScreen() {
  const { t, lang } = useI18n();
  const list = useAsync(load, []);
  const locale = lang === "fr" ? "fr-CA" : "en-CA";
  return (
    <Screen edges={["bottom"]}>
      <Stack.Screen options={{ ...settingsHeader, title: t("meetings.title"), headerBackTitle: t("common.back") }} />
      <Body muted>{t("meetings.intro")}</Body>
      {list.errorKey ? <ErrorText>{t(list.errorKey)}</ErrorText> : null}
      {list.data?.unavailable ? <Notice>{t("meetings.unavailable")}</Notice> : null}
      {!list.loading && list.data && !list.data.unavailable && list.data.meetings.length === 0 ? <Body muted>{t("meetings.empty")}</Body> : null}
      {(list.data?.meetings ?? []).map((m) => (
        <Card key={m.id}>
          <Heading>{m.title}</Heading>
          <Body muted>
            {m.status === "live"
              ? t("meetings.live")
              : m.scheduledStart
                ? new Date(m.scheduledStart).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })
                : t("meetings.noDate")}
          </Body>
          <Button icon="videocam" label={t("meetings.joinInBrowser")} hint={t("meetings.joinHint")} onPress={() => void Linking.openURL(meetingWebUrl(m))} />
        </Card>
      ))}
      <Card>
        <Button icon="open-outline" variant="secondary" label={t("meetings.manage")} onPress={() => void Linking.openURL(MEETINGS_WEB_URL)} />
        <Body muted>{t("meetings.noRecording")}</Body>
      </Card>
    </Screen>
  );
}
