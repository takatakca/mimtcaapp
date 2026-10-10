import { describe, expect, it } from "vitest";
import { PostgresRepository } from "../src/repo/postgres.js";
import { normalizeTrustedCa, resolvePostgresTls } from "../src/repo/postgresTls.js";

const internalDbUrl =
  "postgres://test:secret@db:5432/mimt?sslmode=verify-full&sslrootcert=%2Fetc%2Fssl%2Fcerts%2Fcoolify-ca.crt";

describe("PostgreSQL TLS trust", () => {
  it("drops unsupported libpq sslrootcert parameter without disabling strict TLS", () => {
    const resolved = resolvePostgresTls(internalDbUrl, undefined, () => {
      throw new Error("no certificate is mounted");
    });
    expect(resolved.url).not.toContain("sslrootcert");
    expect(resolved.url).toContain("sslmode=verify-full");
    expect(resolved.caSource).toBe("none");
    expect(resolved.ssl).toBeUndefined();
    expect(resolved.suppliedCaInvalid).toBe(false);
  });

  it("does not trust placeholder PEM or disable certificate verification", () => {
    const resolved = resolvePostgresTls(internalDbUrl, '"-----BEGIN CERTIFICATE-----\\nNOT-A-CERT\\n-----END CERTIFICATE-----"', () => {
      throw new Error("no mount");
    });
    expect(resolved.suppliedCaInvalid).toBe(true);
    expect(resolved.ssl).toBeUndefined();
    expect(resolved.url).not.toContain("sslrootcert");
  });

  it("never forwards sslrootcert to PostgreSQL as a startup parameter", async () => {
    const repo = new PostgresRepository(internalDbUrl, { max: 1 });
    expect(repo.sql.options.connection).not.toHaveProperty("sslrootcert");
    expect(repo.sql.options.ssl).toBe("verify-full");
    expect(repo.sql.options.max).toBe(1);
    await repo.close();
  });

  it("treats sslrootcert=system as strict verification", () => {
    const resolved = resolvePostgresTls("postgres://test:secret@localhost:5432/mimt?sslrootcert=system");
    expect(resolved.url).toContain("sslmode=verify-full");
    expect(resolved.url).not.toContain("sslrootcert=");
  });

  it("rejects malformed or empty CA strings", () => {
    expect(normalizeTrustedCa("")).toBeUndefined();
    expect(normalizeTrustedCa("-----BEGIN CERTIFICATE-----\\nfoo\\n-----END CERTIFICATE-----")).toBeUndefined();
    expect(normalizeTrustedCa(undefined)).toBeUndefined();
  });
});
