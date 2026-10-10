// Core HTTP client for the MIMT API: bearer tokens, single-flight refresh before expiry and on 401,
// and every failure mapped to a translated message key (errors.ts). Pure enough to unit-test: the
// fetch implementation and token store are injected.
import type { AuthTokensResponse, Locale } from "@mimt/shared";
import { ApiClientError, errorKeyFor } from "./errors";
import type { TokenStore } from "./tokens";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export interface RequestOptions {
  body?: unknown;
  /** Send the bearer token (default true). */
  auth?: boolean;
  query?: Record<string, string | number | undefined>;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface HttpClientDeps {
  baseUrl: string;
  fetch: FetchLike;
  store: TokenStore;
  appVersion: string;
  getLocale?: () => Locale;
  /** Called when the refresh token is rejected: the UI goes back to sign-in. */
  onSignedOut?: () => void;
  now?: () => number;
}

export interface HttpClient {
  request<T>(method: Method, path: string, opts?: RequestOptions): Promise<T>;
  /** Stores tokens from exchange/OTP. */
  setTokens(tokens: AuthTokensResponse): void;
  /** Tries to restore a session from the stored refresh token (page reload). */
  restore(): Promise<boolean>;
  hasSession(): boolean;
  signOutLocally(): void;
  refreshToken(): string | null;
  url(path: string, query?: RequestOptions["query"]): string;
}

/** Refresh this long before the access token expires. */
const EXPIRY_SKEW_MS = 30_000;

export function createHttpClient(deps: HttpClientDeps): HttpClient {
  const now = deps.now ?? Date.now;
  const baseUrl = deps.baseUrl.replace(/\/+$/, "");
  let refreshing: Promise<string | null> | null = null;

  const url = (path: string, query?: RequestOptions["query"]) => {
    const qs = query
      ? Object.entries(query)
          .filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== "")
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join("&")
      : "";
    return `${baseUrl}${path}${qs ? `?${qs}` : ""}`;
  };

  async function rawFetch(method: Method, path: string, opts: RequestOptions, accessToken?: string): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Accept-Language": deps.getLocale?.() ?? "fr-CA",
      "X-App-Version": deps.appVersion,
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    try {
      return await deps.fetch(url(path, opts.query), {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      throw new ApiClientError(null, "network", "error.network", e instanceof Error ? e.message : "network error");
    }
  }

  function signOutLocally() {
    deps.store.clear();
    deps.onSignedOut?.();
  }

  /** Single flight: concurrent 401s share one POST /v1/auth/refresh (refresh tokens rotate). */
  function refresh(): Promise<string | null> {
    if (!refreshing) {
      refreshing = (async () => {
        const rt = deps.store.refreshToken();
        if (!rt) return null;
        const res = await rawFetch("POST", "/v1/auth/refresh", { body: { refreshToken: rt } });
        if (!res.ok) {
          if (res.status === 400 || res.status === 401 || res.status === 403) signOutLocally();
          return null;
        }
        const tokens = (await res.json()) as AuthTokensResponse;
        deps.store.set(tokens, now());
        return tokens.accessToken;
      })().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  async function validAccessToken(): Promise<string | undefined> {
    const a = deps.store.access();
    if (a && a.expiresAt - EXPIRY_SKEW_MS > now()) return a.token;
    if (!deps.store.refreshToken()) return undefined;
    return (await refresh()) ?? undefined;
  }

  async function toError(res: Response): Promise<ApiClientError> {
    let code: string | null = null;
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      code = body.error ?? null;
      message = body.message ?? message;
    } catch {
      // Non-JSON error body.
    }
    return new ApiClientError(res.status, code, errorKeyFor(res.status, code), message);
  }

  async function request<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<T> {
    const auth = opts.auth ?? true;
    let res = await rawFetch(method, path, opts, auth ? await validAccessToken() : undefined);
    if (auth && res.status === 401) {
      const token = await refresh();
      if (!token) throw new ApiClientError(401, "unauthorized", "error.session", "session expired");
      res = await rawFetch(method, path, opts, token);
    }
    if (!res.ok) throw await toError(res);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    request,
    url,
    setTokens: (t) => deps.store.set(t, now()),
    async restore() {
      if (deps.store.access()) return true;
      if (!deps.store.refreshToken()) return false;
      return (await refresh()) !== null;
    },
    hasSession: () => deps.store.access() !== null || deps.store.refreshToken() !== null,
    signOutLocally,
    refreshToken: () => deps.store.refreshToken(),
  };
}
