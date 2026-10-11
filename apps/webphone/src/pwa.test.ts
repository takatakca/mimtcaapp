import { describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "./pwa";

describe("registerServiceWorker", () => {
  it("does nothing outside production builds", () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const nav = { serviceWorker: { register } } as unknown as Navigator;
    expect(registerServiceWorker({ PROD: false }, nav)).toBe(false);
    window.dispatchEvent(new Event("load"));
    expect(register).not.toHaveBeenCalled();
  });

  it("registers /sw.js at the root scope in production, after load", () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const nav = { serviceWorker: { register } } as unknown as Navigator;
    expect(registerServiceWorker({ PROD: true }, nav)).toBe(true);
    window.dispatchEvent(new Event("load"));
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });

  it("skips browsers without service workers", () => {
    expect(registerServiceWorker({ PROD: true }, {} as Navigator)).toBe(false);
  });
});
