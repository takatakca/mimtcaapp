// English (Canada) — "Test my connection" in the phone's audio settings. Same keys as fr.calltest.ts.
import type { frCallTest } from "./fr.calltest";

export const enCallTest: Record<keyof typeof frCallTest, string> = {
  "phone.test.title": "Connection quality",
  "phone.test.hint": "A short test call of about 15 seconds measures your network. No number is dialed.",
  "phone.test.button": "Test my connection",
  "phone.test.running": "Testing…",
  "phone.test.busy": "Hang up before testing your connection.",
  "phone.test.failed": "The test could not finish. Check your Internet connection and microphone access, then try again.",
  "phone.test.quality": "Quality",
  "phone.test.quality.excellent": "Excellent",
  "phone.test.quality.good": "Good",
  "phone.test.quality.fair": "Fair",
  "phone.test.quality.poor": "Poor",
  "phone.test.quality.unknown": "Unknown",
  "phone.test.jitter": "Jitter",
  "phone.test.loss": "Packet loss",
  "phone.test.rtt": "Round-trip time",
  "phone.test.turn": "TURN relay needed",
  "phone.test.edge": "Twilio edge",
  "phone.test.yes": "Yes",
  "phone.test.no": "No",
  "phone.test.ms": "{value} ms",
  "phone.test.pct": "{value}%",
  "phone.test.tip": "Move closer to your Wi-Fi router or switch to your cellular network.",
};
