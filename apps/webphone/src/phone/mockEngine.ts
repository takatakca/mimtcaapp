// Demo engine for VITE_MOCK_API=1: simulates calls without Twilio, so screens can be reviewed.
import { isEmergencyNumber } from "@mimt/shared";
import { IDLE_CALL, SnapshotStore, type PhoneEngine } from "./types";

export class MockEngine implements PhoneEngine {
  private store = new SnapshotStore();
  private timers: ReturnType<typeof setTimeout>[] = [];

  subscribe = this.store.subscribe;
  getSnapshot = this.store.getSnapshot;

  async start(): Promise<void> {
    this.store.set({
      registered: true,
      canHold: true,
      inputDevices: [
        { id: "default", label: "Micro par défaut" },
        { id: "headset", label: "Casque USB" },
      ],
      outputDevices: [
        { id: "default", label: "Haut-parleurs par défaut" },
        { id: "headset", label: "Casque USB" },
      ],
      inputDeviceId: "default",
      outputDeviceId: "default",
      outputSelectionSupported: true,
    });
  }

  async stop(): Promise<void> {
    this.clear();
    this.store.set({ ...IDLE_CALL, registered: false });
  }

  private clear() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  async connect(to: string): Promise<void> {
    this.clear();
    this.store.set({ ...IDLE_CALL, status: "connecting", direction: "outbound", peer: to, emergency: isEmergencyNumber(to), error: null });
    this.timers.push(setTimeout(() => this.store.set({ status: "ringing" }), 600));
    this.timers.push(setTimeout(() => this.store.set({ status: "connected", connectedAt: Date.now() }), 1800));
  }

  /** Demo helper: ring this browser. */
  simulateIncoming(from: string): void {
    this.store.set({ ...IDLE_CALL, status: "incoming", direction: "inbound", peer: from, error: null });
  }

  accept(): void {
    this.store.set({ status: "connected", connectedAt: Date.now() });
  }
  reject(): void {
    this.end();
  }
  hangup(): void {
    this.end();
  }
  private end() {
    this.clear();
    const s = this.store.getSnapshot();
    this.store.set({ ...IDLE_CALL, status: "ended", peer: s.peer, emergency: s.emergency });
  }
  setMuted(muted: boolean): void {
    this.store.set({ muted });
  }
  setHold(onHold: boolean): void {
    this.store.set({ onHold });
  }
  sendDigits(): void {}
  async setInputDevice(id: string): Promise<void> {
    this.store.set({ inputDeviceId: id });
  }
  async setOutputDevice(id: string): Promise<void> {
    this.store.set({ outputDeviceId: id });
  }
  dismiss(): void {
    this.store.set({ ...IDLE_CALL, error: null });
  }
}
