// Call and voicemail settings in demo mode (VITE_MOCK_API=1): blocked numbers, forwarding, do not
// disturb, voicemail by email and the custom greeting upload.
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

describe("greetingContentType", () => {
  it("accepts MP3 and WAV (with browser aliases) and refuses other files", async () => {
    const { greetingContentType } = await import("./CallSettings");
    expect(greetingContentType({ type: "audio/mpeg", name: "a.mp3" })).toBe("audio/mpeg");
    expect(greetingContentType({ type: "audio/x-wav", name: "a.wav" })).toBe("audio/wav");
    expect(greetingContentType({ type: "", name: "accueil.MP3" })).toBe("audio/mpeg");
    expect(greetingContentType({ type: "audio/ogg", name: "a.ogg" })).toBeNull();
    expect(greetingContentType({ type: "image/png", name: "a.png" })).toBeNull();
  });
});

describe("CallSettings page (demo mode)", () => {
  it("blocks and unblocks numbers, never 9-1-1, and saves forwarding, do not disturb and voicemail settings", async () => {
    window.history.pushState(null, "", "/");
    const { App } = await import("../App");
    render(<App lang="fr" />);
    const takatak = await screen.findByRole("button", { name: "Continuer avec TAKATAK" });
    await act(async () => {
      fireEvent.click(takatak);
    });
    const side = await screen.findByRole("complementary", { name: "Navigation principale" });
    await act(async () => {
      fireEvent.click(within(side).getByRole("link", { name: "Mon compte" }));
    });
    const settingsLink = await screen.findByRole("link", { name: "Réglages d'appel" });
    await act(async () => {
      fireEvent.click(settingsLink);
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Réglages d'appel" })).toBeInTheDocument();
    expect(screen.getByText(/Le 9-1-1 est toujours permis/)).toBeInTheDocument();

    // Blocked numbers: the demo list, 9-1-1 refused, a new number added then removed.
    const list = await screen.findByRole("list", { name: "Numéros bloqués" });
    expect(within(list).getByText(/Faux soutien technique/)).toBeInTheDocument();
    const blockInput = screen.getByLabelText("Numéro à bloquer");
    fireEvent.change(blockInput, { target: { value: "9-1-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Bloquer ce numéro" }));
    expect(await screen.findByText("Le 9-1-1 ne peut jamais être bloqué.")).toBeInTheDocument();
    fireEvent.change(blockInput, { target: { value: "438 555-0199" } });
    fireEvent.change(screen.getByLabelText("Note (facultatif)"), { target: { value: "Télémarketing" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Bloquer ce numéro" }));
    });
    const unblock = await screen.findByRole("button", { name: /^Débloquer le .*438.*555-0199/ });
    await act(async () => {
      fireEvent.click(unblock);
    });
    expect(screen.queryByRole("button", { name: /^Débloquer le .*438.*555-0199/ })).not.toBeInTheDocument();

    // Blocked-call action saves straight away.
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Appels des numéros bloqués"), { target: { value: "voicemail" } });
    });
    expect(screen.getByLabelText<HTMLSelectElement>("Appels des numéros bloqués").value).toBe("voicemail");

    // Forwarding (business demo plan): a target is required, 9-1-1 is refused.
    const fwd = screen.getByRole("region", { name: "Renvoi d'appel" });
    fireEvent.change(within(fwd).getByLabelText("Mode de renvoi"), { target: { value: "no_answer" } });
    fireEvent.click(within(fwd).getByRole("button", { name: "Enregistrer" }));
    expect(await within(fwd).findByText("Entrez le numéro vers lequel renvoyer les appels.")).toBeInTheDocument();
    fireEvent.change(within(fwd).getByLabelText("Renvoyer vers"), { target: { value: "911" } });
    fireEvent.click(within(fwd).getByRole("button", { name: "Enregistrer" }));
    expect(await within(fwd).findByText(/Ce numéro ne peut pas recevoir de renvoi/)).toBeInTheDocument();
    fireEvent.change(within(fwd).getByLabelText("Renvoyer vers"), { target: { value: "514 555-0123" } });
    fireEvent.change(within(fwd).getByLabelText("Sonner pendant (secondes)"), { target: { value: "25" } });
    await act(async () => {
      fireEvent.click(within(fwd).getByRole("button", { name: "Enregistrer" }));
    });
    expect(await within(fwd).findByText("Réglages enregistrés.")).toBeInTheDocument();

    // Do not disturb with quiet hours.
    const dnd = screen.getByRole("region", { name: "Ne pas déranger" });
    fireEvent.click(within(dnd).getByRole("switch", { name: "Activer Ne pas déranger" }));
    fireEvent.click(within(dnd).getByRole("checkbox", { name: "Seulement pendant des heures précises" }));
    await act(async () => {
      fireEvent.click(within(dnd).getByRole("button", { name: "Enregistrer" }));
    });
    expect(await within(dnd).findByText("Réglages enregistrés.")).toBeInTheDocument();
    expect(within(dnd).getByText("Activé")).toBeInTheDocument();

    // Voicemail: email on, then a greeting upload (wrong type refused first), then back to default.
    const vm = await screen.findByRole("region", { name: "Messagerie vocale" });
    const email = await within(vm).findByRole("switch", { name: /Recevoir mes messages vocaux par courriel/ });
    await act(async () => {
      fireEvent.click(email);
    });
    expect(await within(vm).findByText("Réglages enregistrés.")).toBeInTheDocument();
    expect(email).toBeChecked();

    const fileInput = within(vm).getByLabelText("Téléverser un message d'accueil");
    fireEvent.change(fileInput, { target: { files: [new File(["x"], "photo.png", { type: "image/png" })] } });
    fireEvent.click(within(vm).getByRole("button", { name: "Téléverser" }));
    expect(await within(vm).findByText("Choisissez un fichier MP3 ou WAV.")).toBeInTheDocument();
    fireEvent.change(fileInput, { target: { files: [new File(["RIFF"], "accueil.wav", { type: "audio/wav" })] } });
    await act(async () => {
      fireEvent.click(within(vm).getByRole("button", { name: "Téléverser" }));
    });
    expect(await within(vm).findByText("Nouveau message d'accueil enregistré.")).toBeInTheDocument();
    expect(within(vm).getByText(/Votre message d'accueil personnalisé/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(vm).getByRole("button", { name: "Revenir au message par défaut" }));
    });
    expect(await within(vm).findByText("Le message d'accueil par défaut est rétabli.")).toBeInTheDocument();
  });
});
