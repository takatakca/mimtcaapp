// /numero in demo mode (VITE_MOCK_API=1): the number picked on mimt.ca arrives in the fragment, the visitor signs
// in, and the page goes on to the 9-1-1 step then to payment.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const HOLD = "8f0c5c8e-1111-4222-8333-944445555666";

beforeAll(() => {
  vi.stubEnv("VITE_MOCK_API", "1");
  vi.resetModules();
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
beforeEach(() => sessionStorage.clear());

describe("hold handoff", () => {
  it("takes the hold from the fragment once, keeps it for the tab and cleans the address bar", async () => {
    const { takeHoldFromHash, pendingHold, afterSignIn } = await import("../lib/numberHold");
    window.history.pushState(null, "", `/numero#hold=${HOLD}&t=tok_abcdefghijklmnop&plan=premium`);
    expect(takeHoldFromHash()).toEqual({ id: HOLD, token: "tok_abcdefghijklmnop", plan: "premium" });
    expect(window.location.hash).toBe("");
    expect(pendingHold()?.id).toBe(HOLD);
    expect(afterSignIn()).toBe("/numero");
  });

  it("ignores a malformed fragment", async () => {
    const { takeHoldFromHash } = await import("../lib/numberHold");
    window.history.pushState(null, "", "/numero#hold=nope&t=x");
    expect(takeHoldFromHash()).toBeNull();
  });
});

describe("/numero page (demo mode)", () => {
  it("shows the held number with a real timer, then sign-in leads back to it", async () => {
    window.history.pushState(null, "", `/numero#hold=${HOLD}&t=tok_abcdefghijklmnop&plan=lock`);
    const { App } = await import("../App");
    render(<App lang="fr" />);
    expect(await screen.findByRole("heading", { level: 1, name: "514 555-0102" })).toBeInTheDocument();
    expect(screen.getByText(/Personne d'autre chez MIMT/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continuer avec TAKATAK" }));
    });
    const takatak = await screen.findByRole("button", { name: "Continuer avec TAKATAK" });
    await act(async () => {
      fireEvent.click(takatak);
    });
    // Back on /numero, signed in: next step is the 9-1-1 address or the plan.
    expect(await screen.findByText(/Étape [23] sur 3/)).toBeInTheDocument();
    expect(window.location.pathname).toBe("/numero");
  });
});
