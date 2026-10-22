import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  value: "false",
  failWrite: false,
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => storage.value),
  setItemAsync: vi.fn(async (_key: string, value: string) => {
    if (storage.failWrite) throw new Error("secure storage unavailable");
    storage.value = value;
  }),
}));
vi.mock("expo-tracking-transparency", () => ({
  getTrackingPermissionsAsync: vi.fn(async () => ({ granted: true })),
  requestTrackingPermissionsAsync: vi.fn(async () => ({ granted: true })),
}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

import { adRequestOptions, setPersonalisedConsent } from "./ads";

describe("personalised ad consent is fail-closed", () => {
  beforeEach(async () => {
    storage.failWrite = false;
    storage.value = "false";
    await setPersonalisedConsent(false, false);
  });

  it("never requests personalised ads before opt-in, nor after withdrawal", async () => {
    expect(adRequestOptions().requestNonPersonalizedAdsOnly).toBe(true);
    await setPersonalisedConsent(true, false);
    expect(adRequestOptions().requestNonPersonalizedAdsOnly).toBe(false);
    await setPersonalisedConsent(false, false);
    expect(adRequestOptions().requestNonPersonalizedAdsOnly).toBe(true);
  });

  it("disables personalised requests immediately when the secure store cannot be written", async () => {
    await setPersonalisedConsent(true, false);
    expect(adRequestOptions().requestNonPersonalizedAdsOnly).toBe(false);
    storage.failWrite = true;
    await expect(setPersonalisedConsent(false, false)).rejects.toThrow("secure storage unavailable");
    expect(adRequestOptions().requestNonPersonalizedAdsOnly).toBe(true);
  });
});

describe("AdMob unit ids", () => {
  const sdk = { TestIds: { ADAPTIVE_BANNER: "test-banner", REWARDED: "test-rewarded" } } as never;
  it("uses the owner's real units for the platform when valid, test units otherwise", async () => {
    const { unitIds } = await import("./ads");
    const cfg = { ios: { banner: "ca-app-pub-1234567890123456/1234567890", rewarded: "oops" }, android: { banner: null, rewarded: null } };
    expect(unitIds(sdk, "ios", cfg)).toEqual({ banner: "ca-app-pub-1234567890123456/1234567890", rewarded: "test-rewarded" });
    expect(unitIds(sdk, "android", cfg)).toEqual({ banner: "test-banner", rewarded: "test-rewarded" });
    expect(unitIds(sdk, "ios", undefined)).toEqual({ banner: "test-banner", rewarded: "test-rewarded" });
  });
});
