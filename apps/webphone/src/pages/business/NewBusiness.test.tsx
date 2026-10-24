// « MIMT Affaires en 5 minutes » in demo mode (VITE_MOCK_API=1, localStorage "mimt.demo.business" = "none"):
// a business-plan account with no business finds « Créer mon standard », goes through the 5 steps and
// ends with its standard online; the session then lists the new business.
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

async function signedIn(path: string, noBusiness: boolean) {
  if (noBusiness) localStorage.setItem("mimt.demo.business", "none");
  const mock = await import("../../api/mock");
  mock.resetMockState();
  window.history.pushState(null, "", path);
  const { App } = await import("../../App");
  render(<App lang="fr" />);
  // The tokens of an earlier test may still be in memory: then the session restores by itself.
  const takatak = await screen.findByRole("button", { name: "Continuer avec TAKATAK" }, { timeout: 800 }).catch(() => null);
  if (takatak) {
    await act(async () => {
      fireEvent.click(takatak);
    });
  }
  return mock;
}

const click = async (el: HTMLElement) => {
  await act(async () => {
    fireEvent.click(el);
  });
};

describe("/affaires/nouvelle (demo mode)", () => {
  it("takes a business plan with no business from the nav entry to a live standard", async () => {
    const mock = await signedIn("/", true);
    const side = await screen.findByRole("complementary", { name: "Navigation principale" });
    await click(within(side).getByRole("link", { name: "Créer mon standard" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Votre standard en 5 minutes" })).toBeInTheDocument();
    expect(screen.getByText("Étape 1 sur 5")).toBeInTheDocument();

    // 1. Name is required; type restaurant picks the 7-day hours.
    await click(screen.getByRole("button", { name: "Continuer" }));
    expect(screen.getByText("Indiquez le nom de votre entreprise.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nom de l'entreprise"), { target: { value: "Casse-croûte Comète" } });
    fireEvent.click(screen.getByLabelText(/Restaurant/));
    await click(screen.getByRole("button", { name: "Continuer" }));

    // 2. Hours: restaurant preset, Quebec holidays on by default.
    expect(await screen.findByText("Étape 2 sur 5")).toBeInTheDocument();
    expect(screen.getByLabelText(/7 jours, 11 h à 23 h/)).toBeChecked();
    expect(screen.getByRole("switch", { name: /Fermé les jours fériés du Québec/ })).toBeChecked();
    expect(screen.getByText(/Lundi au dimanche : 11 h à 23 h\./)).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "Continuer" }));

    // 3. Greeting generated from the name, French first, editable.
    const fr = (await screen.findByLabelText("Français (lu en premier)")) as HTMLTextAreaElement;
    expect(fr.value).toMatch(/^Bonjour et bienvenue chez Casse-croûte Comète\./);
    expect((screen.getByLabelText("Anglais") as HTMLTextAreaElement).value).toMatch(/^Hello and welcome to Casse-croûte Comète\./);
    fireEvent.change(fr, { target: { value: `${fr.value} Merci!` } });
    expect(screen.getByRole("button", { name: "Régénérer le texte" })).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "Continuer" }));

    // 4. AI receptionist (Affaires includes it): the owner must accept the terms.
    expect(await screen.findByRole("switch", { name: "Activer la réceptionniste IA" })).toBeChecked();
    expect(screen.getByText(/Claude, d'Anthropic|Claude, by Anthropic|Anthropic/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Votre menu (plats, options, livraison)"), { target: { value: "Poutines, burgers" } });
    await click(screen.getByRole("button", { name: "Continuer" }));
    expect(screen.getByText(/Cochez la case pour activer la réceptionniste IA/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/j'accepte les conditions de la réceptionniste IA/));
    await click(screen.getByRole("button", { name: "Continuer" }));

    // 5. Main number: the one the account holds.
    expect(await screen.findByLabelText("514 555-0100")).toBeChecked();
    await click(screen.getByRole("button", { name: "Mettre mon standard en ligne" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Votre standard est en ligne" })).toBeInTheDocument();
    expect(screen.getByText(/Faites un appel test/)).toBeInTheDocument();
    // The session now knows the business: it is in the sidebar, the setup entry is gone.
    expect(await within(side).findByRole("link", { name: "Casse-croûte Comète" })).toBeInTheDocument();
    expect(within(side).queryByRole("link", { name: "Créer mon standard" })).toBeNull();

    // What the demo API received.
    const { api } = await import("../../api/client");
    const biz = (await api.businesses()).businesses[0]!;
    expect(biz.business).toMatchObject({ name: "Casse-croûte Comète", mainNumber: "+15145550100" });
    const id = biz.business.id;
    const [menus, hours, dids, ai, exts] = await Promise.all([api.ivrMenus(id), api.hours(id), api.dids(id), api.aiReceptionist(id), api.extensions(id)]);
    expect(exts.extensions.map((e) => e.number)).toEqual(["101"]);
    expect(menus.menus[0]!.greeting.fr).toMatch(/Merci!$/);
    expect(menus.menus[0]!.options.map((o) => o.digit)).toEqual(["1", "2", "0"]);
    expect(hours.hours.openTarget).toEqual({ type: "ivr", ivrMenuId: menus.menus[0]!.id });
    expect(hours.hours.closedTarget).toEqual({ type: "ai_receptionist" });
    expect(hours.hours.quebecHolidays).toBe(true);
    expect(dids.routes).toEqual([expect.objectContaining({ e164: "+15145550100", target: { type: "schedule" } })]);
    expect(ai).toMatchObject({ enabled: true, businessName: "Casse-croûte Comète" });
    expect(ai.faqMarkdown).toMatch(/Poutines, burgers/);
    expect(mock).toBeTruthy();
  });

  it("prefills the business typed on mimt.ca and offers the wizard after paying", async () => {
    sessionStorage.setItem("mimt-business-setup", JSON.stringify({ name: "Clinique Aurore", type: "health" }));
    await signedIn("/billing/success", true);
    await click(await screen.findByRole("link", { name: "Configurer mon standard" }));
    expect(((await screen.findByLabelText("Nom de l'entreprise")) as HTMLInputElement).value).toBe("Clinique Aurore");
    expect(screen.getByLabelText(/Santé \/ clinique/)).toBeChecked();
  });

  it("sends an account that already has a business to it", async () => {
    await signedIn("/affaires/nouvelle", false);
    expect(await screen.findByRole("heading", { level: 1, name: "Café Lumière inc." })).toBeInTheDocument();
  });
});
