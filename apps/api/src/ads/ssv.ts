import { createVerify, type KeyObject } from "node:crypto";

export interface AdmobCallback {
  message: string;
  signature: string | null;
  keyId: string | null;
  params: URLSearchParams;
}

/** Drops signature and key_id, keeping the original order and encoding of the rest. */
export function parseAdmobQuery(rawQuery: string): AdmobCallback {
  const parts = rawQuery.split("&").filter(Boolean);
  let signature: string | null = null;
  let keyId: string | null = null;
  const kept: string[] = [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    const key = decodeURIComponent(eq === -1 ? part : part.slice(0, eq));
    const rawValue = eq === -1 ? "" : part.slice(eq + 1);
    if (key === "signature") signature = decodeURIComponent(rawValue.replace(/\+/g, " "));
    else if (key === "key_id") keyId = decodeURIComponent(rawValue.replace(/\+/g, " "));
    else kept.push(part);
  }
  return { message: kept.join("&"), signature, keyId, params: new URLSearchParams(kept.join("&")) };
}

export function verifyAdmobSignature(message: string, signature: string, publicKey: KeyObject | string): boolean {
  const verifier = createVerify("SHA256");
  verifier.update(message);
  verifier.end();
  const body = signature.replace(/-/g, "+").replace(/_/g, "/");
  const padded = body + "=".repeat((4 - (body.length % 4)) % 4);
  try {
    return verifier.verify(publicKey, Buffer.from(padded, "base64"));
  } catch {
    return false;
  }
}

interface KeyFile {
  keys?: Array<{ keyId?: number | string; pem?: string }>;
}

/** Google's public verifier keys. Cached for one hour. */
export function admobKeyLoader(url: string, fetchImpl: typeof fetch = fetch): () => Promise<ReadonlyMap<string, string>> {
  let cache: { at: number; keys: Map<string, string> } | null = null;
  return async () => {
    if (cache && Date.now() - cache.at < 3_600_000) return cache.keys;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`admob keys HTTP ${res.status}`);
    const body = (await res.json()) as KeyFile;
    const keys = new Map<string, string>();
    for (const key of body.keys ?? []) {
      if (key.keyId !== undefined && key.pem) keys.set(String(key.keyId), key.pem);
    }
    cache = { at: Date.now(), keys };
    return keys;
  };
}
