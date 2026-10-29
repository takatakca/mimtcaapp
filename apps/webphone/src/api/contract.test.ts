// Every business and catalog call of the web app must hit a route that apps/api really declares,
// with the same method. Reads the Fastify route files (no server started).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { businessEndpoints } from "./business";
import { catalogEndpoints } from "./catalog";
import { meetingEndpoints } from "./meetings";
import type { HttpClient, Method } from "./http";

const ROUTES_DIR = join(__dirname, "../../../api/src/routes");

/** "GET /v1/business/:id/members/:memberId" → "GET /v1/business/:/members/:" */
const shape = (method: string, path: string) => `${method.toUpperCase()} ${path.replace(/:[A-Za-z]+/g, ":")}`;

function apiRoutes(): Set<string> {
  const out = new Set<string>();
  for (const file of readdirSync(ROUTES_DIR).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(join(ROUTES_DIR, file), "utf8");
    for (const m of src.matchAll(/\b(?:app|scope)\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)) out.add(shape(m[1]!, m[2]!));
  }
  return out;
}

/** Calls every endpoint with placeholder ids and records "METHOD /path" with the ids as ":". */
function calledRoutes(): Map<string, string> {
  const seen = new Map<string, string>();
  let current = "";
  const request = ((method: Method, path: string) => {
    seen.set(current, shape(method, path.replace(/\bP-ID\b/g, ":")));
    return Promise.resolve(undefined);
  }) as HttpClient["request"];
  const endpoints = { ...businessEndpoints(request), ...catalogEndpoints(request), ...meetingEndpoints(request) } as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const [name, fn] of Object.entries(endpoints)) {
    current = name;
    void fn("P-ID", "P-ID", {});
  }
  return seen;
}

describe("API contract (webphone ↔ apps/api routes)", () => {
  const routes = apiRoutes();

  it("finds the API route files", () => {
    expect(routes.has("GET /v1/business")).toBe(true);
    expect(routes.has("POST /v1/catalog/orders/:/submit")).toBe(true);
    expect(routes.has("PUT /v1/business/:/ai-receptionist")).toBe(true);
  });

  it("every business, catalog and meeting endpoint exists in apps/api with the same method", () => {
    const called = calledRoutes();
    expect(called.size).toBeGreaterThan(40);
    const missing = [...called].filter(([, route]) => !routes.has(route)).map(([name, route]) => `${name}: ${route}`);
    expect(missing).toEqual([]);
  });

  it("the AI routes used outside those modules exist too", () => {
    for (const r of ["POST /v1/voicemails/:/summary", "GET /v1/conversations/:/suggestions", "GET /v1/ai/status", "POST /v1/consents", "GET /v1/missions", "GET /v1/referrals", "GET /v1/points", "GET /v1/points/catalog", "POST /v1/points/redeem", "GET /v1/affiliates/me", "POST /v1/affiliates/attribution", "POST /v1/billing/checkout"]) {
      expect(routes, r).toContain(r);
    }
  });
});
