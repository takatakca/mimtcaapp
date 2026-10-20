// <AdsProvider>: reads the "ads_personalised" consent first, then loads AdSense with the right npa flag;
// never loads for ad-free accounts; a failed consent read means non-personalised ads.
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const consents = vi.fn();
let account: { plan: string; addOns?: string[] } = { plan: "free" };

vi.mock("../api/client", () => ({ api: { consents: () => consents() } }));
vi.mock("../auth/SessionProvider", () => ({ useSession: () => ({ me: { account } }) }));
vi.mock("../phone/PhoneProvider", () => ({ usePhone: () => ({ state: { status: "idle" } }) }));
vi.mock("../env", () => ({ env: { mock: false, adsense: {} } }));

const { AdsProvider } = await import("./Ads");
const { adSenseConfig, ADSENSE_SCRIPT_ID } = await import("./adsense");
const CONFIG = adSenseConfig({ client: "ca-pub-0123456789012345", slotBanner: "1234567890" });
const npa = () => (window as unknown as { adsbygoogle?: { requestNonPersonalizedAds?: number } }).adsbygoogle?.requestNonPersonalizedAds;
const script = () => document.getElementById(ADSENSE_SCRIPT_ID);

afterEach(() => {
  script()?.remove();
  delete (window as unknown as { adsbygoogle?: unknown }).adsbygoogle;
  consents.mockReset();
  account = { plan: "free" };
});

describe("AdsProvider", () => {
  it("loads AdSense with personalised ads (npa = 0) only after ads_personalised was granted", async () => {
    consents.mockResolvedValue({ consents: [{ kind: "ads_personalised", granted: true }] });
    render(<AdsProvider config={CONFIG}>x</AdsProvider>);
    await waitFor(() => expect(script()).not.toBeNull());
    expect(npa()).toBe(0);
  });

  it("requests non-personalised ads (npa = 1) without the consent, after a withdrawal, or when the read fails", async () => {
    for (const answer of [
      () => Promise.resolve({ consents: [] }),
      () => Promise.resolve({ consents: [{ kind: "ads_personalised", granted: false }] }),
      () => Promise.reject(new Error("offline")),
    ]) {
      consents.mockImplementationOnce(answer);
      const { unmount } = render(<AdsProvider config={CONFIG}>x</AdsProvider>);
      await waitFor(() => expect(script()).not.toBeNull());
      expect(npa()).toBe(1);
      unmount();
      script()?.remove();
    }
  });

  it("never loads AdSense for Premium, the « Sans pub » add-on, or without AdSense ids", async () => {
    consents.mockResolvedValue({ consents: [] });
    for (const [acc, config] of [
      [{ plan: "premium" }, CONFIG],
      [{ plan: "free", addOns: ["no_ads"] }, CONFIG],
      [{ plan: "free" }, null],
    ] as const) {
      account = acc as typeof account;
      const { unmount } = render(<AdsProvider config={config}>x</AdsProvider>);
      await new Promise((r) => setTimeout(r, 20));
      expect(script()).toBeNull();
      unmount();
    }
    expect(consents).not.toHaveBeenCalled();
  });
});
