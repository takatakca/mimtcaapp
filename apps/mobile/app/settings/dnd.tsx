import { WEEKDAYS, type Weekday } from "@mimt/shared";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { api } from "../../src/api/client";
import { toErrorKey } from "../../src/api/errors";
import { useSession } from "../../src/auth/session";
import { Body, Button, Card, ErrorText, Field, Label, Notice, Row, Screen } from "../../src/components/ui";
import { useI18n, type TKey } from "../../src/i18n";
import { DEFAULT_QUIET_HOURS, parseTime, quietHoursFromSchedule, scheduleFromQuietHours } from "../../src/lib/callControls";
import { colors, radius, spacing, TAP } from "../../src/theme";

/** Do not disturb for everyone (free included): calls go to voicemail, always or during quiet hours. */
export default function DoNotDisturb() {
  const { t } = useI18n();
  const { me, refreshMe } = useSession();
  const dnd = me?.callSettings?.dnd;
  const simple = quietHoursFromSchedule(dnd?.schedule);
  const custom = !!dnd?.schedule && !simple;
  const [enabled, setEnabled] = useState(dnd?.enabled ?? false);
  const [scheduled, setScheduled] = useState(!!dnd?.schedule);
  const [start, setStart] = useState((simple ?? DEFAULT_QUIET_HOURS).start);
  const [end, setEnd] = useState((simple ?? DEFAULT_QUIET_HOURS).end);
  const [days, setDays] = useState<Weekday[]>((simple ?? DEFAULT_QUIET_HOURS).days);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<TKey | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!dnd) return;
    setEnabled(dnd.enabled);
    setScheduled(!!dnd.schedule);
    const q = quietHoursFromSchedule(dnd.schedule);
    if (q) {
      setStart(q.start);
      setEnd(q.end);
      setDays(q.days);
    }
  }, [dnd?.enabled, JSON.stringify(dnd?.schedule)]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setErrorKey(null);
    setSaved(false);
    const s = parseTime(start);
    const e = parseTime(end);
    if (scheduled && (!s || !e || s === e || days.length === 0)) return setErrorKey("dnd.invalidTime");
    setBusy(true);
    try {
      await api.updateMe({
        dnd: { enabled, schedule: scheduled && s && e ? scheduleFromQuietHours({ start: s, end: e, days }) : null },
      });
      await refreshMe();
      setSaved(true);
    } catch (err) {
      setErrorKey(toErrorKey(err));
    } finally {
      setBusy(false);
    }
  }

  const toggleDay = (d: Weekday) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : WEEKDAYS.filter((x) => x === d || cur.includes(x))));

  return (
    <Screen edges={["bottom"]}>
      <Stack.Screen options={{ title: t("dnd.title"), headerBackTitle: t("common.back") }} />
      <Body muted>{t("dnd.intro")}</Body>
      <Card>
        <Row
          title={t("dnd.enabled")}
          right={
            <Switch
              accessibilityLabel={t("dnd.enabled")}
              value={enabled}
              trackColor={{ true: colors.electric, false: colors.midnightRaised }}
              onValueChange={setEnabled}
            />
          }
        />
        <Row
          title={t("dnd.scheduled")}
          right={
            <Switch
              accessibilityLabel={t("dnd.scheduled")}
              value={scheduled}
              disabled={!enabled}
              trackColor={{ true: colors.electric, false: colors.midnightRaised }}
              onValueChange={setScheduled}
            />
          }
        />
        {enabled && scheduled ? (
          <View style={{ marginTop: spacing.sm }}>
            {custom ? <Notice tone="warning">{t("dnd.customSchedule")}</Notice> : null}
            <View style={styles.times}>
              <View style={{ flex: 1 }}>
                <Field label={t("dnd.start")} value={start} onChangeText={setStart} keyboardType="numbers-and-punctuation" maxLength={5} />
              </View>
              <View style={{ flex: 1 }}>
                <Field label={t("dnd.end")} value={end} onChangeText={setEnd} keyboardType="numbers-and-punctuation" maxLength={5} />
              </View>
            </View>
            <Label>{t("dnd.days").toUpperCase()}</Label>
            <View style={styles.days}>
              {WEEKDAYS.map((d) => {
                const on = days.includes(d);
                return (
                  <Pressable
                    key={d}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={t(`weekday.${d}`)}
                    onPress={() => toggleDay(d)}
                    style={[styles.day, on && styles.dayOn]}
                  >
                    <Text style={[styles.dayText, on && { color: colors.navy }]}>{t(`weekday.${d}`)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
        <Button icon="save" label={t("common.save")} loading={busy} onPress={save} />
      </Card>
      {errorKey ? <ErrorText>{t(errorKey)}</ErrorText> : null}
      {saved ? <Notice tone="success">{t("dnd.saved")}</Notice> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  times: { flexDirection: "row", gap: spacing.md },
  days: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginBottom: spacing.md },
  day: {
    minWidth: TAP,
    minHeight: TAP,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  dayOn: { backgroundColor: colors.electric, borderColor: colors.electric },
  dayText: { color: colors.white, fontWeight: "700", fontSize: 15 },
});
