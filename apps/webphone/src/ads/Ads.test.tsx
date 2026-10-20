// <AdSlot>: labelled « Publicité », « Enlever les publicités » link, live <ins> vs demo placeholder.
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import { AdsContext, AdSlot, type AdsState } from "./Ads";
import { adSenseConfig } from "./adsense";

const CONFIG = adSenseConfig({ client: "ca-pub-0123456789012345", slotBanner: "1234567890", slotSidebar: "2345678901" });

function renderSlot(state: Partial<AdsState>, path: string, placement: "banner" | "sidebar" = "banner") {
  const value: AdsState = { plan: "free", addOns: [], config: CONFIG, mock: false, inCall: false, personalised: false, setPersonalised: () => undefined, ...state };
  const wrap = (children: ReactNode) => (
    <I18nProvider initial="fr">
      <MemoryRouter initialEntries={[path]}>
        <AdsContext.Provider value={value}>{children}</AdsContext.Provider>
      </MemoryRouter>
    </I18nProvider>
  );
  return render(wrap(<AdSlot placement={placement} />));
}

afterEach(() => {
  delete (window as unknown as { adsbygoogle?: unknown }).adsbygoogle;
});

describe("AdSlot", () => {
  it("renders a labelled AdSense unit with a link to remove ads for a free account", () => {
    const { container } = renderSlot({}, "/messages");
    const ad = screen.getByRole("complementary", { name: "Publicité" });
    expect(within(ad).getByText("Publicité")).toBeInTheDocument();
    expect(within(ad).getByRole("link", { name: "Enlever les publicités" })).toHaveAttribute("href", "/compte#sans-pub");
    expect(within(ad).getByRole("link", { name: "Gagnez 10 minutes dans l'app mobile" })).toHaveAttribute("href", "https://mimt.ca/bientot/");
    const ins = container.querySelector("ins.adsbygoogle");
    expect(ins).toHaveAttribute("data-ad-client", "ca-pub-0123456789012345");
    expect(ins).toHaveAttribute("data-ad-slot", "1234567890");
    // The unit asked AdSense to fill it.
    expect((window as unknown as { adsbygoogle: unknown[] }).adsbygoogle).toHaveLength(1);
  });

  it("uses the sidebar slot for the desktop unit, without the rewarded-ad link", () => {
    const { container } = renderSlot({}, "/appels", "sidebar");
    expect(container.querySelector("ins.adsbygoogle")).toHaveAttribute("data-ad-slot", "2345678901");
    expect(screen.queryByText("Gagnez 10 minutes dans l'app mobile")).toBeNull();
  });

  it("renders nothing for Premium, the « Sans pub » add-on, unset AdSense ids, excluded pages or during a call", () => {
    for (const [state, path] of [
      [{ plan: "premium" }, "/messages"],
      [{ addOns: ["no_ads"] }, "/messages"],
      [{ config: null }, "/messages"],
      [{}, "/compte"],
      [{}, "/reunions/m1"],
      [{}, "/services/offres"],
      [{ inCall: true }, "/messages"],
    ] as Array<[Partial<AdsState>, string]>) {
      const { container, unmount } = renderSlot(state, path);
      expect(container.querySelector(".ad"), `${JSON.stringify(state)} ${path}`).toBeNull();
      unmount();
    }
  });

  it("shows a labelled placeholder (no Google tag) in demo mode", () => {
    const { container } = renderSlot({ mock: true, config: null }, "/messagerie");
    expect(screen.getByRole("complementary", { name: "Publicité" })).toHaveAttribute("data-ad-mode", "placeholder");
    expect(container.querySelector("ins")).toBeNull();
    expect(screen.getByText(/Espace publicitaire \(démo\)/)).toBeInTheDocument();
  });
});
