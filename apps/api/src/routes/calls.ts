import type { FastifyInstance } from "fastify";
import type { CallRecord, CallsResponse } from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser } from "../auth/guard.js";
import { decodeCursor, encodeCursor } from "../lib/cursor.js";
import { parse } from "../lib/validate.js";
import { spamLabelOf } from "../ai/spam.js";
import type { Call } from "../repo/types.js";

/** Terminal statuses of a call leg that was never connected. */
const UNANSWERED = new Set(["busy", "no-answer", "failed", "canceled"]);

/** Our side of the call when it is a real MIMT number ("client:<id>" and placeholders are hidden). */
const asNumber = (v: string) => (v.startsWith("+") ? v : null);

export function callRecord(c: Call, voicemailCallSids: ReadonlySet<string>): CallRecord {
  const inbound = c.direction === "inbound";
  return {
    id: c.id,
    direction: c.direction,
    kind: c.kind,
    peer: inbound ? c.fromNumber : c.toNumber,
    ourNumber: asNumber(inbound ? c.toNumber : c.fromNumber),
    status: c.status,
    startedAt: c.startedAt.toISOString(),
    endedAt: c.endedAt?.toISOString() ?? null,
    durationS: c.durationS,
    // An inbound call that went to voicemail "completes" on Twilio's side but was still missed by the user.
    missed: inbound && (UNANSWERED.has(c.status) || voicemailCallSids.has(c.twilioCallSid)),
  };
}

export async function callRoutes(app: FastifyInstance, deps: AppDeps) {
  const { repo } = deps;

  // Recents: the caller's own account only, newest first, keyset-paginated.
  app.get("/v1/calls", { preHandler: requireUser(deps) }, async (req): Promise<CallsResponse> => {
    const q = parse(
      z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }),
      req.query,
    );
    const { account } = await loadContext(deps, req);
    const before = q.cursor ? decodeCursor(q.cursor) : null;
    const [rows, voicemails] = await Promise.all([
      repo.listCallsPage(account.id, { limit: q.limit + 1, ...(before ? { before: { startedAt: before.at, id: before.id } } : {}) }),
      repo.listVoicemails(account.id),
    ]);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    const vmCalls = new Set(voicemails.map((v) => v.callSid));
    const spam = deps.ai ? await deps.ai.store.getSpamScores("call", page.map((c) => c.twilioCallSid)) : new Map();
    return {
      calls: page.map((c) => {
        const label = c.direction === "inbound" ? spamLabelOf(spam.get(c.twilioCallSid)) : undefined;
        return { ...callRecord(c, vmCalls), ...(label ? { spamLabel: label } : {}) };
      }),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.startedAt, last.id) : null,
    };
  });
}
