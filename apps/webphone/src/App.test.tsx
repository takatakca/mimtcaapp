// Smoke test of the whole app in demo mode (VITE_MOCK_API=1): sign in, read messages, open the
// business admin portal and the 9-1-1 keypad warning. No network, no Twilio.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  vi.stubEnv("VITE_MOCK_API", "1");
  vi.resetModules();
});
afterAll(() => {
  vi.unstubAllEnvs();
});

describe("App (demo mode)", () => {
  it("signs in and navigates the main screens in French", async () => {
    window.history.pushState(null, "", "/");
    const { App } = await import("./App");
    render(<App lang="fr" />);

    // Signed out: redirected to /connexion.
    const takatak = await screen.findByRole("button", { name: "Continuer avec TAKATAK" });
    expect(screen.getByText(/le 9-1-1 est toujours permis/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(takatak);
    });

    // Messages with the demo conversation.
    expect(await screen.findByRole("heading", { level: 1, name: "Messages" })).toBeInTheDocument();
    expect(await screen.findAllByText("438 555-0142")).not.toHaveLength(0);
    expect(screen.getByText(/Mode démo/)).toBeInTheDocument();

    // Business portal from the sidebar.
    const side = screen.getByRole("complementary", { name: "Navigation principale" });
    await act(async () => {
      fireEvent.click(within(side).getByRole("link", { name: "Café Lumière inc." }));
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Café Lumière inc." })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "Postes" }));
    });
    expect(await screen.findByText("Comptabilité")).toBeInTheDocument();

    // Softphone: typing 911 shows the emergency button, never a block.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ouvrir le téléphone" }));
    });
    fireEvent.change(screen.getByLabelText("Numéro à composer"), { target: { value: "911" } });
    expect(screen.getByRole("button", { name: /Appeler le 9-1-1/ })).toBeEnabled();
  });
});
