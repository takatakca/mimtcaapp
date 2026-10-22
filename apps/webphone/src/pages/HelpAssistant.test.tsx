// /aide in demo mode: consent first, then a question gets an answer from the assistant.
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

describe("Help assistant (demo mode)", () => {
  it("asks for the AI consent, then answers a question", async () => {
    window.history.pushState(null, "", "/");
    const { App } = await import("../App");
    render(<App lang="fr" />);
    await new Promise((r) => setTimeout(r, 500));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Continuer avec TAKATAK" }));
    });
    const side = await screen.findByRole("complementary", { name: "Navigation principale" });
    await act(async () => {
      fireEvent.click(within(side).getByRole("link", { name: "Aide" }));
    });
    const agree = screen.queryByRole("button", { name: "J'accepte, utiliser l'assistant" });
    if (agree) {
      await act(async () => {
        fireEvent.click(agree);
      });
    }
    const input = await screen.findByLabelText("Votre question");
    fireEvent.change(input, { target: { value: "Comment transférer mon numéro?" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    });
    expect(await screen.findByText(/Services › Transférer un numéro/)).toBeInTheDocument();
  });
});
