import { randomUUID } from "node:crypto";
import { ProviderRejectedError } from "./types.js";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * OAuth 2.0 client-credentials token cache (RFC 6749 §4.4). One token is shared by concurrent
 * callers and refreshed `skewMs` before it expires. The secret is sent with HTTP Basic auth.
 */
export class ClientCredentialsTokenCache {
  private token: { value: string; expiresAt: number } | null = null;
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly opts: {
      tokenUrl: string;
      clientId: string;
      clientSecret: string;
      scope?: string;
      fetch?: FetchLike;
      now?: () => number;
      skewMs?: number;
      timeoutMs?: number;
    },
  ) {}

  async get(): Promise<string> {
    const now = (this.opts.now ?? Date.now)();
    if (this.token && now < this.token.expiresAt - (this.opts.skewMs ?? 60_000)) return this.token.value;
    this.inflight ??= this.fetchToken().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** Drop the cached token (e.g. after a 401). */
  invalidate() {
    this.token = null;
  }

  private async fetchToken(): Promise<string> {
    const f = this.opts.fetch ?? fetch;
    const body = new URLSearchParams({ grant_type: "client_credentials", ...(this.opts.scope ? { scope: this.opts.scope } : {}) });
    const basic = Buffer.from(`${encodeURIComponent(this.opts.clientId)}:${encodeURIComponent(this.opts.clientSecret)}`).toString("base64");
    const res = await f(this.opts.tokenUrl, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: body.toString(),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
    });
    if (!res.ok) throw new Error(`token endpoint answered ${res.status}`); // never include the body: it may echo credentials
    const json = (await res.json()) as { access_token?: string; expires_in?: number; token_type?: string };
    if (!json.access_token) throw new Error("token endpoint returned no access_token");
    const now = (this.opts.now ?? Date.now)();
    this.token = { value: json.access_token, expiresAt: now + (json.expires_in ?? 300) * 1000 };
    return json.access_token;
  }
}

export interface HttpRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Sent as Idempotency-Key; generated for POST/PATCH when absent. Same key on every retry. */
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: unknown,
  ) {
    super(`${method} ${path} → ${status}`);
    this.name = "HttpStatusError";
  }
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Typed JSON HTTP client for a wholesaler API: bearer token from the cache, per-attempt timeout,
 * retries with exponential backoff + jitter on network errors and 408/425/429/5xx (honours
 * Retry-After), one token refresh on 401, idempotency key reused across retries.
 */
export class JsonHttpClient {
  constructor(
    private readonly opts: {
      baseUrl: string;
      tokens: { get(): Promise<string>; invalidate(): void } | null;
      defaultHeaders?: Record<string, string>;
      fetch?: FetchLike;
      timeoutMs?: number;
      maxRetries?: number;
      baseDelayMs?: number;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {}

  async request<T>(req: HttpRequest): Promise<T> {
    const f = this.opts.fetch ?? fetch;
    const wait = this.opts.sleep ?? sleep;
    const maxRetries = this.opts.maxRetries ?? 3;
    const base = this.opts.baseDelayMs ?? 250;
    const idem = req.idempotencyKey ?? (req.method === "POST" || req.method === "PATCH" ? randomUUID() : undefined);
    const url = new URL(req.path.replace(/^\//, ""), this.opts.baseUrl.endsWith("/") ? this.opts.baseUrl : this.opts.baseUrl + "/");
    for (const [k, v] of Object.entries(req.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = { accept: "application/json", ...this.opts.defaultHeaders, ...req.headers };
      if (req.body !== undefined) headers["content-type"] = "application/json";
      if (idem) headers["idempotency-key"] = idem;
      if (this.opts.tokens) headers.authorization = `Bearer ${await this.opts.tokens.get()}`;

      let res: Response;
      try {
        res = await f(url.toString(), {
          method: req.method,
          headers,
          ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000),
        });
      } catch (err) {
        if (attempt >= maxRetries) throw err;
        await wait(backoff(base, attempt));
        continue;
      }

      if (res.status === 401 && this.opts.tokens && !refreshed) {
        refreshed = true;
        this.opts.tokens.invalidate();
        continue;
      }
      if (RETRYABLE.has(res.status) && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : backoff(base, attempt));
        continue;
      }
      const text = await res.text();
      const parsed: unknown = text ? safeJson(text) : null;
      if (res.status >= 400 && res.status < 500) {
        const p = (parsed ?? {}) as { code?: string; message?: string };
        throw new ProviderRejectedError(p.message ?? `${req.method} ${req.path} → ${res.status}`, p.code ?? `http_${res.status}`, res.status);
      }
      if (!res.ok) throw new HttpStatusError(res.status, req.method, req.path, parsed);
      return parsed as T;
    }
  }
}

const backoff = (base: number, attempt: number) => base * 2 ** attempt + Math.floor(Math.random() * base);

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
