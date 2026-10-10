// OAuth 2.0 PKCE (RFC 7636) with the Web Crypto API. Pure, unit-tested.

type CryptoLike = Pick<Crypto, "getRandomValues"> & { subtle: Pick<SubtleCrypto, "digest"> };

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Random URL-safe string from `byteLength` random bytes (32 bytes → 43 characters). */
export function randomUrlSafe(byteLength = 32, crypto: CryptoLike = globalThis.crypto): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** RFC 7636 §4.1: 43–128 characters from [A-Z a-z 0-9 - . _ ~]. */
export const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

export function createCodeVerifier(crypto: CryptoLike = globalThis.crypto): string {
  return randomUrlSafe(48, crypto); // 64 characters
}

/** S256 challenge: BASE64URL(SHA-256(ASCII(verifier))). */
export async function codeChallengeS256(verifier: string, crypto: CryptoLike = globalThis.crypto): Promise<string> {
  if (!VERIFIER_PATTERN.test(verifier)) throw new Error("invalid PKCE verifier");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: "S256";
}

export async function createPkcePair(crypto: CryptoLike = globalThis.crypto): Promise<PkcePair> {
  const verifier = createCodeVerifier(crypto);
  return { verifier, challenge: await codeChallengeS256(verifier, crypto), method: "S256" };
}
