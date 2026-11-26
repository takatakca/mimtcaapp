// Is Firebase (FCM) built into this Android app? (app.config.ts → extra.androidPush, true when GOOGLE_SERVICES_JSON
// was given at build time.) Without it, FirebaseMessaging.getInstance() throws inside the Twilio Voice SDK and
// closes the app, so the test APK skips push registration: calls still go out and ring while the app is open.
import Constants from "expo-constants";

export function hasAndroidPush(extra: unknown = Constants.expoConfig?.extra): boolean {
  return (extra as { androidPush?: unknown } | undefined)?.androidPush === true;
}

/** True when this platform can register for push (iOS always: APNs needs no file in the build). */
export function canRegisterPush(os: string, extra?: unknown): boolean {
  if (os === "web") return false;
  if (os === "android") return hasAndroidPush(extra);
  return true;
}
