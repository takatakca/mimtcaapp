import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  NANP_E164,
  normalizePostalCode,
  PORT_IN_CANCELABLE,
  PORT_IN_MAX_NUMBERS,
  PORT_IN_LOA_VERSION,
  signatureMatches,
  type NumberPortIn,
  type PortInLoaResponse,
  type PortInsResponse,
} from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser, type UserContext } from "../auth/guard.js";
import { validatePortingSignature } from "../gateways/twilioPorting.js";
import { badRequest, conflict, forbidden, HttpError, notConfigured, notFound } from "../lib/errors.js";
import { classifyDestination } from "../lib/phone.js";
import { parse } from "../lib/validate.js";
import { businessPlan } from "../pbx/engine.js";
import { PortInNumberTakenError, type PortInWithNumbers } from "../repo/portIn.js";
import type { TelecomAccount } from "../repo/types.js";
import { getFeatures, HELD_STATES, outboundBlocked } from "../services/accounts.js";
import { applySnapshot, cancelOpenNumbers, holdNumbers, loaFor, loaHtml, portInDto, settle, submitPortIn } from "../porting/service.js";
import { e911Ready } from "./e911.js";

// Number port-in (transfert de numéro fixe ou VoIP vers MIMT, sur Twilio).
// Contract: packages/shared/src/portIn.ts. Logic: src/porting/service.ts.

const PROVINCES = ["QC", "ON", "NB", "NS", "PE", "NL", "MB", "SK", "AB", "BC", "YT", "NT", "NU"] as const;
const Nanp = z.string().regex(NANP_E164, "Canada/US number in E.164 (+1NXXNXXXXXX)");

const Address = z.object({
  street: z.string().trim().min(3).max(200),
  unit: z
    .string()
    .trim()
    .max(20)
    .nullish()
    .transform((v) => v || null),
  city: z.string().trim().min(2).max(100),
  province: z.enum(PROVINCES),
  postalCode: z.string().transform((v, ctx) => {
    const p = normalizePostalCode(v);
    if (!p) ctx.addIssue({ code: "custom", message: "invalid Canadian postal code" });
    return p ?? "";
  }),
});

const CreateBody = z.object({
  numbers: z.array(Nanp).min(1).max(PORT_IN_MAX_NUMBERS),
  currentCarrier: z.string().trim().min(2).max(100),
  customerType: z.enum(["individual", "business"]),
  customerName: z.string().trim().min(2).max(200),
  authorizedName: z.string().trim().min(2).max(200),
  authorizedEmail: z.email().max(254),
  accountNumber: z.string().trim().min(1).max(64),
  pin: z.string().trim().min(1).max(32).optional(),
  serviceAddress: Address,
  businessId: z.uuid().optional(),
  temporaryNumber: Nanp.optional(),
  keepTemporaryNumber: z.boolean().optional(),
  desiredDate: z.iso.date().optional(),
});

const SignBody = z.object({ signedName: z.string().trim().min(2).max(200), accept: z.literal(true) });
const Id = z.object({ id: z.uuid() });
const LoaQuery = z.object({ format: z.enum(["html", "json"]).default("html") });
const PORT_IN_SID = /^KW[0-9a-f]{32}$/i;

