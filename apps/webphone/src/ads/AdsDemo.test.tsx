// Demo app (VITE_MOCK_API=1) for a free account: the ad placeholder sits under the Messages list and in the
// desktop sidebar, never on Compte; no Google script in demo mode; ads consent off by default.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("demo app, free account", () => {
  beforeAll(() => {
    vi.stubEnv("VITE_MOCK_API", "1");
    localStorage.setItem("mimt.demo.plan", "free");
    vi.resetModules();
  });
  afterAll(() => {
    localStorage.removeItem("mimt.demo.plan");
    vi.unstubAllEnvs();
  });

  it("shows the ad placeholder under the Messages list, none on Compte, and the ads consent off by default", async () => {
    window.history.pushState(null, "", "/");
    const { App } = await import("../App");
    render(<App lang="fr" />);
    const takatak = await screen.findByRole("button", { name: "Continuer avec TAKATAK" });
    await act(async () => {
      fireEvent.click(takatak);
    });
    // Home first (no ads there), then Messages.
    await screen.findByRole("heading", { level: 1, name: "Bonjour, Camille" });
    expect(screen.queryByRole("complementary", { name: "Publicité" })).toBeNull();
    await act(async () => {
      fireEvent.click(within(screen.getByRole("complementary", { name: "Navigation principale" })).getByRole("link", { name: "Messages" }));
    });
    await screen.findByRole("heading", { level: 1, name: "Messages" });
    const ads = await screen.findAllByRole("complementary", { name: "Publicité" });
    expect(ads.map((a) => a.className)).toEqual(expect.arrayContaining(["ad ad--banner", "ad ad--sidebar"]));
    expect(document.querySelector("script#mimt-adsense")).toBeNull();

    const side = screen.getByRole("complementary", { name: "Navigation principale" });
    await act(async () => {
      fireEvent.click(within(side).getByRole("link", { name: "Mon compte" }));
    });
    await screen.findByRole("heading", { level: 1, name: "Compte" });
    expect(screen.queryByRole("complementary", { name: "Publicité" })).toBeNull();
    const toggle = await screen.findByRole("switch", { name: /Publicités personnalisées/ });
    expect(toggle).not.toBeChecked();
    expect(screen.getByRole("button", { name: /Sans pub, 3,99/ })).toBeInTheDocument();
  });
});
