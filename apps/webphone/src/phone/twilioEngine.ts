// The only place that talks to @twilio/voice-sdk (official Twilio Voice JavaScript SDK, WebRTC).
//
// - Registers the browser for incoming calls with a short-lived token from
//   GET /v1/voice/token?platform=web, refreshed on `tokenWillExpire`.
// - Places calls through the TwiML App (`To` param, read by POST /webhooks/twilio/voice/outbound).
// - Mute, DTMF, input/output device selection, call-quality warnings. The SDK plays its own
//   incoming ringtone and outgoing ringback.
//
// 9-1-1 rule (docs/MIMT-REGULATORY.md §3): a 9-1-1 call is never blocked here by plan, caps, credit
// or onboarding state. The server routes "911" to the emergency call centre with the registered
// 9-1-1 address. The SDK is loaded lazily so the first page stays light.
import type { Call, Device } from "@twilio/voice-sdk";
import { isEmergencyNumber } from "@mimt/shared";
import { IDLE_CALL, SnapshotStore, type AudioDeviceOption, type PhoneEngine, type PhoneErrorCode } from "./types";

type Sdk = typeof import("@twilio/voice-sdk");

export interface TwilioEngineDeps {
  getToken: () => Promise<string>;
  /** Text of the "leave the page?" prompt while a call is up. */
  closeProtection?: string;
}

const MIC_ERRORS = new Set([31401, 31402, 31208, 31201]);

function errorCode(e: unknown): PhoneErrorCode {
  const err = e as { code?: number; name?: string } | null;
  if (err?.name === "NotAllowedError" || (err?.code !== undefined && MIC_ERRORS.has(err.code))) return "mic_denied";
  if (err?.code !== undefined && err.code >= 20101 && err.code <= 20160) return "token";
  if (err?.code !== undefined && (err.code === 31005 || err.code === 31009 || err.code === 53000 || err.code === 53405)) return "connection";
  return "failed";
}

function devices(map: Map<string, MediaDeviceInfo> | undefined): AudioDeviceOption[] {
  if (!map) return [];
  return [...map.values()].map((d, i) => ({ id: d.deviceId, label: d.label || `${d.kind === "audioinput" ? "Micro" : "Sortie"} ${i + 1}` }));
}

export class TwilioEngine implements PhoneEngine {
  private store = new SnapshotStore();
  private sdk: Sdk | null = null;
  private device: Device | null = null;
  private call: Call | null = null;
  private starting: Promise<void> | null = null;

  constructor(private deps: TwilioEngineDeps) {}

  subscribe = this.store.subscribe;
  getSnapshot = this.store.getSnapshot;

