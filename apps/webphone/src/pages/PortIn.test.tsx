// Port-in page in demo mode (VITE_MOCK_API=1): request a transfer, sign the LOA, follow and cancel it.
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

describe("parseNumbers", () => {
  let parseNumbers: typeof import("./PortIn").parseNumbers;
  beforeAll(async () => {
    ({ parseNumbers } = await import("./PortIn"));
  });
  it("accepts 10-digit Canadian numbers in common formats and drops duplicates", () => {
    expect(parseNumbers("514 555-0123\n(450) 555-0124, 1-514-555-0123")).toEqual(["+15145550123", "+14505550124"]);
  });
  it("refuses 9-1-1, short numbers, empty input and more than 20 numbers", () => {
    expect(parseNumbers("911")).toBeNull();
    expect(parseNumbers("555-0123")).toBeNull();
    expect(parseNumbers("  ")).toBeNull();
    expect(parseNumbers(Array.from({ length: 21 }, (_, i) => `514555${String(1000 + i)}`).join("\n"))).toBeNull();
  });
});

describe("PortIn page (demo mode)", () => {
  it("lists transfers, creates one, signs the LOA and cancels it, in French", async () => {
    window.history.pushState(null, "", "/");
    const { App } = await import("../App");
    render(<App lang="fr" />);
    const takatak = await screen.findByRole("button", { name: "Continuer avec TAKATAK" });
    await act(async () => {
      fireEvent.click(takatak);
    });
    // From the sidebar (« Boutique » → its « Transférer un numéro » tab).
    const side = await screen.findByRole("complementary", { name: "Navigation principale" });
    await act(async () => {
      fireEvent.click(within(side).getByRole("link", { name: "Boutique" }));
    });
    const tabs = await screen.findByRole("navigation", { name: "Sections de la boutique" });
    await act(async () => {
      fireEvent.click(within(tabs).getByRole("link", { name: "Transférer un numéro" }));
    });

    expect(await screen.findByRole("heading", { level: 1, name: "Transférer mon numéro" })).toBeInTheDocument();
    expect(screen.getByText(/Le 9-1-1 reste toujours permis/)).toBeInTheDocument();
    // Demo request with a confirmed date.
    const demo = await screen.findByRole("article", { name: "514 555-0177" });
    expect(within(demo).getByText("Date confirmée")).toBeInTheDocument();
    expect(within(demo).getByText(/Date de transfert confirmée : 2026-10-21/)).toBeInTheDocument();
    expect(within(demo).getByText(/Transfert gratuit/)).toBeInTheDocument();

    // New request: client-side validation first.
    fireEvent.click(screen.getByRole("button", { name: "Nouvelle demande" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuer vers la signature" }));
    expect(await screen.findByText("Entrez de 1 à 20 numéros canadiens valides, un par ligne.")).toBeInTheDocument();

    const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
    type("Numéros à transférer", "450 555-0123");
    type("Fournisseur actuel", "Bell Canada");
    type("Nom du titulaire du compte", "Camille Tremblay");
    type("Personne autorisée à signer", "Camille Tremblay");
    type("Courriel de la personne autorisée", "camille@example.ca");
    type("Numéro de compte chez le fournisseur actuel", "ACCT-1");
    type("Numéro et rue", "1 rue Sainte-Catherine");
    type("Ville", "Montréal");
    type("Code postal", "h2x 1y4");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continuer vers la signature" }));
    });

    // The LOA opens for the new request, French first.
    const card = await screen.findByRole("article", { name: "450 555-0123" });
    expect(await within(card).findByText("Lettre d'autorisation de transfert de numéro (LOA)")).toBeInTheDocument();
    expect(within(card).getByText("Signature requise")).toBeInTheDocument();
    fireEvent.change(within(card).getByLabelText("Tapez votre nom complet pour signer"), { target: { value: "camille tremblay" } });
    fireEvent.click(within(card).getByRole("button", { name: "Signer" }));
    expect(await within(card).findByText("Cochez la case pour signer.")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("checkbox"));
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: "Signer" }));
    });
    expect(await within(card).findByText("Envoyée au fournisseur")).toBeInTheDocument();
    expect(within(card).getByText(/Signée par camille tremblay/)).toBeInTheDocument();
    expect(within(card).getByText(/Numéro temporaire actif jusqu'au transfert : 514 555-0100/)).toBeInTheDocument();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: "Annuler le transfert" }));
    });
    expect(await within(card).findByText("Annulé")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Annuler le transfert" })).toBeNull();
  });
});
