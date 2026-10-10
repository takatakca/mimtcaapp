// Where the web session lives.
//
// - The ACCESS token stays in memory only (a module variable): never in localStorage/sessionStorage,
//   so an XSS payload cannot read it from storage after the fact, and it disappears with the tab.
// - The REFRESH token must survive a page reload. A browser SPA cannot set an httpOnly cookie
//   itself, so for now it goes in sessionStorage (per tab, cleared when the tab closes, never sent
//   automatically to any server). This is weaker than an httpOnly cookie: any script running on
//   app.mimt.ca could read it. Mitigations: strict CSP on the static host, no third-party scripts
//   besides the Twilio SDK, refresh-token rotation + family revocation on the API.
//   TODO(bff-cookie): move to a backend-for-frontend flow where api.mimt.ca sets the refresh token
//   as an httpOnly, Secure, SameSite=Strict cookie on POST /v1/auth/refresh, and remove this storage.
import type { AuthTokensResponse } from "@mimt/shared";

export interface TokenStore {
  access(): { token: string; expiresAt: number } | null;
  refreshToken(): string | null;
  set(tokens: AuthTokensResponse, now?: number): void;
  clear(): void;
}

const REFRESH_KEY = "mimt.refresh";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function safeSessionStorage(): KeyValueStorage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function createTokenStore(storage: KeyValueStorage | null = safeSessionStorage()): TokenStore {
  let access: { token: string; expiresAt: number } | null = null;
  let refreshMem: string | null = null;
  return {
    access: () => access,
    refreshToken() {
      if (refreshMem) return refreshMem;
      try {
        refreshMem = storage?.getItem(REFRESH_KEY) ?? null;
      } catch {
        refreshMem = null;
      }
      return refreshMem;
    },
    set(t, now = Date.now()) {
      access = { token: t.accessToken, expiresAt: now + t.expiresIn * 1000 };
      refreshMem = t.refreshToken;
      try {
        storage?.setItem(REFRESH_KEY, t.refreshToken);
      } catch {
        // Storage blocked: the session just won't survive a reload.
      }
    },
    clear() {
      access = null;
      refreshMem = null;
      try {
        storage?.removeItem(REFRESH_KEY);
      } catch {
        // ignore
      }
    },
  };
}