  start(): Promise<void> {
    if (this.device) return Promise.resolve();
    if (!this.starting) {
      this.starting = this.init().finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  private async init(): Promise<void> {
    this.store.set({ registering: true, error: null });
    try {
      this.sdk ??= await import("@twilio/voice-sdk");
      const { Device: DeviceCtor, Call: CallNs } = this.sdk;
      const token = await this.deps.getToken();
      const device = new DeviceCtor(token, {
        codecPreferences: [CallNs.Codec.Opus, CallNs.Codec.PCMU],
        closeProtection: this.deps.closeProtection ?? true,
        // Ask for a new token one minute before expiry (tokens live 1 h).
        tokenRefreshMs: 60_000,
        allowIncomingWhileBusy: false,
      });
      this.device = device;
      device.on("registered", () => this.store.set({ registered: true, registering: false }));
      device.on("unregistered", () => this.store.set({ registered: false }));
      device.on("error", (e: unknown) => this.store.set({ error: errorCode(e), registering: false }));
      device.on("tokenWillExpire", () => {
        this.deps
          .getToken()
          .then((t) => device.updateToken(t))
          .catch(() => this.store.set({ error: "token" }));
      });
      device.on("incoming", (call: Call) => this.onIncoming(call));
      device.audio?.on("deviceChange", () => this.refreshDevices());
      this.refreshDevices();
      await device.register();
    } catch (e) {
      this.store.set({ registering: false, error: errorCode(e) });
      this.device?.destroy();
      this.device = null;
      throw e;
    }
  }

  private refreshDevices(): void {
    const audio = this.device?.audio;
    if (!audio) return;
    const out = [...audio.speakerDevices.get()][0];
    this.store.set({
      inputDevices: devices(audio.availableInputDevices),
      outputDevices: devices(audio.availableOutputDevices),
      inputDeviceId: audio.inputDevice?.deviceId ?? null,
      outputDeviceId: out?.deviceId ?? null,
      outputSelectionSupported: audio.isOutputSelectionSupported,
    });
  }

  async stop(): Promise<void> {
    this.call?.disconnect();
    this.call = null;
    if (this.device) {
      await this.device.unregister().catch(() => undefined);
      this.device.destroy();
    }
    this.device = null;
    this.store.set({ ...IDLE_CALL, registered: false, registering: false });
  }

  async connect(to: string): Promise<void> {
    const emergency = isEmergencyNumber(to);
    this.store.set({ ...IDLE_CALL, status: "connecting", direction: "outbound", peer: to, emergency, error: null });
    try {
      if (!this.device) await this.start();
      const device = this.device;
      if (!device) throw new Error("unavailable");
      // Fresh token for each outgoing call, so an expired one never blocks a 9-1-1 call.
      device.updateToken(await this.deps.getToken());
      const call = await device.connect({ params: { To: to, ...(emergency ? { Emergency: "true" } : {}) } });
      this.bind(call, "outbound", to);
    } catch (e) {
      this.end("failed", errorCode(e));
    }
  }

  private onIncoming(call: Call): void {
    if (this.call) {
      call.reject();
      return;
    }
    const from = call.parameters.From ?? null;
    // A call by MIMT handle carries the caller's @nom; never show the internal client id.
    const handle = call.customParameters?.get("fromHandle") ?? null;
    const peer = handle ?? (from?.startsWith("client:") ? null : from);
    this.call = call;
    this.store.set({ ...IDLE_CALL, status: "incoming", direction: "inbound", peer, error: null });
    call.on("cancel", () => this.end("ended"));
    call.on("reject", () => this.end("ended"));
    call.on("disconnect", () => this.end("ended"));
    call.on("error", (e: unknown) => this.end("failed", errorCode(e)));
  }

  private bind(call: Call, direction: "inbound" | "outbound", peer: string | null): void {
    this.call = call;
    this.store.set({ direction, peer, status: direction === "inbound" ? "connecting" : this.store.getSnapshot().status });
    call.on("ringing", () => this.store.set({ status: "ringing" }));
    call.on("accept", () => this.store.set({ status: "connected", connectedAt: Date.now() }));
    call.on("reconnecting", () => this.store.set({ status: "reconnecting" }));
    call.on("reconnected", () => this.store.set({ status: "connected" }));
    call.on("mute", (muted: boolean) => this.store.set({ muted }));
    call.on("warning", (name: string) => {
      const w = this.store.getSnapshot().qualityWarnings;
      if (!w.includes(name)) this.store.set({ qualityWarnings: [...w, name] });
    });
    call.on("warning-cleared", (name: string) =>
      this.store.set({ qualityWarnings: this.store.getSnapshot().qualityWarnings.filter((x) => x !== name) }),
    );
    call.on("disconnect", () => this.end("ended"));
    call.on("cancel", () => this.end("ended"));
    call.on("error", (e: unknown) => this.end("failed", errorCode(e)));
  }

  private end(status: "ended" | "failed", error: PhoneErrorCode | null = null): void {
    this.call = null;
    this.store.set({ ...IDLE_CALL, status, error, peer: this.store.getSnapshot().peer, emergency: this.store.getSnapshot().emergency });
  }

  accept(): void {
    const call = this.call;
    if (!call || this.store.getSnapshot().status !== "incoming") return;
    this.bind(call, "inbound", this.store.getSnapshot().peer);
    call.accept();
  }

  reject(): void {
    const call = this.call;
    if (!call) return;
    call.reject();
    this.end("ended");
  }

  hangup(): void {
    if (this.store.getSnapshot().status === "incoming") return this.reject();
    if (this.call) this.call.disconnect();
    else this.end("ended");
  }

  setMuted(muted: boolean): void {
    this.call?.mute(muted);
    this.store.set({ muted });
  }

  setHold(): void {
    // Not supported by the Twilio JS SDK alone (needs a server-side conference). canHold stays false.
  }

  sendDigits(digits: string): void {
    this.call?.sendDigits(digits);
  }

  async setInputDevice(id: string): Promise<void> {
    await this.device?.audio?.setInputDevice(id);
    this.refreshDevices();
  }

  async setOutputDevice(id: string): Promise<void> {
    const audio = this.device?.audio;
    if (!audio?.isOutputSelectionSupported) return;
    await audio.speakerDevices.set(id);
    await audio.ringtoneDevices.set(id).catch(() => undefined);
    this.refreshDevices();
  }

  dismiss(): void {
    const s = this.store.getSnapshot().status;
    if (s === "ended" || s === "failed") this.store.set({ ...IDLE_CALL, error: null });
  }
}
