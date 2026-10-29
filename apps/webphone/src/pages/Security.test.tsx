// Paramètres › Sécurité in demo mode (VITE_MOCK_API=1): connected devices, « Déconnecter partout ailleurs »,
// passkey add/remove, and the step-up dialog when a confirmation is needed.
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

describe("Sécurité (demo mode)", () => {
  it("lists devices, signs out the others, adds and removes a passkey", async () => {
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
      fireEvent.click(await screen.findByRole("link", { name: "Sécurité et appareils" }));
    });
    expect(await screen.findByRole("heading", { name: "Sécurité" })).toBeInTheDocument();

    const devices = await screen.findByRole("list", { name: "Appareils connectés" });
    expect(await within(devices).findByText("Cet appareil")).toBeInTheDocument();
    expect(within(devices).getByText(/Safari · iOS/)).toBeInTheDocument();
    expect(within(devices).getByRole("button", { name: "Déconnecter Safari · iOS" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Déconnecter partout ailleurs" }));
    });
    expect(await screen.findByText("Autres appareils déconnectés : 1.")).toBeInTheDocument();
    expect(await screen.findByText("Aucun autre appareil n'est connecté.")).toBeInTheDocument();

    // Passkeys: none yet, add one (the demo skips the browser prompt), then remove it.
    expect(await screen.findByText("Aucune clé d'accès pour le moment.")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ajouter une clé d'accès" }));
    });
    expect(await screen.findByText("Clé d'accès ajoutée.")).toBeInTheDocument();
    const keys = screen.getByRole("list", { name: "Clés d'accès" });
    expect(within(keys).getByText("Synchronisée")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(keys).getByRole("button", { name: /Supprimer la clé d'accès/ }));
    });
    expect(await screen.findByText("Clé d'accès supprimée.")).toBeInTheDocument();
  });

  it("recognises step_up_required and confirms with a fresh SMS code", async () => {
    const { StepUpPanel, isStepUpRequired } = await import("../components/StepUp");
    const { ApiClientError } = await import("../api/errors");
    expect(isStepUpRequired(new ApiClientError(403, "step_up_required", "error.stepUpRequired", "x"))).toBe(true);
    expect(isStepUpRequired(new ApiClientError(403, "forbidden", "error.forbidden", "x"))).toBe(false);
    const { I18nProvider } = await import("../i18n/I18nProvider");
    const done = vi.fn();
    render(
      <I18nProvider initial="fr">
        <StepUpPanel onDone={done} />
      </I18nProvider>,
    );
    // Found outside act(): the fixture API answers after a short simulated latency.
    const sms = await screen.findByRole("button", { name: "Recevoir un code au •••-•••-0142" }, { timeout: 4000 });
    await act(async () => {
      fireEvent.click(sms);
    });
    fireEvent.change(await screen.findByLabelText("Code reçu par texto"), { target: { value: "123456" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirmer" }));
    });
    expect(done).toHaveBeenCalled();
  });
});
