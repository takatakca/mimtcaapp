// « MIMT Connect » account link in demo mode (VITE_MOCK_API=1): /lier?code=… shows who asks (legal name, privacy
// contact) and each access as a separate unchecked box with its purpose; required ones gate approval. Compte ›
// Intégrations › Partenaires lists the granted accesses (each revocable), the receipt and the access log, sets the
// person's own availability (lot B) and revokes the link.
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
  it("each access is a separate unchecked box; required ones gate approval; the card shows scopes, receipt and access log", async () => {
    await open("/lier?code=bavc-2345&r=lr-demo");
    expect(await screen.findByRole("heading", { name: "BesoinAvocat veut relier votre compte MIMT à votre profil (identifiant avocat-42)." })).toBeInTheDocument();
    // Who asks: legal name and privacy contact.
    expect(screen.getByText(/Nom légal : BesoinAvocat inc\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "vieprivee@besoinavocat.ca" })).toHaveAttribute("href", "mailto:vieprivee@besoinavocat.ca");
    // Every scope is a checkbox, unchecked by default, with what it sees, what it never sees and the partner's purpose.
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(7);
    for (const b of boxes) expect(b).not.toBeChecked();
    expect(screen.getByLabelText(/Appeler en votre nom/)).not.toBeChecked();
    expect(screen.getByText(/Pourquoi, selon BesoinAvocat : Rappeler un client depuis le portail/)).toBeInTheDocument();
    expect(screen.getByText(/Jamais : Votre carte, les montants payés/)).toBeInTheDocument();
    expect(screen.getAllByText("Requis")).toHaveLength(2);
    expect(screen.getByText(/Texte du consentement, version 2026-10-31\./)).toBeInTheDocument();
    expect(screen.getByText(/Vous pouvez retirer un accès ou tout le lien en tout temps/)).toBeInTheDocument();

    const allow = screen.getByRole("button", { name: "Autoriser les accès cochés" });
    expect(allow).toBeDisabled();
    expect(screen.getByText(/cochez les accès requis : Voir les appels liés à ce partenaire, Choisir votre ligne pour ce partenaire/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Voir les appels liés à ce partenaire/));
    expect(allow).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Choisir votre ligne pour ce partenaire/));
    fireEvent.click(screen.getByLabelText(/Voir le statut de votre forfait/));
    expect(allow).toBeEnabled();
    await act(async () => {
      fireEvent.click(allow);
    });
    expect(await screen.findByText("Votre compte MIMT est relié à BesoinAvocat.")).toBeInTheDocument();
    expect(screen.getByText(/Un reçu de votre consentement est gardé/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "Voir mes intégrations" }));
    });
    expect(await screen.findByRole("heading", { name: "Partenaires" })).toBeInTheDocument();
    expect(await screen.findByText("BesoinAvocat — profil avocat-42")).toBeInTheDocument();
    expect(screen.getByText("Nom légal : BesoinAvocat inc. · Vie privée : vieprivee@besoinavocat.ca")).toBeInTheDocument();
    // Granted scopes only, each with its own « Retirer cet accès ».
    expect(screen.getAllByRole("button", { name: /^Retirer cet accès/ })).toHaveLength(3);
    // The receipt: action, scopes, versions, coarse device and network.
    expect(screen.getByText("Reçu de consentement")).toBeInTheDocument();
    expect(screen.getByText(/Accès : Voir les appels liés à ce partenaire, Choisir votre ligne pour ce partenaire, Voir le statut de votre forfait/)).toBeInTheDocument();
    expect(screen.getByText("Appareil : Chrome · Windows · Réseau : 203.0.113.0/24")).toBeInTheDocument();

    // The access log.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Voir le journal d'accès" }));
    });
    expect(await screen.findByText("Journal d'accès")).toBeInTheDocument();
    expect(screen.getByText("GET /v1/partner/calls")).toBeInTheDocument();

    // One access removed at once.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retirer cet accès : Voir le statut de votre forfait" }));
    });
    expect(await screen.findByText("L'accès est retiré.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Retirer cet accès/ })).toHaveLength(2);

    // Lot B: the person's own availability for the partner's hunt groups (wins over the partner's).
    const select = await screen.findByLabelText("Ma disponibilité pour ce partenaire");
    expect(select).toHaveValue("");
    expect(screen.getByText(/En ce moment : Disponible/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.change(select, { target: { value: "busy" } });
    });
    expect(await screen.findByText("Disponibilité enregistrée.")).toBeInTheDocument();
    expect(await screen.findByText(/En ce moment : Occupé/)).toBeInTheDocument();
    expect(screen.getByLabelText("Ma disponibilité pour ce partenaire")).toHaveValue("busy");

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
