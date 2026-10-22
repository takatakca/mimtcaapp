import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  AREA_CODE_FALLBACKS,
  CANADIAN_AREA_CODES,
  fallbackMessage,
  NANP_E164,
  NUMBER_HOLD_MINUTES,
  NUMBER_SEARCH_CACHE_SECONDS,
  resolveNumberQuery,
  type NumberHoldResponse,
  type PublicNumber,
  type PublicNumberSearchResponse,
} from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { badRequest, conflict, HttpError, notConfigured, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import type { RateRule } from "../fraud/rateLimiter.js";
import type { NumberHoldRow } from "../repo/numberHolds.js";

/**
 * Live number picker, public part (no sign-in): search real numbers and hold one for NUMBER_HOLD_MINUTES.
 * Paying for a held number goes through POST /v1/billing/checkout with `numberHold` (routes/billing.ts), and the
 * Stripe webhook provisions it (services/numberProvisioning.ts).
 *
 * Abuse limits: per-IP token buckets on search and holds, one live hold per visitor, a daily cap per IP, a 60 s
 * cache per area code so the carrier API is never hammered. The hold token is a capability (only its hash is kept).
 */

const SEARCH_RULE: RateRule = { capacity: 20, windowSeconds: 60 };
const HOLD_RULE: RateRule = { capacity: 5, windowSeconds: 600 };
const HOLDS_PER_IP_PER_DAY = 20;
const RESULTS = 12;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/** Rotates with the process: enough for abuse limits, and IPs are never stored in a reversible form. */
const IP_SALT = randomBytes(16).toString("hex");
export const holdIpHash = (ip: string) => sha256(`${IP_SALT}:${ip}`);
export const holdTokenHash = (token: string) => sha256(`mimt-number-hold:${token}`);

/** Constant-time check of a hold token against the stored hash. */
export function holdTokenMatches(hold: Pick<NumberHoldRow, "tokenHash">, token: string | undefined): boolean {
  if (!token || token.length > 128) return false;
  const a = Buffer.from(holdTokenHash(token), "hex");
  const b = Buffer.from(hold.tokenHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function holdView(h: NumberHoldRow, now: Date, token?: string): NumberHoldResponse {
  const status = (h.status === "held" || h.status === "checkout") && h.expiresAt <= now ? "expired" : h.status;
  return { id: h.id, e164: h.e164, status, expiresAt: h.expiresAt.toISOString(), ...(token ? { token } : {}) };
}

const tooMany = () => new HttpError(429, "rate_limited", "Trop de demandes. Réessayez dans une minute.");

export async function numberPickerRoutes(app: FastifyInstance, deps: AppDeps) {
  const { repo } = deps;
  const cache = new Map<string, { at: number; numbers: PublicNumber[] }>();

  async function searchAreaCode(code: string): Promise<PublicNumber[]> {
    const hit = cache.get(code);
    if (hit && deps.now().getTime() - hit.at < NUMBER_SEARCH_CACHE_SECONDS * 1000) return hit.numbers;
    const found = await deps.twilio!.searchLocalNumbers({ areaCode: code, limit: 20 });
    const numbers = found.filter((n) => NANP_E164.test(n.e164));
    cache.set(code, { at: deps.now().getTime(), numbers });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return numbers;
  }

  /** Removes numbers MIMT already assigns, keeps in quarantine, or holds for someone else. */
  async function stillFree(numbers: PublicNumber[]): Promise<PublicNumber[]> {
    const held = await repo.numberHolds.liveHeld(
      numbers.map((n) => n.e164),
      deps.now(),
    );
    const out: PublicNumber[] = [];
    for (const n of numbers) {
      if (held.has(n.e164)) continue;
      const existing = await repo.getNumberByE164(n.e164);
      if (!existing || existing.state === "released") out.push(n);
    }
    return out;
  }

  const ipOf = (req: FastifyRequest) => req.ip || "unknown";

  app.get("/v1/public/numbers/search", async (req, reply): Promise<PublicNumberSearchResponse> => {
    const { q } = parse(z.object({ q: z.string().min(1).max(60) }), req.query);
    if (!(await deps.rateLimiter.take(`pick:search:${holdIpHash(ipOf(req))}`, SEARCH_RULE))) throw tooMany();
    const resolved = resolveNumberQuery(q);
    if (!resolved) throw badRequest("unknown_place", "Entrez un indicatif canadien (ex. 514) ou une ville.");
    if (!deps.twilio) throw notConfigured("Number search");

    // Asked area codes first; if they are all sold out, the closest neighbours (AREA_CODE_FALLBACKS), said plainly.
    const tried = new Set<string>();
    let failures = 0;
    let carrierCode: string | number | undefined;
    async function collect(codes: readonly string[]): Promise<PublicNumber[]> {
      const out: PublicNumber[] = [];
      for (const code of codes) {
        if (out.length >= RESULTS || tried.has(code)) continue;
        tried.add(code);
        try {
          out.push(...(await stillFree(await searchAreaCode(code))));
        } catch (err) {
          // One area code failing at the carrier must not hide the others; the cause goes to the logs.
          failures++;
          carrierCode ??= (err as { code?: string | number; status?: number }).code ?? (err as { status?: number }).status;
          req.log.warn({ err, areaCode: code }, "Carrier number search failed");
        }
      }
      return out;
    }
    let numbers = await collect(resolved.areaCodes);
    let fallback: PublicNumberSearchResponse["fallback"];
    if (!numbers.length) {
      const asked = resolved.areaCodes[0]!;
      for (const next of AREA_CODE_FALLBACKS[asked] ?? []) {
        const found = await collect([next]);
        if (found.length) {
          numbers = found;
          fallback = { from: asked, to: next, message: { fr: fallbackMessage(asked, next, "fr"), en: fallbackMessage(asked, next, "en") } };
          break;
        }
      }
    }
    if (!numbers.length && failures === tried.size) {
      // The carrier's error code (public, e.g. 20003 auth, 20404 not found) helps diagnose without logs access.
      throw new HttpError(503, "carrier_unavailable", `La recherche de numéros ne répond pas. Réessayez dans un instant.${carrierCode ? ` (code ${carrierCode})` : ""}`);
    }
    reply.header("Cache-Control", "no-store");
    return { label: resolved.label, areaCodes: resolved.areaCodes, numbers: numbers.slice(0, RESULTS), ...(fallback ? { fallback } : {}) };
  });

  app.post("/v1/public/numbers/holds", async (req, reply) => {
    const { e164 } = parse(z.object({ e164: z.string().regex(NANP_E164) }), req.body);
    if (!CANADIAN_AREA_CODES[e164.slice(2, 5)]) throw badRequest("canadian_numbers_only");
    const ipHash = holdIpHash(ipOf(req));
    if (!(await deps.rateLimiter.take(`pick:hold:${ipHash}`, HOLD_RULE))) throw tooMany();
    const now = deps.now();
    if ((await repo.numberHolds.countByIpSince(ipHash, new Date(now.getTime() - 86_400_000))) >= HOLDS_PER_IP_PER_DAY) throw tooMany();

    const existing = await repo.getNumberByE164(e164);
    if (existing && existing.state !== "released") throw conflict("number_unavailable", "Ce numéro vient d'être pris. Choisissez-en un autre.");

    // One live hold per visitor: picking another number lets the previous one go.
    for (const h of await repo.numberHolds.liveByIp(ipHash, now)) if (h.status === "held") await repo.numberHolds.finish(h.id, "released");

    const token = randomBytes(24).toString("base64url");
    const hold = await repo.numberHolds.create({
      e164,
      tokenHash: holdTokenHash(token),
      ipHash,
      expiresAt: new Date(now.getTime() + NUMBER_HOLD_MINUTES * 60_000),
      now,
    });
    if (!hold) throw conflict("number_held", "Quelqu'un réserve déjà ce numéro. Choisissez-en un autre.");
    return reply.code(201).send(holdView(hold, now, token));
  });

  app.get("/v1/public/numbers/holds/:id", async (req): Promise<NumberHoldResponse> => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const hold = await repo.numberHolds.get(id);
    if (!hold || !holdTokenMatches(hold, req.headers["x-hold-token"] as string | undefined)) throw notFound("hold_not_found");
    return holdView(hold, deps.now());
  });

  app.delete("/v1/public/numbers/holds/:id", async (req, reply) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const hold = await repo.numberHolds.get(id);
    if (!hold || !holdTokenMatches(hold, req.headers["x-hold-token"] as string | undefined)) throw notFound("hold_not_found");
    if (hold.status === "held") await repo.numberHolds.finish(hold.id, "released");
    return reply.code(204).send();
  });
}
