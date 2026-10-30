import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { Config } from "../config.js";
import { HttpError, notConfigured, unauthorized } from "../lib/errors.js";
import type { Repository } from "../repo/types.js";

const ALGORITHMS = ["RS256"];
const GOOGLE_ISSUER = "https://accounts.google.com";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const CLOCK_SKEW_S = 5;

export interface GoogleIdentity {
  googleSub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  locale: string | null;
}

export interface GoogleClient {
  exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string; nonce?: string }): Promise<GoogleIdentity>;
}

interface Discovery {
  token_endpoint: string;
  jwks_uri: string;
}

const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);

/**
 * Google sign-in (signup = email or Google, free, no passkey at signup).
 * Mirrors TakatakOidc but simpler: fixed issuer, no handoff tokens, standard OIDC.
 * The same GOOGLE_OAUTH_CLIENT_ID/SECRET as the « Google Agenda » connector are reused;
 * the owner adds https://app.mimt.ca/auth/callback/google as an authorized redirect URI
 * on the Google Cloud OAuth client. Throws notConfigured (503) until they are set.
 */
export class GoogleOidc implements GoogleClient {
  private discovery?: { value: Discovery; at: number };
  private jwks?: JWTVerifyGetKey;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly config: Config,
    private readonly repo: Repository,
    opts: { jwks?: JWTVerifyGetKey; fetch?: typeof fetch } = {},
  ) {
    this.jwks = opts.jwks;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private get clientId(): string {
    if (!this.config.GOOGLE_OAUTH_CLIENT_ID) throw notConfigured("Google sign-in");
    return this.config.GOOGLE_OAUTH_CLIENT_ID;
  }

  private async getDiscovery(): Promise<Discovery> {
    if (this.discovery && Date.now() - this.discovery.at < 3600_000) return this.discovery.value;
    const res = await this.fetchImpl(`${GOOGLE_ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new HttpError(502, "idp_unavailable", "Google discovery failed");
    const value = (await res.json()) as Discovery;
    if (!value.token_endpoint || !value.jwks_uri) throw new HttpError(502, "idp_unavailable", "Google discovery is incomplete");
    this.discovery = { value, at: Date.now() };
    return value;
  }

  private async getJwks(): Promise<JWTVerifyGetKey> {
    if (!this.jwks) {
      this.jwks = createRemoteJWKSet(new URL((await this.getDiscovery()).jwks_uri), { cooldownDuration: 30_000, cacheMaxAge: 3600_000 });
    }
    return this.jwks;
  }

  async exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string; nonce?: string }): Promise<GoogleIdentity> {
    const clientId = this.clientId;

    const { token_endpoint } = await this.getDiscovery();
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: clientId,
      code_verifier: input.codeVerifier,
    });
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
    if (this.config.GOOGLE_OAUTH_CLIENT_SECRET) {
      headers.authorization = "Basic " + Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(this.config.GOOGLE_OAUTH_CLIENT_SECRET)}`).toString("base64");
    }
    const res = await this.fetchImpl(token_endpoint, { method: "POST", headers, body: form, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw unauthorized("Google rejected the authorization code");
    const tokens = (await res.json()) as { id_token?: string };
    if (!tokens.id_token) throw unauthorized("Google returned no ID token");

    let claims: JWTPayload;
    try {
      ({ payload: claims } = await jwtVerify(tokens.id_token, await this.getJwks(), {
        issuer: GOOGLE_ISSUERS,
        audience: clientId,
        algorithms: ALGORITHMS,
        requiredClaims: ["sub", "exp", "iat"],
        clockTolerance: CLOCK_SKEW_S,
      }));
    } catch {
      throw unauthorized("Invalid Google ID token");
    }
    if (input.nonce !== undefined && claims.nonce !== input.nonce) throw unauthorized("ID token nonce mismatch");
    if (claims.jti && claims.exp && !(await this.repo.useOnce(`gid:${claims.jti}`, new Date(claims.exp * 1000)))) {
      throw unauthorized("ID token already used");
    }
    return {
      googleSub: claims.sub!,
      email: str(claims.email),
      emailVerified: claims.email_verified === true,
      name: str(claims.name),
      locale: str(claims.locale),
    };
  }
}