export async function portInRoutes(app: FastifyInstance, deps: AppDeps) {
  const { repo } = deps;
  const auth = { preHandler: requireUser(deps) };

  /** Telecom accounts whose port-ins the user may see: their own, and businesses they administer. */
  async function visibleAccounts(ctx: UserContext): Promise<{ accountIds: string[]; adminBusinessIds: Set<string> }> {
    const memberships = await repo.pbx.listBusinessesForUser(ctx.user.id);
    const admin = memberships.filter((m) => m.member.role === "owner" || m.member.role === "admin");
    return {
      accountIds: [...new Set([ctx.account.id, ...admin.map((m) => m.business.telecomAccountId)])],
      adminBusinessIds: new Set(admin.map((m) => m.business.id)),
    };
  }

  /** Loads a request the caller may act on; anything else is a 404 (no existence leak). */
  async function load(req: FastifyRequest): Promise<{ ctx: UserContext; p: PortInWithNumbers }> {
    const r = Id.safeParse(req.params);
    if (!r.success) throw notFound();
    const ctx = await loadContext(deps, req);
    const p = await repo.portIns.get(r.data.id);
    if (!p) throw notFound();
    const own = p.request.userId === ctx.user.id || p.request.telecomAccountId === ctx.account.id;
    if (!own) {
      const { adminBusinessIds } = await visibleAccounts(ctx);
      if (!p.request.businessId || !adminBusinessIds.has(p.request.businessId)) throw notFound();
    }
    return { ctx, p };
  }

  app.post("/v1/port-ins", auth, async (req, reply) => {
    const body = parse(CreateBody, req.body);
    const ctx = await loadContext(deps, req);
    const numbers = body.numbers;
    if (new Set(numbers).size !== numbers.length) throw badRequest("duplicate_numbers", "Each number only once");

    // Consumer port into the caller's account, or MIMT Affaires port into the business account.
    let account: TelecomAccount = ctx.account;
    let extraLines = 0;
    if (body.businessId) {
      const business = await repo.pbx.getBusiness(body.businessId);
      const member = business ? await repo.pbx.getMembership(business.id, ctx.user.id) : null;
      if (!business || !member) throw notFound();
      if (member.role !== "owner" && member.role !== "admin") throw forbidden("business_role_required", "Requires the admin role");
      const info = await businessPlan(deps, business);
      if (!info.active) throw forbidden("plan_required", "A business plan is required");
      if (!info.account) throw forbidden("account_restricted");
      account = info.account;
      extraLines = info.seats;
    }
    if (outboundBlocked(account)) throw forbidden("account_restricted");

    // Same 9-1-1 preconditions as a new number: the ported number goes live with this address.
    const e911 = await e911Ready(deps, ctx.user.id, account.id);
    if (!e911.address) throw forbidden("e911_address_required", "Register a 9-1-1 civic address first");
    if (!e911.ack) throw forbidden("e911_ack_required", "Accept the current 9-1-1 notice first");

    for (const e164 of numbers) {
      if (classifyDestination(e164) !== "ca") throw forbidden("canadian_numbers_only");
      const existing = await repo.getNumberByE164(e164);
      if (existing && existing.state !== "released") throw conflict("number_already_on_mimt", `${e164} is already a MIMT number`);
      if (await repo.portIns.findOpenNumber(e164)) throw conflict("port_in_exists", `${e164} already has a transfer in progress`);
    }

    const held = (await repo.listNumbersByAccount(account.id)).filter((n) => HELD_STATES.has(n.state));
    let temporaryNumber: string | null = null;
    if (body.temporaryNumber) {
      const temp = held.find((n) => n.e164 === body.temporaryNumber && n.state === "active");
      if (!temp || numbers.includes(temp.e164)) throw badRequest("invalid_temporary_number", "Choose one of your active MIMT numbers");
      temporaryNumber = temp.e164;
    }
    const keepTemporaryNumber = Boolean(body.keepTemporaryNumber) && temporaryNumber !== null;
    // The temporary number does not count when it goes away after the port.
    const { extraNumbers } = await getFeatures(repo, account.id);
    const after = held.length - (temporaryNumber && !keepTemporaryNumber ? 1 : 0) + numbers.length;
    if (after > 1 + extraLines + extraNumbers) throw forbidden("number_limit_reached", "Your plan does not allow this many numbers");

    if (body.desiredDate && body.desiredDate < deps.now().toISOString().slice(0, 10)) throw badRequest("invalid_date", "desiredDate is in the past");

    if (deps.porting) {
      for (const e164 of numbers) {
        try {
          const check = await deps.porting.checkPortability(e164);
          if (!check.portable) throw new HttpError(422, "not_portable", `${e164}: ${check.reason ?? "not portable"}`);
          if (check.pinAndAccountNumberRequired && !body.pin) throw badRequest("pin_required", `${e164}: the current carrier requires the port-out PIN`);
        } catch (err) {
          if (err instanceof HttpError) throw err;
          // Portability is advisory: Twilio checks again on submission.
          req.log.warn({ err: err instanceof Error ? err.message : "error" }, "portability check failed");
        }
      }
    }

    let p: PortInWithNumbers;
    try {
      p = await repo.portIns.create(
        {
          telecomAccountId: account.id,
          userId: ctx.user.id,
          businessId: body.businessId ?? null,
          kind: body.businessId ? "business" : "consumer",
          currentCarrier: body.currentCarrier,
          customerType: body.customerType,
          customerName: body.customerName,
          authorizedName: body.authorizedName,
          authorizedEmail: body.authorizedEmail.toLowerCase(),
          serviceAddress: body.serviceAddress,
          accountNumberEncrypted: deps.cipher.encrypt(body.accountNumber),
          pinEncrypted: body.pin ? deps.cipher.encrypt(body.pin) : null,
          temporaryNumber,
          keepTemporaryNumber,
          desiredDate: body.desiredDate ?? null,
          feeCents: deps.config.PORT_IN_FEE_CENTS,
        },
        numbers,
      );
    } catch (err) {
      if (err instanceof PortInNumberTakenError) throw conflict("port_in_exists");
      throw err;
    }
    await repo.audit({ actorUserId: ctx.user.id, action: "port_in.created", targetType: "port_in", targetId: p.request.id, ip: req.ip, meta: { numbers: numbers.length, kind: p.request.kind } });
    return reply.code(201).send(portInDto(p));
  });

  app.get("/v1/port-ins", auth, async (req): Promise<PortInsResponse> => {
    const ctx = await loadContext(deps, req);
    const { accountIds, adminBusinessIds } = await visibleAccounts(ctx);
    const rows = await repo.portIns.listByAccounts(accountIds);
    // A business account shared with the user's consumer account: only own or administered requests.
    const visible = rows.filter((p) => p.request.userId === ctx.user.id || p.request.telecomAccountId === ctx.account.id || (p.request.businessId && adminBusinessIds.has(p.request.businessId)));
    return { portIns: visible.map(portInDto) };
  });

  app.get("/v1/port-ins/:id", auth, async (req): Promise<NumberPortIn> => portInDto((await load(req)).p));

  app.get("/v1/port-ins/:id/loa", auth, async (req, reply) => {
    const { p } = await load(req);
    const { format } = parse(LoaQuery, req.query);
    if (format === "json") {
      const { loa, sha256 } = loaFor(p);
      const res: PortInLoaResponse = { version: loa.version, documentSha256: sha256, fr: loa.fr, en: loa.en, signature: portInDto(p).loa };
      return res;
    }
    return reply.type("text/html; charset=utf-8").header("cache-control", "no-store").send(loaHtml(p));
  });

  /** E-signature: typed name (must match the authorized person) + time + IP + hash of the LOA text. */
  app.post("/v1/port-ins/:id/sign", auth, async (req) => {
    const { ctx, p } = await load(req);
    const body = parse(SignBody, req.body);
    if (p.request.status !== "pending_signature") throw conflict("already_signed", "This transfer is not waiting for a signature");
    if (!signatureMatches(body.signedName, p.request.authorizedName)) {
      throw badRequest("signature_name_mismatch", "Type the full name of the authorized person exactly");
    }
    for (const n of p.numbers) {
      const existing = await repo.getNumberByE164(n.e164);
      if (existing && existing.state !== "released") throw conflict("number_already_on_mimt", `${n.e164} is already a MIMT number`);
    }
    const { sha256 } = loaFor(p);
    const ua = req.headers["user-agent"];
    await repo.portIns.update(p.request.id, {
      status: "signed",
      loaVersion: PORT_IN_LOA_VERSION,
      loaSignedName: body.signedName,
      loaSignedAt: deps.now(),
      loaSignedIp: req.ip ?? null,
      loaUserAgent: typeof ua === "string" ? ua.slice(0, 300) : null,
      loaSha256: sha256,
    });
    await repo.audit({ actorUserId: ctx.user.id, action: "port_in.loa_signed", targetType: "port_in", targetId: p.request.id, ip: req.ip, meta: { version: PORT_IN_LOA_VERSION, sha256 } });
    const signed = (await repo.portIns.get(p.request.id))!;
    await holdNumbers(deps, signed);
    return portInDto(await submitPortIn(deps, signed, req.log));
  });

  /** Retry a signed request that was not sent (porting disabled at the time, or Twilio failed). */
  app.post("/v1/port-ins/:id/submit", auth, async (req) => {
    const { p } = await load(req);
    if (p.request.status !== "signed") throw conflict("not_submittable", "Only a signed, unsent transfer can be submitted");
    if (!deps.porting) throw notConfigured("Number transfer");
    return portInDto(await submitPortIn(deps, p, req.log));
  });

  app.post("/v1/port-ins/:id/cancel", auth, async (req) => {
    const { ctx, p } = await load(req);
    const r = p.request;
    if (!PORT_IN_CANCELABLE.includes(r.status)) throw conflict("not_cancelable", "This transfer can no longer be canceled");
    if (r.carrierRef) {
      if (!deps.porting) throw notConfigured("Number transfer");
      try {
        await deps.porting.cancelPortIn(r.carrierRef);
      } catch (err) {
        req.log.error({ portInId: r.id, err: err instanceof Error ? err.message : "error" }, "Twilio port-in cancel failed");
        throw new HttpError(502, "carrier_cancel_failed", "The transfer could not be canceled at the carrier; try again");
      }
    }
    await cancelOpenNumbers(deps, p);
    if (r.status === "pending_signature" || r.status === "signed") await repo.portIns.update(r.id, { status: "canceled", canceledAt: deps.now(), statusReason: null });
    const after = await settle(deps, r.id);
    await repo.audit({ actorUserId: ctx.user.id, action: "port_in.canceled", targetType: "port_in", targetId: r.id, ip: req.ip });
    return portInDto(after);
  });

  // --------------------------------------------------------------------------- Twilio webhook

  // Own scope: JSON is kept raw so the bodySHA256 signature can be checked on the exact bytes.
  await app.register(async (scope) => {
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));

    scope.post("/webhooks/twilio/porting", async (req, reply) => {
      const token = deps.config.TWILIO_AUTH_TOKEN;
      if (!token) return reply.code(503).send({ error: "not_configured", message: "Twilio webhooks are not configured" });
      const base = deps.config.PUBLIC_BASE_URL.replace(/\/$/, "");
      const signature = req.headers["x-twilio-signature"];
      const isForm = req.body !== null && typeof req.body === "object";
      const raw = typeof req.body === "string" ? req.body : "";
      const ok = validatePortingSignature(token, typeof signature === "string" ? signature : undefined, base + req.url, raw, isForm ? (req.body as Record<string, unknown>) : null);
      if (!ok) {
        req.log.warn({ path: req.url.split("?")[0] }, "rejected Twilio porting webhook with bad signature");
        return reply.code(403).send({ error: "invalid_signature", message: "Invalid Twilio signature" });
      }

      let payload: Record<string, unknown> = {};
      if (isForm) payload = req.body as Record<string, unknown>;
      else {
        try {
          payload = JSON.parse(raw || "{}") as Record<string, unknown>;
        } catch {
          return reply.code(400).send({ error: "invalid_request", message: "invalid JSON" });
        }
      }
      // TODO(twilio): confirm the porting webhook payload field name; both spellings are accepted.
      const sid = String(payload.port_in_request_sid ?? payload.PortInRequestSid ?? "");
      if (!PORT_IN_SID.test(sid)) return reply.code(200).send({ ignored: true });
      const p = await repo.portIns.getByCarrierRef(sid);
      if (!p) {
        req.log.warn({ sid }, "porting webhook for an unknown port-in request");
        return reply.code(200).send({ ignored: true });
      }
      if (!deps.porting) return reply.code(503).send({ error: "not_configured", message: "Number transfer is not configured on this server" });
      // The payload only says "something changed": the authoritative state is fetched from Twilio.
      const snap = await deps.porting.getPortIn(sid);
      const after = await applySnapshot(deps, p, snap, req.log);
      return reply.code(200).send({ status: after.request.status });
    });
  });
}
