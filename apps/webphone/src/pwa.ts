// Installable app (PWA): registers public/sw.js, which caches the app shell only (never API calls or
// sign-in). Production builds only, so dev servers and tests never run a stale cached shell.

export interface PwaEnv {
  PROD: boolean;
}

export function registerServiceWorker(env: PwaEnv = import.meta.env, nav: Navigator | undefined = globalThis.navigator): boolean {
  if (!env.PROD || !nav || !("serviceWorker" in nav)) return false;
  window.addEventListener("load", () => {
    nav.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Not installable then; the app works the same.
    });
  });
  return true;
}
