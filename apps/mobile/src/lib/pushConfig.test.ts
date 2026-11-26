import { describe, expect, it, vi } from "vitest";

vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));

import { canRegisterPush, hasAndroidPush } from "./pushConfig";

describe("pushConfig", () => {
  it("Android registers only when Firebase is in the build", () => {
    expect(canRegisterPush("android", { androidPush: true })).toBe(true);
    expect(canRegisterPush("android", {})).toBe(false);
    expect(canRegisterPush("android", undefined)).toBe(false);
    expect(hasAndroidPush({ androidPush: "true" })).toBe(false);
  });
  it("iOS always registers, web never", () => {
    expect(canRegisterPush("ios", {})).toBe(true);
    expect(canRegisterPush("web", { androidPush: true })).toBe(false);
  });
});
