import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "../src/auth/session";
import { I18nProvider, useI18n } from "../src/i18n";
import { callService, useCallState } from "../src/services/call";
import { addNotificationTapListener, registerForMessagePush } from "../src/services/push";
import { colors } from "../src/theme";

/** Signed-in side effects: Twilio registration, push, and opening the call screen. */
function Background() {
  const router = useRouter();
  const { t } = useI18n();
  const { status } = useSession();
  const call = useCallState();
  const lastStatus = useRef(call.status);

  useEffect(() => {
    if (status !== "signedIn") {
      callService.unregister().catch(() => undefined);
      return;
    }
    callService.init().catch((e) => console.warn("[voice] init failed", e));
    registerForMessagePush(t("tabs.messages")).catch(() => undefined);
    const sub = AppState.addEventListener("change", (s) => {
      // Access tokens live 1 h: refresh the registration whenever the app comes back.
      if (s === "active") callService.register().catch(() => undefined);
    });
    const offTap = addNotificationTapListener((peer) => router.push(`/thread/${encodeURIComponent(peer)}`));
    return () => {
      sub.remove();
      offTap();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    const was = lastStatus.current;
    lastStatus.current = call.status;
    const active = call.status === "incoming" || call.status === "connecting";
    if (active && (was === "idle" || was === "ended" || was === "failed")) router.push("/call");
  }, [call.status, router]);

  return null;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <SessionProvider>
          <StatusBar style="light" />
          <Background />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.navy } }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(onboarding)" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="call" options={{ presentation: "fullScreenModal", gestureEnabled: false }} />
            <Stack.Screen name="thread/[id]" options={headerOptions} />
            <Stack.Screen name="settings/address" options={headerOptions} />
            <Stack.Screen name="settings/notice" options={headerOptions} />
            <Stack.Screen name="settings/privacy" options={headerOptions} />
            <Stack.Screen name="settings/blocked" options={headerOptions} />
            <Stack.Screen name="settings/forwarding" options={headerOptions} />
            <Stack.Screen name="settings/dnd" options={headerOptions} />
          </Stack>
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

const headerOptions = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.navy },
  headerTintColor: colors.white,
  headerTitleStyle: { fontWeight: "700" as const },
};
