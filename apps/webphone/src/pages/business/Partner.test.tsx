// « MIMT Connect » owner section in demo mode (VITE_MOCK_API=1, mock.partner.ts): credits, keys shown once,
// webhook secret shown once, last calls; French by default.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  vi.stubEnv("VITE_MOCK_API", "1");
  vi.resetModules();
});
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function signedIn(path: string) {
  const mock = await import("../../api/mock");
  mock.resetMockState();
  window.history.pushState(null, "", path);
  const { App } = await import("../../App");
  render(<App lang="fr" />);
  const takatak = await screen.findByRole("button", { name: "Continuer avec TAKATAK" }, { timeout: 800 }).catch(() => null);
  if (takatak) {
    await act(async () => {
      fireEvent.click(takatak);
    });
  }
}

const click = async (el: HTMLElement) => {
  await act(async () => {
    fireEvent.click(el);
  });
};

describe("/affaires/:id/partenaire (demo mode)", () => {
  it("shows credits, creates a key shown once, saves the webhook and lists the last calls", async () => {
    await signedIn("/");
    const side = await screen.findByRole("complementary", { name: "Navigation principale" });
    await click(await within(side).findByRole("link", { name: /Café Lumière/ }));
    await click(await screen.findByRole("link", { name: "Partenaire" }));
    expect(await screen.findByText(/^4\s820 crédits$/, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText(/mimt_pk_Q3x9aB/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nom de la clé (facultatif)"), { target: { value: "CRM" } });
    await click(screen.getByRole("button", { name: "Créer une clé" }));
    expect(await screen.findByText("Copiez cette clé maintenant : elle ne sera plus jamais affichée.")).toBeInTheDocument();
    const shown = screen.getByText(/^mimt_pk_[a-z0-9]{24}$/);
    expect(shown).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Adresse du webhook (https)"), { target: { value: "https://besoinavocat.ca/hooks/mimt" } });
    fireEvent.click(screen.getByLabelText("Nouveau secret de signature"));
    await click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Secret de signature, affiché une seule fois :")).toBeInTheDocument();
    expect(screen.getByText(/^whsec_/)).toBeInTheDocument();

    const calls = screen.getByRole("heading", { name: "Derniers appels" }).closest("section")!;
    expect(within(calls).getByText(/Membre avocat-42/)).toBeInTheDocument();
    expect(within(calls).getByText("Facturé")).toBeInTheDocument();
    expect(within(calls).getByText("Personne n'a répondu", { exact: false })).toBeInTheDocument();
  });
});
