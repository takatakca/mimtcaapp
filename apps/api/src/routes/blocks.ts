import type { FastifyInstance } from "fastify";
import { isEmergencyNumber, type BlockedNumberDto, type BlocksResponse } from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser } from "../auth/guard.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { normalizeDialed } from "../lib/phone.js";
import { parse } from "../lib/validate.js";
import type { BlockedNumber } from "../repo/callControls.js";

/** Per-account cap (abuse guard; real lists stay far below this). */
export const MAX_BLOCKS = 500;

const BlockBody = z
  .object({
    number: z.string().trim().min(3).max(32),
    label: z.string().trim().min(1).max(80).nullable().optional(),
  })
  .strict();
const IdParams = z.object({ id: z.uuid() });
const DeleteQuery = z.object({ number: z.string().trim().min(3).max(32) });

export const blockDto = (b: BlockedNumber): BlockedNumberDto => ({
  id: b.id,
  e164: b.e164,
  label: b.label,
  createdAt: b.createdAt.toISOString(),
});

/** Normalized E.164 for a number to block; 400 for 9-1-1 (never blockable) and undialable input. */
function blockable(raw: string): string {
  if (isEmergencyNumber(raw)) throw badRequest("cannot_block_emergency", "9-1-1 cannot be blocked");
  const e164 = normalizeDialed(raw);
  if (!e164) throw badRequest("invalid_number", "Not a valid phone number");
  return e164;
}

/** Call and text blocking (docs/MIMT-PARITY.md P0 item 2). Applied on the inbound path only. */
export async function blockRoutes(app: FastifyInstance, deps: AppDeps) {
  const store = deps.repo.callControls;
  const auth = { preHandler: requireUser(deps) };

  app.get("/v1/blocks", auth, async (req): Promise<BlocksResponse> => {
    const { account } = await loadContext(deps, req);
    return { blocks: (await store.listBlocks(account.id)).map(blockDto) };
  });

  app.post("/v1/blocks", auth, async (req, reply) => {
    const body = parse(BlockBody, req.body);
    const e164 = blockable(body.number);
    const { user, account } = await loadContext(deps, req);
    const existing = await store.listBlocks(account.id);
    if (!existing.some((b) => b.e164 === e164) && existing.length >= MAX_BLOCKS) {
      throw conflict("block_limit", `At most ${MAX_BLOCKS} blocked numbers`);
    }
    const { block, created } = await store.addBlock({ telecomAccountId: account.id, e164, label: body.label ?? null });
    if (created) await deps.repo.audit({ actorUserId: user.id, action: "block.added", targetType: "blocked_number", targetId: block.id, ip: req.ip });
    return reply.code(created ? 201 : 200).send(blockDto(block));
  });

  app.delete("/v1/blocks/:id", auth, async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const { user, account } = await loadContext(deps, req);
    if (!(await store.removeBlock(account.id, id))) throw notFound();
    await deps.repo.audit({ actorUserId: user.id, action: "block.removed", targetType: "blocked_number", targetId: id, ip: req.ip });
    return reply.code(204).send();
  });

  // Unblock by number (thread and call-log menus know the number, not the row id).
  app.delete("/v1/blocks", auth, async (req, reply) => {
    const { number } = parse(DeleteQuery, req.query);
    const e164 = normalizeDialed(number);
    if (!e164) throw badRequest("invalid_number", "Not a valid phone number");
    const { user, account } = await loadContext(deps, req);
    const row = (await store.listBlocks(account.id)).find((b) => b.e164 === e164);
    if (!row || !(await store.removeBlock(account.id, row.id))) throw notFound();
    await deps.repo.audit({ actorUserId: user.id, action: "block.removed", targetType: "blocked_number", targetId: row.id, ip: req.ip });
    return reply.code(204).send();
  });
}
