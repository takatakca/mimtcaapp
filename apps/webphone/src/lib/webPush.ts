// Web Push for app.mimt.ca: ask permission, subscribe the service worker, register with the API.
import { api } from "../api/client";

function keyBytes(base64url: string): Uint8Array {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function webPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export type PushState = "unsupported" | "denied" | "off" | "on";

export async function webPushState(): Promise<PushState> {
  if (!webPushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

/** True when notifications are on after the call. */
export async function enableWebPush(): Promise<boolean> {
  if (!webPushSupported()) return false;
  if ((await Notification.requestPermission()) !== "granted") return false;
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api.webPushKey();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api.webPushSubscribe({ endpoint: json.endpoint, keys: json.keys });
  return true;
}

export async function disableWebPush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api.webPushUnsubscribe(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
}
