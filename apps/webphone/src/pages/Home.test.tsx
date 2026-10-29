// Accueil « Centre de contrôle » in demo mode (VITE_MOCK_API=1): default page after sign-in, numbers, availability
// toggle (PATCH /v1/me), routing, greeting, « À traiter » with call-back, wallet and the « Démarrage » checklist.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  vi.stubEnv("VITE_MOCK_API", "1");
  vi.resetModules();
  localStorage.removeItem("mimt.home.setupCelebrated");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

describe("Accueil (demo mode)", () => {
  it("is the default page and shows the control center", async () => {
    window.history.pushState(null, "", "/");
    const { App } = await import("../App");
    render(<App lang="fr" />);
    const takatak = await screen.findByRole("button", { name: "Continuer avec TAKATAK" }, { timeout: 5000 });
    await act(async () => {
      fireEvent.click(takatak);
    });

    expect(await screen.findByRole("heading", { level: 1, name: "Bonjour, Camille" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/accueil");
    expect(within(screen.getByRole("list", { name: "Vos numéros" })).getByText("514 555-0100")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Alertes du compte" })).toBeNull();

    // Where calls go and what callers hear.
    const route = screen.getByRole("region", { name: "Vos appels vont vers…" });
    expect(within(route).getByText("Vos appareils MIMT (Web et mobile)")).toBeInTheDocument();
    expect(within(route).getByRole("link", { name: /Modifier/ })).toHaveAttribute("href", "/compte/appels");
    const greeting = screen.getByRole("region", { name: "Ce que vos appelants entendent" });
    expect(await within(greeting).findByText("Accueil standard MIMT")).toBeInTheDocument();

    // À traiter: the unheard voicemail (AI summary) and unanswered texts; the missed caller who left it is not doubled.
    const todo = screen.getByRole("region", { name: "À traiter" });
    const items = await within(todo).findByRole("list", { name: "Éléments à traiter" });
    expect(within(items).getByText("Nouveau message vocal")).toBeInTheDocument();
    expect(within(items).getByText("Résumé IA")).toBeInTheDocument();
    expect(within(items).getAllByText("Texto sans réponse").length).toBeGreaterThan(0);
    expect(within(items).queryByText("Appel manqué")).toBeNull();
    // Rappeler opens the softphone with the number ready.
    await act(async () => {
      fireEvent.click(within(items).getByRole("button", { name: "Rappeler le 819 555-0123" }));
    });
    expect(screen.getByLabelText("Numéro à composer")).toHaveValue("+18195550123");

    // Wallet and the « Démarrage » checklist.
    const wallet = screen.getByRole("region", { name: "Points MIMT" });
    expect(within(wallet).getByRole("link", { name: "Gagner" })).toHaveAttribute("href", "/missions");
    expect(within(wallet).getByRole("link", { name: "Échanger" })).toHaveAttribute("href", "/points");
    const start = await screen.findByRole("region", { name: "Configurez votre ligne" });
    expect(within(start).getByRole("progressbar", { name: "Progression du démarrage" })).toHaveAttribute("aria-valuenow", "0");
    expect(within(start).getByRole("link", { name: "Faire : Choisissez votre @nom" })).toHaveAttribute("href", "/compte#nom");

    // Ne pas déranger: saved through PATCH /v1/me, shown in the sidebar too.
    const avail = screen.getByRole("group", { name: "Disponibilité" });
    expect(within(avail).getByRole("button", { name: "Disponible" })).toHaveAttribute("aria-pressed", "true");
    await act(async () => {
      fireEvent.click(within(avail).getByRole("button", { name: "Ne pas déranger" }));
    });
    expect(await screen.findByText(/Vos appels vont directement à la messagerie vocale/)).toBeInTheDocument();
    expect(within(avail).getByRole("button", { name: "Ne pas déranger" })).toHaveAttribute("aria-pressed", "true");
    expect(within(route).getByText("La messagerie vocale (Ne pas déranger)")).toBeInTheDocument();
    const side = screen.getByRole("complementary", { name: "Navigation principale" });
    expect(within(side).getByRole("link", { name: "Disponibilité : Ne pas déranger" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(avail).getByRole("button", { name: "Disponible" }));
    });
    expect(await screen.findByText("Vos appels sonnent normalement.")).toBeInTheDocument();
  });
});
