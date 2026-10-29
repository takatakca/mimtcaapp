// The softphone's state, shared by the Twilio engine (WebRTC) and the demo engine (VITE_MOCK_API=1).
import type { ConnectionTestResult } from "./connectionTest";

export type CallStatus = "idle" | "incoming" | "connecting" | "ringing" | "connected" | "reconnecting" | "ended" | "failed";

/** Machine codes the UI translates (phone.error.*). */
export type PhoneErrorCode = "mic_denied" | "token" | "unavailable" | "connection" | "failed" | "invalid_number";

export interface AudioDeviceOption {
  id: string;
  label: string;
}

export interface PhoneSnapshot {
  /** Device registered: the browser can receive calls. */
  registered: boolean;
  registering: boolean;
  status: CallStatus;
  direction: "inbound" | "outbound" | null;
  /** E.164, "911" or a client identity. */
  peer: string | null;
  emergency: boolean;
  muted: boolean;
  /** Hold needs a server-side conference; false with the plain Twilio JS SDK. */
  canHold: boolean;
  onHold: boolean;
  /** Epoch ms when the call connected, for the timer. */
  connectedAt: number | null;
  /** Twilio call-quality warnings currently raised (high-rtt, low-mos, high-packet-loss…). */
  qualityWarnings: string[];
  error: PhoneErrorCode | null;
  inputDevices: AudioDeviceOption[];
  outputDevices: AudioDeviceOption[];
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  outputSelectionSupported: boolean;
}

export const INITIAL_SNAPSHOT: PhoneSnapshot = {
  registered: false,
  registering: false,
  status: "idle",
  direction: null,
  peer: null,
  emergency: false,
  muted: false,
  canHold: false,
  onHold: false,
  connectedAt: null,
  qualityWarnings: [],
  error: null,
  inputDevices: [],
  outputDevices: [],
  inputDeviceId: null,
  outputDeviceId: null,
  outputSelectionSupported: false,
};

/** Fields reset when a call ends (devices and registration are kept). */
export const IDLE_CALL: Pick<
  PhoneSnapshot,
  "status" | "direction" | "peer" | "emergency" | "muted" | "onHold" | "connectedAt" | "qualityWarnings"
> = {
  status: "idle",
  direction: null,
  peer: null,
  emergency: false,
  muted: false,
  onHold: false,
  connectedAt: null,
  qualityWarnings: [],
};

export interface PhoneEngine {
  subscribe(listener: () => void): () => void;
  getSnapshot(): PhoneSnapshot;
  /** Registers for incoming calls (fetches a token). Safe to call twice. */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** `to` is already normalised by toDialable (E.164 or "911"). */
  connect(to: string): Promise<void>;
  accept(): void;
  reject(): void;
  hangup(): void;
  setMuted(muted: boolean): void;
  setHold(onHold: boolean): void;
  sendDigits(digits: string): void;
  setInputDevice(id: string): Promise<void>;
  setOutputDevice(id: string): Promise<void>;
  /** Clears the ended/failed state shown after a call. */
  dismiss(): void;
  /**
   * « Tester ma connexion »: a short test call (Twilio preflight) on a fresh token. Optional: an engine without it
   * hides the button.
   */
  runConnectionTest?(): Promise<ConnectionTestResult>;
}

/** Small observable store used by both engines. */
export class SnapshotStore {
  private snapshot: PhoneSnapshot = INITIAL_SNAPSHOT;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  set(patch: Partial<PhoneSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
  }
}
