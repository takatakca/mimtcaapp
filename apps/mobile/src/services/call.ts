// CallService: the only place that talks to the Twilio Voice React Native SDK.
//
// - Registers this device for incoming calls (APNs VoIP push via PushKit/CallKit on iOS, FCM +
//   ConnectionService on Android) with a short-lived access token from GET /v1/voice/token.
// - Places outgoing calls, accepts/rejects CallInvites, and exposes mute/speaker/hold/DTMF.
// - Publishes a single CallSnapshot that screens read through useCallState().
//
// 9-1-1 rule (docs/MIMT-REGULATORY.md §3): a 9-1-1 call is never blocked here by plan, caps,
// credit or onboarding state. The server routes "911" to the third-party emergency call centre.
//
// The SDK is native: it needs a development build (expo prebuild / EAS), not Expo Go. It is loaded
// lazily so the rest of the app still runs (without calling) where the native module is missing.
import type * as TwilioVoice from "@twilio/voice-react-native-sdk";
import { isEmergencyNumber } from "@mimt/shared";
import { useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { api } from "../api/client";
import { formatPhone, toDialableVoice } from "../lib/dial";

/** Sent with GET /v1/voice/token so the token carries this OS's VoIP push credential. */
const voicePlatform = () => (Platform.OS === "ios" ? "ios" : "android");

type Sdk = typeof TwilioVoice;
type Voice = InstanceType<Sdk["Voice"]>;
type Call = InstanceType<Sdk["Call"]>;
type CallInvite = InstanceType<Sdk["CallInvite"]>;

export type CallStatus = "idle" | "incoming" | "connecting" | "ringing" | "connected" | "reconnecting" | "ended" | "failed";

export interface CallSnapshot {
  /** False when the native SDK is not in this build (Expo Go, web). */
  available: boolean;
  registered: boolean;
  status: CallStatus;
  direction: "inbound" | "outbound" | null;
  /** E.164 or "911". */
  peer: string | null;
  emergency: boolean;
  muted: boolean;
  onHold: boolean;
  speaker: boolean;
  /** Epoch ms when the call connected, for the timer. */
  connectedAt: number | null;
  error: string | null;
}

const IDLE: Omit<CallSnapshot, "available" | "registered"> = {
  status: "idle",
  direction: null,
  peer: null,
  emergency: false,
  muted: false,
  onHold: false,
  speaker: false,
  connectedAt: null,
  error: null,
};

function loadSdk(): Sdk | null {
  if (Platform.OS === "web") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@twilio/voice-react-native-sdk") as Sdk;
  } catch {
    return null;
  }
}

class CallService {
  private sdk: Sdk | null = null;
  private voice: Voice | null = null;
  private call: Call | null = null;
  private invite: CallInvite | null = null;
  private registeredToken: string | null = null;
  private initPromise: Promise<void> | null = null;
  private snapshot: CallSnapshot = { ...IDLE, available: false, registered: false };
  private listeners = new Set<() => void>();

