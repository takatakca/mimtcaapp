// Missions MIMT in demo mode (VITE_MOCK_API=1): the reward comes from the server's answer (never a claim), the app
// celebrates it once, and the Missions page shows progress, rules and the referral share (copy fallback).
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { PLANS } from "@mimt/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  vi.stubEnv("VITE_MOCK_API", "1");
  vi.resetModules();
  localStorage.clear();
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Missions MIMT (demo mode)", () => {
  it("celebrates the @nom mission once, then shows progress, rules and the invite link", async () => {
    window.history.pushState(null, "", "/");
    const { App } = await import("../App");
    render(<App lang="fr" />);
    await new Promise((r) => setTimeout(r, 500));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Continuer avec TAKATAK" }));
    });
    const side = await screen.findByRole("complementary", { name: "Navigation principale" });
    await act(async () => {
      fireEvent.click(within(side).getByRole("link", { name: "Compte" }));
    });
    expect(await screen.findByRole("link", { name: /Missions : gagnez des minutes/ })).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText("Identifiant"), { target: { value: "Matt.QC" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Choisir cet identifiant" }));
    });
    expect(await screen.findByText(/Mission accomplie : Choisissez votre @nom! \+30 min ajoutées au mois en cours\./)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(side).getByRole("link", { name: "Missions" }));
    });
    expect(await screen.findByRole("heading", { level: 2, name: "1 sur 7 missions accomplies" })).toBeInTheDocument();
    expect(screen.getByText("30 min gagnées sur 150 possibles")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Progression des missions" })).toHaveAttribute("aria-valuenow", "14");
    const items = screen.getAllByRole("listitem").filter((li) => li.classList.contains("mission"));
    expect(items).toHaveLength(7);
    expect(within(items[1]!).getByText("Accomplie")).toBeInTheDocument();
    expect(within(items[0]!).queryByRole("link")).toBeNull();
    expect(within(items[2]!).getByRole("link", { name: "Y aller : Activez les notifications" })).toHaveAttribute("href", "/compte#notifications");
    // Rules box: no purchase, no chance, no cash value, current month, once, no social rewards.
    expect(screen.getByText(/Aucun tirage, aucun hasard/)).toBeInTheDocument();
    expect(screen.getByText(/aucune valeur en argent/)).toBeInTheDocument();
    expect(screen.getByText(/s'ajoutent au mois en cours/)).toBeInTheDocument();
    expect(screen.getByText(/ne récompense jamais un avis/)).toBeInTheDocument();

    // Invite: no navigator.share in this browser → the link is copied.
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    expect(await screen.findByText("Votre code : DEMO2345")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Inviter un ami" }));
    });
    expect(writeText).toHaveBeenCalledWith("https://mimt.ca/invitation/DEMO2345");
    expect(await screen.findByText("Lien copié.")).toBeInTheDocument();

    // The toast is not shown twice for the same mission.
    const { celebrateMission } = await import("../lib/missions");
    act(() => celebrateMission({ id: "choose_handle", minutes: 30, pending: false }));
    expect(screen.queryAllByText(/Mission accomplie : Choisissez votre @nom/).length).toBeLessThanOrEqual(1);
  });
});

describe("yearly plan price (12 months for the price of 11)", () => {
  it("shows the yearly total and the honest per-month equivalent, taxes extra", async () => {
    const { I18nProvider } = await import("../i18n/I18nProvider");
    const { PlanPrice, intervalPrice } = await import("../components/IntervalToggle");
    expect(intervalPrice(PLANS.lock, "year")).toEqual({ totalCents: 14289, perMonthCents: 1191, savingCents: 1299 });
    expect(intervalPrice(PLANS.premium, "month")).toEqual({ totalCents: 2999, perMonthCents: 2999, savingCents: 0 });
    render(
      <I18nProvider initial="fr">
        <p data-testid="y">
          <PlanPrice plan={PLANS.lock} interval="year" />
        </p>
        <p data-testid="m">
          <PlanPrice plan={PLANS.business} interval="month" />
        </p>
      </I18nProvider>,
    );
    expect(screen.getByTestId("y").textContent?.replace(/ | /g, " ")).toBe("142,89 $ / an soit 11,91 $ / mois, taxes en sus");
    expect(screen.getByTestId("m").textContent?.replace(/ | /g, " ")).toBe("34,99 $ / ligne / mois");
  });
});

describe("usage rows with mission minutes", () => {
  it("bonus minutes raise this month's cap; the free plan shows its app-to-app pool", async () => {
    const { usageRows } = await import("../lib/usage");
    expect(usageRows("free", { outboundMinutes: 0, inboundMinutes: 0, messages: 0, onNetMinutes: 60, bonusOnNetMinutes: 30 })).toEqual([
      { key: "onNetMinutes", used: 60, cap: 150, percent: 40, level: "ok" },
    ]);
    expect(usageRows("lock", { outboundMinutes: 60, inboundMinutes: 0, messages: 0, bonusOutboundMinutes: 60 })[0]).toEqual({
      key: "outboundMinutes",
      used: 60,
      cap: 120,
      percent: 50,
      level: "ok",
    });
  });
});
