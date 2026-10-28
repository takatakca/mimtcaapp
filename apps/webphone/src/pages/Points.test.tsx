// Portefeuille (MIMT Points) in demo mode (VITE_MOCK_API=1): points come from a server-side event (a mission granted
// by the API's answer), the balance shows in the sidebar, a reward is redeemed after a confirm step, the same
// confirmation never spends twice, and the rules box says what the law requires.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  vi.stubEnv("VITE_MOCK_API", "1");
  vi.resetModules();
  localStorage.clear();
  localStorage.setItem("mimt.demo.plan", "free");
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  localStorage.removeItem("mimt.demo.plan");
});

describe("Portefeuille (demo mode)", () => {
  it("earns points from a mission, shows them, redeems a reward with a confirm step", async () => {
    window.history.pushState(null, "", "/");
    const { App } = await import("../App");
    render(<App lang="fr" />);
    await new Promise((r) => setTimeout(r, 500));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Continuer avec TAKATAK" }));
    });
    const side = await screen.findByRole("complementary", { name: "Navigation principale" });
    // A mission granted by the API's answer (the @nom), never by a claim.
    await act(async () => {
      fireEvent.click(within(side).getByRole("link", { name: "Compte" }));
    });
    fireEvent.change(await screen.findByLabelText("Identifiant"), { target: { value: "Points.QC" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Choisir cet identifiant" }));
    });
    expect(await screen.findByText(/\+300 points dans votre Portefeuille/)).toBeInTheDocument();
    expect(await within(side).findByLabelText("300 points")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(side).getByRole("link", { name: /Portefeuille/ }));
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Portefeuille" })).toBeInTheDocument();
    expect(screen.getByText("300 points", { selector: ".sr-only" })).toBeInTheDocument();
    expect(screen.getByText(/×2 : Double points sur l'annuel/)).toBeInTheDocument();
    expect(screen.getByText("Mission : Choisissez votre @nom")).toBeInTheDocument();

    // Paid-plan rewards are locked on the free plan; the free plan's minutes are available.
    const card = (name: string) => screen.getByText(name, { selector: ".pts-card__title" }).closest("li")!;
    expect(within(card("30 minutes en prime")).getByRole("button", { name: /Échanger/ })).toBeDisabled();
    expect(within(card("30 minutes en prime")).getByText("Pas offert avec votre forfait.")).toBeInTheDocument();
    expect(within(card("100 minutes en prime")).getByText("Pas offert avec votre forfait.")).toBeInTheDocument();

    const minutes = card("60 minutes entre apps MIMT");
    await act(async () => {
      fireEvent.click(within(minutes).getByRole("button", { name: "Échanger : 60 minutes entre apps MIMT" }));
    });
    expect(within(minutes).getByText("Échanger 150 points contre « 60 minutes entre apps MIMT »?")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(minutes).getByRole("button", { name: "Confirmer" }));
    });
    expect(await within(card("60 minutes entre apps MIMT")).findByText(/C'est fait/)).toBeInTheDocument();
    expect(await screen.findByText("150 points", { selector: ".sr-only" })).toBeInTheDocument();
    expect(await screen.findByText("60 minutes entre apps MIMT", { selector: ".pts-history__label" })).toBeInTheDocument();

    // Rules: no cash value, no draw, no social rewards.
    expect(screen.getByText(/aucune valeur en argent/)).toBeInTheDocument();
    expect(screen.getByText(/Aucun tirage, aucun hasard/)).toBeInTheDocument();
    expect(screen.getByText(/Aucun point pour un avis/)).toBeInTheDocument();
  });

  it("history labels never show raw codes", async () => {
    const { entryLabel, newCredits } = await import("../lib/points");
    expect(entryLabel({ label: "invoice", reason: "purchase", campaignName: null }, "fr")).toBe("Facture payée");
    expect(entryLabel({ label: "reward:texts_50", reason: "refund", campaignName: null }, "en")).toBe("Points returned: 50 bonus texts");
    expect(entryLabel({ label: "invoice", reason: "campaign", campaignName: "Double" }, "fr")).toBe("Campagne : Double");
    const h = [
      { id: "3", delta: 129, reason: "purchase" as const, label: "invoice", campaignName: null, balanceAfter: 429, createdAt: "" },
      { id: "2", delta: 300, reason: "mission" as const, label: "mission:choose_handle", campaignName: null, balanceAfter: 300, createdAt: "" },
      { id: "1", delta: -10, reason: "redeem" as const, label: "reward:x", campaignName: null, balanceAfter: 0, createdAt: "" },
    ];
    expect(newCredits(h, "1").map((e) => e.id)).toEqual(["3"]);
    expect(newCredits(h, "3")).toEqual([]);
    expect(newCredits(h, null)).toEqual([]);
  });
});
