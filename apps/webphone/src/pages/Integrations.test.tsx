// Compte › Intégrations in demo mode (VITE_MOCK_API=1): connect Google Agenda, change a toggle, disconnect.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  vi.stubEnv("VITE_MOCK_API", "1");
  vi.resetModules();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Intégrations (demo mode)", () => {
  it("connects Google Agenda, saves a setting and disconnects", async () => {
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
    await act(async () => {
      fireEvent.click(await screen.findByRole("link", { name: "Intégrations (Google Agenda)" }));
    });
    expect(await screen.findByRole("heading", { name: "Intégrations" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Connecter" }));
    });
    expect(await screen.findByText("Google Agenda est connecté.")).toBeInTheDocument();
    expect(await screen.findByText("Compte Google : marie.tremblay@gmail.com")).toBeInTheDocument();

    const missed = await screen.findByRole("switch", { name: "Appels manqués" });
    expect(missed).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Inclure le résumé IA ou un extrait de la transcription" })).not.toBeChecked();
    await act(async () => {
      fireEvent.click(missed);
    });
    expect(await screen.findByText("Réglages enregistrés.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Appels manqués" })).not.toBeChecked();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Déconnecter" }));
    });
    expect(await screen.findByText("Google Agenda est déconnecté.")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Connecter" })).toBeInTheDocument();
  });
});
