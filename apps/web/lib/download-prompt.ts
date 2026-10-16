// Rules for the "Télécharger maintenant" prompt, kept pure so node --test can check them.
// - Opens from any CTA marked data-download (always allowed).
// - Opens by itself at most ONCE per visitor (localStorage; any storage error = treat as already shown,
//   so a private window never nags on every page).
// - Desktop: after 25 s on the page, or on exit intent (pointer leaving through the top edge).
// - Mobile/touch: never a full-screen modal on load (Google intrusive-interstitial rule). Only a small
//   bottom sheet after the visitor has scrolled at least half of the page.

export const PROMPT_STORAGE_KEY = "mimt.download-prompt.v1";
export const DESKTOP_DELAY_MS = 25_000;
export const MOBILE_SCROLL_RATIO = 0.5;
export const DESKTOP_MIN_WIDTH = 900;

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Reads the storage lazily: accessing window.localStorage itself can throw (blocked cookies). */
export type StoreGetter = () => KeyValueStore | null | undefined;

export function alreadyPrompted(getStore: StoreGetter): boolean {
  try {
    const s = getStore();
    if (!s) return true;
    return s.getItem(PROMPT_STORAGE_KEY) !== null;
  } catch {
    return true;
  }
}

/** Remembers that the visitor has seen (or opened) the prompt. Never throws. */
export function markPrompted(getStore: StoreGetter, now: Date = new Date()): void {
  try {
    getStore()?.setItem(PROMPT_STORAGE_KEY, now.toISOString());
  } catch {
    /* storage blocked: nothing to remember, alreadyPrompted() already answers true */
  }
}

export type PromptMode = "modal" | "sheet";

/** Desktop = wide viewport with a fine pointer (mouse). Everything else is treated as mobile. */
export function promptModeFor(viewportWidth: number, finePointer: boolean): PromptMode {
  return viewportWidth >= DESKTOP_MIN_WIDTH && finePointer ? "modal" : "sheet";
}

/** True once the visitor has scrolled through at least half of the page. */
export function scrolledEnough(scrollY: number, viewportHeight: number, documentHeight: number): boolean {
  const scrollable = documentHeight - viewportHeight;
  if (scrollable <= 0) return false;
  return scrollY / scrollable >= MOBILE_SCROLL_RATIO;
}

/** Exit intent: the mouse leaves the window through the top edge (towards the tabs / address bar). */
export function isExitIntent(e: { clientY: number; relatedTarget: unknown }): boolean {
  return e.relatedTarget === null && e.clientY <= 0;
}