  // ------------------------------------------------------------------ store

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): CallSnapshot => this.snapshot;

  private set(patch: Partial<CallSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
  }

  private reset(status: "ended" | "failed" | "idle", error: string | null = null): void {
    this.call = null;
    this.invite = null;
    this.set({ ...IDLE, status, error, peer: this.snapshot.peer, emergency: this.snapshot.emergency });
    if (status !== "idle") setTimeout(() => this.snapshot.status === status && this.set({ ...IDLE }), 2500);
  }

  // ------------------------------------------------------------------ setup

  /** Creates the Voice object, wires listeners and registers for incoming calls. Safe to call repeatedly. */
  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInit().catch((e) => {
        this.initPromise = null;
        throw e;
      });
    }
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    this.sdk = loadSdk();
    if (!this.sdk) return;
    const { Voice, CallKit } = this.sdk;
    let voice: Voice;
    try {
      voice = new Voice();
    } catch {
      this.sdk = null; // Native module missing (Expo Go).
      return;
    }
    this.voice = voice;
    this.set({ available: true });

    voice.on(Voice.Event.CallInvite, (invite: CallInvite) => this.onInvite(invite));
    voice.on(Voice.Event.Registered, () => this.set({ registered: true }));
    voice.on(Voice.Event.Unregistered, () => this.set({ registered: false }));
    voice.on(Voice.Event.Error, (error) => console.warn("[voice] error", error.code, error.message));

    if (Platform.OS === "ios") {
      await voice.initializePushRegistry();
      // The native side reads only the keys present; icon and ringtone stay at the system defaults.
      // TODO(brand): add callKitIconTemplateImageData (asset name) once the official logo is in the app.
      const callKit: Partial<TwilioVoice.CallKit.ConfigurationOptions> = {
        callKitIncludesCallsInRecents: true,
        callKitMaximumCallGroups: 1,
        callKitMaximumCallsPerCallGroup: 1,
        callKitSupportedHandleTypes: [CallKit.HandleType.PhoneNumber],
      };
      await voice.setCallKitConfiguration(callKit as TwilioVoice.CallKit.ConfigurationOptions);
    }

    // A call answered from CallKit / the Android notification before JS started.
    const calls = await voice.getCalls();
    const existing = calls.values().next().value;
    if (existing) this.bindCall(existing, "inbound", existing.getFrom() ?? null);
    const invites = await voice.getCallInvites();
    const pending = invites.values().next().value;
    if (pending && !existing) this.onInvite(pending);

    await this.register();
  }

  /** (Re)registers with a fresh token. Call on sign-in and when the app returns to the foreground. */
  async register(): Promise<void> {
    if (!this.voice) return;
    const { token } = await api.voiceToken(voicePlatform());
    await this.voice.register(token);
    this.registeredToken = token;
  }

  /** Stops incoming calls to this device (logout). */
  async unregister(): Promise<void> {
    if (!this.voice || !this.registeredToken) return;
    await this.voice.unregister(this.registeredToken).catch(() => undefined);
    this.registeredToken = null;
    this.set({ registered: false });
  }

  // ------------------------------------------------------------------ outgoing

  /** Places a call. Returns false when the number is not dialable. 9-1-1 always goes through. */
  async connect(input: string): Promise<boolean> {
    const to = toDialableVoice(input);
    if (!to) return false;
    const emergency = isEmergencyNumber(to);
    this.set({ ...IDLE, status: "connecting", direction: "outbound", peer: to, emergency });
    if (!this.voice) await this.init().catch(() => undefined);
    if (!this.voice) {
      this.reset("failed", "unavailable");
      return true;
    }
    try {
      const { token } = await api.voiceToken(voicePlatform());
      const call = await this.voice.connect(token, {
        params: { To: to, ...(emergency ? { Emergency: "true" } : {}) },
        contactHandle: to,
        notificationDisplayName: emergency ? "9-1-1" : formatPhone(to),
      });
      this.bindCall(call, "outbound", to);
    } catch (e) {
      this.reset("failed", e instanceof Error ? e.message : "connect failed");
    }
    return true;
  }

  // ------------------------------------------------------------------ incoming

  private onInvite(invite: CallInvite): void {
    const sdk = this.sdk!;
    this.invite = invite;
    this.set({ ...IDLE, status: "incoming", direction: "inbound", peer: invite.getFrom() });
    invite.on(sdk.CallInvite.Event.Accepted, (call: Call) => this.bindCall(call, "inbound", invite.getFrom()));
    invite.on(sdk.CallInvite.Event.Rejected, () => this.reset("ended"));
    invite.on(sdk.CallInvite.Event.Cancelled, () => this.reset("ended"));
  }

  async accept(): Promise<void> {
    if (!this.invite) return;
    const invite = this.invite;
    this.set({ status: "connecting" });
    try {
      const call = await invite.accept();
      this.bindCall(call, "inbound", invite.getFrom());
    } catch (e) {
      this.reset("failed", e instanceof Error ? e.message : "accept failed");
    }
  }

  async reject(): Promise<void> {
    const invite = this.invite;
    if (!invite) return;
    await invite.reject().catch(() => undefined);
    this.reset("ended");
  }

  // ------------------------------------------------------------------ in-call

  private bindCall(call: Call, direction: "inbound" | "outbound", peer: string | null): void {
    if (this.call === call) return;
    const { Call: CallNs } = this.sdk!;
    this.call = call;
    this.invite = null;
    const connected = call.getState() === CallNs.State.Connected;
    this.set({
      direction,
      peer,
      status: connected ? "connected" : "connecting",
      connectedAt: connected ? (call.getInitialConnectedTimestamp()?.getTime() ?? Date.now()) : null,
      muted: call.isMuted() ?? false,
      onHold: call.isOnHold() ?? false,
    });
    call.on(CallNs.Event.Ringing, () => this.set({ status: "ringing" }));
    call.on(CallNs.Event.Connected, () => this.set({ status: "connected", connectedAt: Date.now() }));
    call.on(CallNs.Event.Reconnecting, () => this.set({ status: "reconnecting" }));
    call.on(CallNs.Event.Reconnected, () => this.set({ status: "connected" }));
    call.on(CallNs.Event.ConnectFailure, (error) => this.reset("failed", error.message));
    call.on(CallNs.Event.Disconnected, (error) => this.reset(error ? "failed" : "ended", error?.message ?? null));
  }

  async hangup(): Promise<void> {
    if (this.invite) return this.reject();
    if (this.call) await this.call.disconnect().catch(() => undefined);
    else this.reset("ended");
  }

  async toggleMute(): Promise<void> {
    if (!this.call) return;
    const next = !this.snapshot.muted;
    await this.call.mute(next);
    this.set({ muted: next });
  }

  async toggleHold(): Promise<void> {
    if (!this.call) return;
    const next = !this.snapshot.onHold;
    await this.call.hold(next);
    this.set({ onHold: next });
  }

  async toggleSpeaker(): Promise<void> {
    if (!this.voice) return;
    const next = !this.snapshot.speaker;
    const { audioDevices } = await this.voice.getAudioDevices();
    const wanted = audioDevices.find((d) => String(d.type) === (next ? "speaker" : "earpiece"));
    if (!wanted) {
      // iOS may not list the earpiece separately; the native route picker covers every case.
      if (Platform.OS === "ios") await this.voice.showAvRoutePickerView();
      return;
    }
    await wanted.select();
    this.set({ speaker: next });
  }

  /** DTMF tones (voicemail menus, IVRs). */
  async sendDigits(digits: string): Promise<void> {
    if (!this.call || !/^[\d*#]+$/.test(digits)) return;
    await this.call.sendDigits(digits);
  }
}

export const callService = new CallService();

export function useCallState(): CallSnapshot {
  return useSyncExternalStore(callService.subscribe, callService.getSnapshot, callService.getSnapshot);
}
