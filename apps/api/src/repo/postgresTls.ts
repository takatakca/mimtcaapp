import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * postgres.js v3.4.x does not treat the libpq-style sslrootcert URL parameter
 * as a TLS CA file: it forwards it as a startup parameter instead.
 * Remove that unsupported parameter before connecting.
 *
 * A PEM may be pasted into Coolify with surrounding quotes or escaped
 * newlines. Extract actual X.509 blocks and validate them before trusting them.
 * A bad/missing CA NEVER disables TLS verification.
 */
export function normalizeTrustedCa(input: string | undefined): string | undefined {
  if (!input) return;
  const normalized = input.replace(/\\n/g, "\n");
  const blocks = normalized.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  if (!blocks?.length) return;
  try {
    for (const pem of blocks) new X509Certificate(pem);
    return blocks.join("\n") + "\n";
  } catch {
    return;
  }
}

export function resolvePostgresTls(
  databaseUrl: string,
  sslCaPem?: string,
  readCertificate: (path: string) => string = (path) => readFileSync(path, "utf8"),
): {
  url: string;
  ssl?: { ca: string; rejectUnauthorized: true };
  caSource: "environment" | "file" | "none";
  suppliedCaInvalid: boolean;
} {
  const url = new URL(databaseUrl);
  const sslRootPath = url.searchParams.get("sslrootcert");
  url.searchParams.delete("sslrootcert");

  // PostgreSQL libpq supports sslrootcert=system; postgres.js does not.
  // Interpret it as strict verified TLS, rather than leaking it to PG startup.
  if (sslRootPath === "system" && !url.searchParams.has("sslmode")) {
    url.searchParams.set("sslmode", "verify-full");
  }

  const ca = normalizeTrustedCa(sslCaPem);
  if (ca) return { url: url.toString(), ssl: { ca, rejectUnauthorized: true }, caSource: "environment", suppliedCaInvalid: false };

  if (sslRootPath && sslRootPath.startsWith("/")) {
    try {
      const fromFile = normalizeTrustedCa(readCertificate(sslRootPath));
      if (fromFile) {
        return {
          url: url.toString(),
          ssl: { ca: fromFile, rejectUnauthorized: true },
          caSource: "file",
          suppliedCaInvalid: Boolean(sslCaPem),
        };
      }
    } catch {
      // No mounted CA. Leave verification enabled through postgres.js
      // sslmode=verify-full / Node's default trust store.
    }
  }

  return { url: url.toString(), caSource: "none", suppliedCaInvalid: Boolean(sslCaPem) };
}
