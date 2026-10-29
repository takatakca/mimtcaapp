// MIMT handle in demo mode (VITE_MOCK_API=1): pick @nom in Account, then text another MIMT user by handle.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  vi.stubEnv("VITE_MOCK_API", "1");
  vi.resetModules();
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("MIMT handle (demo mode)", () => {
  it("picks a handle once, then texts @camille without a number", async () => {
    window.history.pushState(null, "", "/");
    const { App } = await import("../App");
    render(<App lang="fr" />);
    await new Promise((r) => setTimeout(r, 500));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Continuer avec TAKATAK" }));
    });
    const side = await screen.findByRole("complementary", { name: "Navigation principale" });
    await act(async () => {
      fireEvent.click(within(side).getByRole("link", { name: "Mon compte" }));
    });
    const input = await screen.findByLabelText("Identifiant");
    fireEvent.change(input, { target: { value: "Matt.QC" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Choisir cet identifiant" }));
    });
    expect(await screen.findByText("@matt.qc")).toBeInTheDocument();

    const { api } = await import("../api/client");
    const sent = await api.sendMessage({ to: "@camille", body: "Salut!" });
    expect(sent).toMatchObject({ ourNumber: "@matt.qc", peer: "@camille", status: "delivered" });
    await expect(api.sendMessage({ to: "@personne", body: "?" })).rejects.toMatchObject({ code: "handle_not_found" });
  });
});
