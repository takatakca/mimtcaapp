// Réunions in demo mode (VITE_MOCK_API=1): list, schedule, guest link, demo room, public guest page.
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

describe("meeting helpers", () => {
  it("parses invitation emails and meeting scopes", async () => {
    const { parseEmails, meetingScopes, splitMeetings, localInputToIso } = await import("./shared");
    expect(parseEmails("Ami@Exemple.ca, b@exemple.ca\nami@exemple.ca; pas-un-courriel")).toEqual({ valid: ["ami@exemple.ca", "b@exemple.ca"], invalid: ["pas-un-courriel"] });
    const me = (plan: "free" | "premium") => ({ account: { plan } }) as never;
    expect(meetingScopes(me("free"), []).any).toBe(false);
    expect(meetingScopes(me("premium"), []).personal).toBe(true);
    const biz = [{ role: "member", business: { id: "b" } }] as never;
    expect(meetingScopes(me("free"), biz)).toMatchObject({ any: false, member: true });
    const m = (id: string, status: string, start: string | null) => ({ id, status, scheduledStart: start, createdAt: "2026-10-01T00:00:00Z", endedAt: null }) as never;
    const { upcoming, past } = splitMeetings([m("a", "scheduled", "2026-10-20T10:00:00Z"), m("b", "live", null), m("c", "ended", null), m("d", "scheduled", "2026-10-18T10:00:00Z")]);
    expect(upcoming.map((x: { id: string }) => x.id)).toEqual(["b", "d", "a"]);
    expect(past.map((x: { id: string }) => x.id)).toEqual(["c"]);
    expect(localInputToIso("")).toBeNull();
  });
});

describe("Réunions (demo mode)", () => {
  it("lists meetings, schedules one, copies a guest link and opens the demo room", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    window.history.pushState(null, "", "/");
    const { App } = await import("../../App");
    render(<App lang="fr" />);
    const takatak = await screen.findByRole("button", { name: "Continuer avec TAKATAK" });
    await act(async () => {
      fireEvent.click(takatak);
    });
    const side = await screen.findByRole("complementary", { name: "Navigation principale" });
    const navLink = await within(side).findByRole("link", { name: "Réunions" });
    await act(async () => {
      fireEvent.click(navLink);
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Réunions" })).toBeInTheDocument();
    expect(await screen.findByText("Point quotidien de l'équipe")).toBeInTheDocument();
    expect(screen.getByText("Bilan de septembre")).toBeInTheDocument();

    // Schedule a meeting.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Planifier/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Créer la réunion" }));
    });
    expect(screen.getByText("Indiquez un titre.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Titre"), { target: { value: "Formation des nouveaux" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Créer la réunion" }));
    });
    const card = (await screen.findByText("Formation des nouveaux")).closest("li")!;

    // Guest link: created and copied.
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: /Copier un lien d'invité/ }));
    });
    expect(await within(card).findByText(/Lien copié/)).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/app\.mimt\.ca\/reunion\//));

    // Join: pre-join screen, then the demo room (never connects).
    await act(async () => {
      fireEvent.click(within(card).getByRole("link", { name: "Rejoindre « Formation des nouveaux »" }));
    });
    const joinBtn = await screen.findByRole("button", { name: "Rejoindre la réunion" });
    await act(async () => {
      fireEvent.click(joinBtn);
    });
    expect(await screen.findByText(/Mode démo : la vidéo n'est pas connectée/)).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Commandes de la réunion" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Terminer pour tous" }));
    });
    expect(await screen.findByText("La réunion est terminée.")).toBeInTheDocument();
  });

  it("public guest page: shows the meeting, asks for a name, then the waiting room", async () => {
    const { DEMO_GUEST_TOKEN } = await import("../../api/mock.meetings");
    window.history.pushState(null, "", `/reunion/${DEMO_GUEST_TOKEN}`);
    const { App } = await import("../../App");
    render(<App lang="fr" />);
    expect(await screen.findByRole("heading", { level: 1, name: "Rencontre fournisseur — Torréfaction Saint-Henri" })).toBeInTheDocument();
    expect(screen.getByText(/L'hôte vous admettra/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Rejoindre la réunion" }));
    });
    expect(screen.getByText("Indiquez votre nom.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Votre nom"), { target: { value: "Alex Martin" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Rejoindre la réunion" }));
    });
    expect(await screen.findByRole("heading", { name: "Salle d'attente" })).toBeInTheDocument();
  });

  it("an unknown guest link says so", async () => {
    window.history.pushState(null, "", "/reunion/lien-inconnu-0000000000000000000000000");
    const { App } = await import("../../App");
    render(<App lang="fr" />);
    expect(await screen.findByText(/Ce lien d'invitation n'est pas valide/)).toBeInTheDocument();
  });
});
