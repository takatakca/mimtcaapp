// « Espace agent affilié » in demo mode (VITE_MOCK_API=1): link and code, counts, payout progress, ledger and rules.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { payoutProgress } from "./Affiliate";

beforeAll(() => {
  vi.stubEnv("VITE_MOCK_API", "1");
  vi.resetModules();
  localStorage.clear();
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("affiliate dashboard (demo mode)", () => {
  it("shows the link, the counts, the payout threshold progress, the ledger and the rules", async () => {
    window.history.pushState(null, "", "/");
    const { App } = await import("../App");
    render(<App lang="fr" />);
    await new Promise((r) => setTimeout(r, 500));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Continuer avec TAKATAK" }));
    });
    await screen.findByRole("complementary", { name: "Navigation principale" });
    await act(async () => {
      window.history.pushState(null, "", "/affilie");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Espace agent affilié" })).toBeInTheDocument();
    expect(screen.getByText("https://app.mimt.ca/?aff=DEMO2345")).toBeInTheDocument();
    expect(screen.getByText("Code : DEMO2345")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copier le lien/ })).toBeInTheDocument();
    expect(screen.getByText("20 % des revenus nets")).toBeInTheDocument();
    expect(screen.getByText("12 mois")).toBeInTheDocument();
    // 599 ¢ payable out of a 50 $ threshold.
    expect(screen.getByRole("progressbar", { name: "Progression vers le seuil de paiement" })).toHaveAttribute("aria-valuenow", "12");
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(5);
    expect(within(table).getByText("Payé")).toBeInTheDocument();
    expect(screen.getByText(/Lien affilié : je reçois une commission/)).toBeInTheDocument();
    expect(screen.getByText(/Loi canadienne anti-pourriel/)).toBeInTheDocument();
  });

  it("payout progress is capped at 100 % and handles a zero threshold", () => {
    expect(payoutProgress(2500, 5000)).toBe(50);
    expect(payoutProgress(9000, 5000)).toBe(100);
    expect(payoutProgress(-100, 5000)).toBe(0);
    expect(payoutProgress(1, 0)).toBe(100);
  });
});
