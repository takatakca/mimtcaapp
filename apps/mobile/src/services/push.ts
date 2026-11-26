// Message notifications (expo-notifications). Incoming CALLS do not use this: they arrive through
// Twilio's own VoIP push (PushKit on iOS, the SDK's FirebaseMessagingService on Android).
//
// TODO(device): on Android both Twilio and expo-notifications declare a FirebaseMessagingService.
// Verify on a real device that FCM messages reach both; if not, follow Twilio's "out-of-band
// Firebase Messaging Service" guide and forward Twilio payloads with voice.handleFirebaseMessage().
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "../api/client";
import { canRegisterPush } from "../lib/pushConfig";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForMessagePush(channelName: string): Promise<boolean> {
  if (!Device.isDevice || !canRegisterPush(Platform.OS)) return false;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("messages", {
      name: channelName,
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: "#1F8BFF",
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== "granted") return false;
  try {
    // Native APNs/FCM token: the API sends message notifications directly (no Expo push relay).
    const { data } = await Notifications.getDevicePushTokenAsync();
    await api.registerPush({ token: String(data), platform: Platform.OS === "ios" ? "ios" : "android", kind: "messages" });
    return true;
  } catch {
    return false;
  }
}

/** Route a tapped message notification to its conversation (payload: { peer }). */
export function addNotificationTapListener(open: (peer: string) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const peer = response.notification.request.content.data?.peer;
    if (typeof peer === "string") open(peer);
  });
  return () => sub.remove();
}
