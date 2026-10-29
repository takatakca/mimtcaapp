// « Pilote MIMT »: where each page lives in the web app, and how a result is highlighted there (pure + DOM helpers).
import type { PilotNavigate, PilotPage } from "@mimt/shared";

const BASE: Record<PilotPage, string> = {
  messages: "/messages",
  calls: "/appels",
  voicemail: "/messagerie",
  account: "/compte",
  call_settings: "/compte/appels",
  help: "/aide",
  missions: "/missions",
  meetings: "/reunions",
  offers: "/services/offres",
  orders: "/services/commandes",
  port_in: "/services/transfert",
  business: "/affaires",
  business_hours: "/affaires",
  business_receptionist: "/affaires",
};

/** App URL for a navigation result. Business pages need the business id (param, else the first business). */
export function pilotPath(nav: PilotNavigate, firstBusinessId?: string | null): string {
  let path = BASE[nav.page];
  if (nav.page.startsWith("business")) {
    const id = nav.param ?? firstBusinessId;
    if (!id) return "/affaires/nouvelle";
    path = `/affaires/${encodeURIComponent(id)}${nav.page === "business_hours" ? "/heures" : nav.page === "business_receptionist" ? "/receptionniste-ia" : ""}`;
  } else if (nav.param && (nav.page === "messages" || nav.page === "meetings")) {
    path = `${path}/${encodeURIComponent(nav.param)}`;
  }
  const q = new URLSearchParams(nav.query ?? {}).toString();
  return q ? `${path}?${q}` : path;
}

/** Existing sections the Pilote can point at, without touching each page (aria-labelledby ids, anchors). */
const TARGETS: Record<string, string> = {
  forwarding: '[aria-labelledby="fwd-h"]',
  dnd: '[aria-labelledby="dnd-h"]',
  blocks: '[aria-labelledby="blocks-h"]',
  greeting: '[aria-labelledby="vm-h"]',
  usage: '[aria-labelledby="usage-h"]',
  handle: "#nom",
};

export function findTarget(root: ParentNode, key: string | undefined): HTMLElement | null {
  if (!key) return null;
  const selectors = [/^[\w-]+$/.test(key) ? `[data-pilot="${key}"]` : "", TARGETS[key]].filter(Boolean) as string[];
  for (const s of selectors) {
    const el = root.querySelector<HTMLElement>(s);
    if (el) return el;
  }
  return null;
}

/**
 * Waits for the target to render (the page may still be loading), scrolls to it and pulses it. Falls back to the
 * page heading. Resolves with the element that was highlighted, or null.
 */
export function highlight(key: string | undefined, opts: { timeoutMs?: number; pulseMs?: number } = {}): Promise<HTMLElement | null> {
  const timeout = opts.timeoutMs ?? 3000;
  const pulse = opts.pulseMs ?? 2600;
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const main = document.getElementById("main") ?? document.body;
      const el = findTarget(main, key) ?? (Date.now() - started >= timeout ? main.querySelector<HTMLElement>("h1") : null);
      if (el) {
        el.scrollIntoView?.({ block: "center", behavior: "smooth" });
        el.classList.add("pilot-pulse");
        window.setTimeout(() => el.classList.remove("pilot-pulse"), pulse);
        resolve(el);
        return;
      }
      if (Date.now() - started >= timeout) return resolve(null);
      window.setTimeout(tick, 120);
    };
    tick();
  });
}
