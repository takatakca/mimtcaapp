// « Pilote MIMT » command bar in demo mode: keyboard opening, live steps, confirmation card, navigation.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { findTarget, pilotPath } from "./paths";

beforeAll(() => {
  vi.stubEnv("VITE_MOCK_API", "1");
  vi.resetModules();
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function signIn() {
  window.history.pushState(null, "", "/");
  const { App } = await import("../App");
  render(<App lang="fr" />);
  await new Promise((r) => setTimeout(r, 300));
  // The session survives between tests (tokens in storage): sign in only when asked.
  const signInButton = screen.queryByRole("button", { name: "Continuer avec TAKATAK" });
  if (signInButton) {
    await act(async () => {
      fireEvent.click(signInButton);
    });
  }
  await screen.findByRole("complementary", { name: "Navigation principale" });
}

describe("Pilote MIMT command bar (demo mode)", () => {
  it("opens with Ctrl+K and '/', closes with Escape, runs a confirmed action and navigates", async () => {
    await signIn();
    expect(screen.queryByRole("dialog", { name: /Pilote MIMT/ })).toBeNull();

    // Ctrl+K opens, Escape closes.
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    expect(await screen.findByRole("dialog", { name: /Pilote MIMT/ })).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog", { name: /Pilote MIMT/ })).toBeNull();

    // "/" opens when not typing in a field.
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "/" });
    });
    const dialog = await screen.findByRole("dialog", { name: /Pilote MIMT/ });
    const input = within(dialog).getByLabelText("Commande pour le Pilote MIMT");
    expect(input).toHaveFocus();
    // "/" typed inside the input is text, not a shortcut.
    fireEvent.keyDown(input, { key: "/" });
    expect(screen.getByRole("dialog", { name: /Pilote MIMT/ })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Bloque le 514 555 0177" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Exécuter" }));
    });
    const console = await within(dialog).findByRole("list", { name: "Console du Pilote" });
    expect(await within(console).findByText(/Commande reçue : « Bloque le 514 555 0177 »/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(await within(console).findByText(/Action proposée : bloquer le 514 555-0177/, {}, { timeout: 5000 })).toBeInTheDocument();

    // Nothing happens before confirmation: the card shows what will change.
    const card = await within(dialog).findByRole("group", { name: "Confirmer avant d'agir" }, { timeout: 5000 });
    expect(within(card).getByText("bloquer le 514 555-0177")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: "Confirmer" }));
    });
    expect(await within(console).findByText(/Résultat : c'est fait/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(await within(console).findByText(/Navigation : Paramètres d'appel/, {}, { timeout: 5000 })).toBeInTheDocument();
    await vi.waitFor(() => expect(window.location.pathname).toBe("/compte/appels"), { timeout: 5000 });
    // The blocked number now shows in the « Numéros bloqués » section the Pilote opened.
    await vi.waitFor(
      () => expect(within(document.querySelector<HTMLElement>('[aria-labelledby="blocks-h"]')!).getByText(/514 555-0177/)).toBeInTheDocument(),
      { timeout: 5000 },
    );
  });

  it("read-only commands run at once without a confirmation card; cancel leaves things unchanged", async () => {
    await signIn();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ouvrir le Pilote MIMT (Ctrl+K)" }));
    });
    const dialog = await screen.findByRole("dialog", { name: /Pilote MIMT/ });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Montre-moi mes appels manqués" }));
    });
    expect(await within(dialog).findByText(/Navigation : Appels/, {}, { timeout: 5000 })).toBeInTheDocument();
    await vi.waitFor(() => expect(window.location.pathname + window.location.search).toBe("/appels?filtre=missed"), { timeout: 5000 });
    expect(within(dialog).queryByRole("group", { name: "Confirmer avant d'agir" })).toBeNull();
    expect(await screen.findByText("Filtre : appels manqués")).toBeInTheDocument();

    const input = within(dialog).getByLabelText("Commande pour le Pilote MIMT");
    fireEvent.change(input, { target: { value: "active ne pas déranger" } });
    await act(async () => {
      fireEvent.submit(input.closest("form")!);
    });
    const card = await within(dialog).findByRole("group", { name: "Confirmer avant d'agir" }, { timeout: 5000 });
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: "Annuler" }));
    });
    expect(await within(dialog).findByText(/Annulé : rien n'a été changé/, {}, { timeout: 5000 })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "supprime mon compte" } });
    await act(async () => {
      fireEvent.submit(input.closest("form")!);
    });
    expect(await within(dialog).findByText(/ne fait jamais cette action/, {}, { timeout: 5000 })).toBeInTheDocument();
  });
});

describe("pilot paths", () => {
  it("maps pages to the app's French URLs", () => {
    expect(pilotPath({ page: "call_settings", highlight: "forwarding" })).toBe("/compte/appels");
    expect(pilotPath({ page: "calls", query: { filtre: "missed" } })).toBe("/appels?filtre=missed");
    expect(pilotPath({ page: "messages", param: "+15145550123" })).toBe("/messages/%2B15145550123");
    expect(pilotPath({ page: "business_hours", param: "b1" })).toBe("/affaires/b1/heures");
    expect(pilotPath({ page: "business_receptionist" }, "b2")).toBe("/affaires/b2/receptionniste-ia");
    expect(pilotPath({ page: "business" })).toBe("/affaires/nouvelle");
  });

  it("finds existing sections without page changes", () => {
    document.body.innerHTML = '<main id="main"><section aria-labelledby="fwd-h">x</section><li data-pilot="vm-1">y</li></main>';
    expect(findTarget(document, "forwarding")?.textContent).toBe("x");
    expect(findTarget(document, "vm-1")?.textContent).toBe("y");
    expect(findTarget(document, 'x"]')).toBeNull();
  });

  it("calls only routes that apps/api declares", () => {
    const src = readFileSync(join(__dirname, "../../../api/src/routes/aiPilot.ts"), "utf8");
    for (const r of ["/v1/ai/command", "/v1/ai/command/confirm", "/v1/ai/command/cancel"]) expect(src).toContain(`app.post("${r}"`);
  });
});
