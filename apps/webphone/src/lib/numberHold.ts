// Number picked on mimt.ca (live picker): handed over in the URL fragment of /numero, kept for this tab only.
// The fragment never reaches a server log; sessionStorage dies with the tab.

export interface PendingHold {
  id: string;
  token: string;
  plan: "lock" | "premium" | "business";
}

const KEY = "mimt-number-hold";
const PLANS = new Set(["lock", "premium", "business"]);

/** Reads #hold=…&t=…&plan=… once, stores it and removes it from the address bar. */
export function takeHoldFromHash(loc: Location = window.location, hist: History = window.history): PendingHold | null {
  const p = new URLSearchParams(loc.hash.replace(/^#/, ""));
  const id = p.get("hold");
  const token = p.get("t");
  if (!id || !token || !/^[0-9a-f-]{36}$/i.test(id) || token.length < 16 || token.length > 128) return null;
  const plan = PLANS.has(p.get("plan") ?? "") ? (p.get("plan") as PendingHold["plan"]) : "lock";
  const hold = { id, token, plan };
  keepBusinessFromParams(p);
  try {
    sessionStorage.setItem(KEY, JSON.stringify(hold));
  } catch {
    // Storage blocked: the hold still works for this page view.
  }
  hist.replaceState(null, "", loc.pathname + loc.search);
  return hold;
}

export function pendingHold(): PendingHold | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as PendingHold | null;
    return v && typeof v.id === "string" && typeof v.token === "string" ? v : null;
  } catch {
    return null;
  }
}

export function clearPendingHold(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}

/** Where to go after sign-in: back to the number if one is waiting. */
export function afterSignIn(fallback = "/messages"): string {
  return pendingHold() ? "/numero" : fallback;
}

// Business name and type typed on mimt.ca /affaires (#…&biz=…&type=…): prefill the setup wizard
// (pages/business/NewBusiness.tsx). Kept apart from the hold, which is cleared once the number is active.
export interface PendingBusiness {
  name: string;
  type: "restaurant" | "retail" | "professional" | "health" | "other";
}
const BIZ_KEY = "mimt-business-setup";
const BIZ_TYPES = new Set(["restaurant", "retail", "professional", "health", "other"]);

/** Stores `biz` and `type` from a fragment (called by takeHoldFromHash). */
export function keepBusinessFromParams(p: URLSearchParams): void {
  const name = (p.get("biz") ?? "").trim().slice(0, 120);
  if (!name) return;
  const raw = p.get("type") ?? "";
  const type = (BIZ_TYPES.has(raw) ? raw : "other") as PendingBusiness["type"];
  try {
    sessionStorage.setItem(BIZ_KEY, JSON.stringify({ name, type }));
  } catch {
    // Storage blocked: the wizard starts empty.
  }
}

export function pendingBusiness(): PendingBusiness | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(BIZ_KEY) ?? "null") as PendingBusiness | null;
    return v && typeof v.name === "string" && BIZ_TYPES.has(v.type) ? v : null;
  } catch {
    return null;
  }
}

export function clearPendingBusiness(): void {
  try {
    sessionStorage.removeItem(BIZ_KEY);
  } catch {
    // nothing to clear
  }
}
