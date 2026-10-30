// « MIMT Connect » account link in demo mode (VITE_MOCK_API=1): /lier?code=… shows who asks and what they will see,
// approval links the account, Compte › Intégrations › Partenaires lists the link and revokes it.
import { act, fireEvent, render, screen } from "@testing-library/react";
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

/** Signs in (demo) if needed, then opens `path` like a link would. */
async function open(path: string) {
  window.history.pushState(null, "", "/");
  const { App } = await import("../App");
  render(<App lang="fr" />);
  await new Promise((r) => setTimeout(r, 500));
  const button = screen.queryByRole("button", { name: "Continuer avec TAKATAK" });
  if (button) {
    await act(async () => {
      fireEvent.click(button);
    });
  }
  await screen.findByRole("complementary", { name: "Navigation principale" });
  await act(async () => {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

describe("Liaison de compte partenaire (demo mode)", () => {
  it("approves a link from /lier, then revokes it in Intégrations", async () => {
    await open("/lier?code=bavc-2345&r=lr-demo");
    expect(await screen.findByRole("heading", { name: "BesoinAvocat veut relier votre compte MIMT à votre profil (identifiant avocat-42)." })).toBeInTheDocument();
    expect(screen.getByText(/lancer des appels en votre nom/)).toBeInTheDocument();
    expect(screen.getByText(/voir et utiliser le numéro MIMT que vous choisissez/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Autoriser" }));
    });
    expect(await screen.findByText("Votre compte MIMT est relié à BesoinAvocat.")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "Voir mes intégrations" }));
    });
    expect(await screen.findByRole("heading", { name: "Partenaires" })).toBeInTheDocument();
    expect(await screen.findByText("BesoinAvocat — profil avocat-42")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retirer le lien" }));
    });
    expect(await screen.findByText("Le lien a été retiré.")).toBeInTheDocument();
    expect(await screen.findByText("Aucun partenaire n'est relié à votre compte.")).toBeInTheDocument();
  });

  it("a wrong code typed by hand is refused", async () => {
    await open("/lier");
    fireEvent.change(await screen.findByLabelText("Code reçu du partenaire"), { target: { value: "ZZZZ2222" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Vérifier le code" }));
    });
    expect(await screen.findByText("Ce code n'est pas valide. Vérifiez-le et réessayez.")).toBeInTheDocument();
  });
});
