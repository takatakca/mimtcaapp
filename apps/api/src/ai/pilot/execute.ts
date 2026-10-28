// « Pilote MIMT »: runs validated calls through the EXISTING API routes (Fastify inject, with the user's own
// bearer token). Each route keeps its own checks (plan, role, fraud rules, quotas) and its own audit entry, so the
// Pilote can never do more than the user could do by hand. Results become console steps; no content is logged.
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  formatNanp,
  PLANS,
  type BusinessHoursResponse,
  type CallsResponse,
  type MeResponse,
  type MissionsResponse,
  type PilotClientAction,
  type PilotNavigate,
  type PilotStep,
  type PilotTool,
  type VoicemailsResponse,
} from "@mimt/shared";
import { planOf } from "../../plansConfig.js";
import type { PilotContext, ValidatedCall } from "./plan.js";

interface Injected {
  status: number;
  body: any;
}

export interface CallResult {
  tool: PilotTool;
  ok: boolean;
  code?: string;
  steps: PilotStep[];
  navigate: PilotNavigate | null;
  clientAction?: PilotClientAction;
}

const tr = (ctx: Pick<PilotContext, "fr">, fr: string, en: string) => (ctx.fr ? fr : en);

export function injector(app: FastifyInstance, req: FastifyRequest) {
  return async (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown): Promise<Injected> => {
    const res = await app.inject({
      method,
      url,
      headers: {
        authorization: req.headers.authorization ?? "",
        ...(req.headers["accept-language"] ? { "accept-language": req.headers["accept-language"] } : {}),
        ...(payload !== undefined ? { "content-type": "application/json" } : {}),
      },
      remoteAddress: req.ip,
      ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
    });
    let body: unknown = null;
    try {
      body = res.body ? JSON.parse(res.body) : null;
    } catch {
      body = null;
    }
    return { status: res.statusCode, body };
  };
}

type Inject = ReturnType<typeof injector>;

const done = (ctx: PilotContext, call: ValidatedCall, text: string, extra: Partial<CallResult> = {}): CallResult => ({
  tool: call.tool,
  ok: true,
  steps: [{ kind: "result", text: tr(ctx, `Résultat : ${text}`, `Result: ${text}`), ok: true }],
  navigate: call.navigate,
  ...extra,
});

function failed(ctx: PilotContext, call: ValidatedCall, res: Injected): CallResult {
  const code = typeof res.body?.error === "string" ? res.body.error : `http_${res.status}`;
  const plan = code === "plan_required" || code.endsWith("_not_in_plan");
  const text = plan
    ? tr(ctx, "pas inclus dans votre forfait", "not included in your plan")
    : res.status === 429
      ? tr(ctx, "trop de demandes, réessayez plus tard", "too many requests, try again later")
      : res.status === 503
        ? tr(ctx, "service pas encore activé", "service not enabled yet")
        : tr(ctx, `refusé (${code})`, `refused (${code})`);
  return { tool: call.tool, ok: false, code, steps: [{ kind: "result", text: tr(ctx, `Échec : ${text}`, `Failed: ${text}`), ok: false }], navigate: call.navigate };
}

const fmt = (ctx: PilotContext, e164: string) => (e164.startsWith("+1") ? formatNanp(e164, ctx.fr ? "fr" : "en") : e164);
const okStatus = (s: number) => s >= 200 && s < 300;

/** Read-only tools: run at once, before any confirmation. */
export async function runReadOnly(ctx: PilotContext, call: ValidatedCall, inject: Inject): Promise<CallResult> {
  const a = call.args as Record<string, any>;
  switch (call.tool) {
    case "navigate":
    case "open_conversation":
      return done(ctx, call, tr(ctx, "page ouverte", "page opened"));

    case "search_calls": {
      const res = await inject("GET", "/v1/calls?limit=100");
      if (!okStatus(res.status)) return failed(ctx, call, res);
      let calls = (res.body as CallsResponse).calls;
      if (a.filter === "missed") calls = calls.filter((c) => c.missed);
      if (a.filter === "inbound") calls = calls.filter((c) => c.direction === "inbound");
      if (a.filter === "outbound") calls = calls.filter((c) => c.direction === "outbound");
      if (a.peer) calls = calls.filter((c) => c.peer === a.peer);
      const latest = calls[0];
      const text =
        calls.length === 0
          ? tr(ctx, "aucun appel trouvé", "no call found")
          : tr(ctx, `${calls.length} appel${calls.length > 1 ? "s" : ""}, le plus récent : ${fmt(ctx, latest!.peer)}`, `${calls.length} call${calls.length > 1 ? "s" : ""}, latest: ${fmt(ctx, latest!.peer)}`);
      return done(ctx, call, text, { navigate: { ...call.navigate!, ...(latest ? { highlight: `call-${latest.id}` } : {}) } });
    }

    case "open_voicemail": {
      const res = await inject("GET", "/v1/voicemails");
      if (!okStatus(res.status)) return failed(ctx, call, res);
      const list = (res.body as VoicemailsResponse).voicemails;
      if (!a.from) {
        const unheard = list.filter((v) => !v.listened).length;
        return done(ctx, call, tr(ctx, `${list.length} message(s), ${unheard} non écouté(s)`, `${list.length} message(s), ${unheard} unheard`), {
          navigate: { page: "voicemail", ...(list[0] ? { highlight: `vm-${list[0].id}` } : {}) },
        });
      }
      const from = String(a.from);
      // A number matches the caller; a first name is searched in the transcripts and summaries (as data, locally:
      // nothing is sent to the AI provider and nothing is logged).
      const needle = from.toLowerCase();
      const match = from.startsWith("+")
        ? list.find((v) => v.from === from)
        : list.find((v) => `${v.transcript ?? ""} ${v.ai?.summary ?? ""}`.toLowerCase().includes(needle));
      if (!match) {
        return done(ctx, call, tr(ctx, `aucun message de « ${from} » trouvé (MIMT ne connaît que les numéros et les transcriptions)`, `no voicemail from “${from}” found (MIMT only knows numbers and transcripts)`), {
          navigate: { page: "voicemail" },
        });
      }
      return done(ctx, call, tr(ctx, `message trouvé${match.from ? ` (${fmt(ctx, match.from)})` : ""}`, `voicemail found${match.from ? ` (${fmt(ctx, match.from)})` : ""}`), {
        navigate: { page: "voicemail", highlight: `vm-${match.id}` },
      });
    }

    case "usage_summary": {
      const res = await inject("GET", "/v1/me");
      if (!okStatus(res.status)) return failed(ctx, call, res);
      const me = res.body as MeResponse;
      const caps = (PLANS[me.account.plan] ? planOf(me.account.plan) : PLANS.free).caps;
      const name = planOf(me.account.plan).name[ctx.fr ? "fr" : "en"];
      const parts: string[] = [];
      if (caps.outboundMinutes > 0) {
        const left = Math.max(0, caps.outboundMinutes + (me.usage.bonusOutboundMinutes ?? 0) - me.usage.outboundMinutes);
        parts.push(tr(ctx, `${left} min sortantes restantes`, `${left} outbound min left`));
      }
      if (caps.onNetMinutes !== null) {
        const left = Math.max(0, caps.onNetMinutes + (me.usage.bonusOnNetMinutes ?? 0) - (me.usage.onNetMinutes ?? 0));
        parts.push(tr(ctx, `${left} min entre applications`, `${left} app-to-app min`));
      }
      if (caps.messages > 0) parts.push(tr(ctx, `${Math.max(0, caps.messages - me.usage.messages)} textos`, `${Math.max(0, caps.messages - me.usage.messages)} texts`));
      return done(ctx, call, `${name} — ${parts.join(", ") || tr(ctx, "aucun quota mesuré", "no metered quota")}`);
    }

    case "missions_status": {
      const res = await inject("GET", "/v1/missions");
      if (!okStatus(res.status)) return failed(ctx, call, res);
      const m = res.body as MissionsResponse;
      const doneCount = m.missions.filter((x) => x.status === "done").length;
      return done(ctx, call, tr(ctx, `${doneCount} sur ${m.missions.length} missions, ${m.totalMinutes} min gagnées`, `${doneCount} of ${m.missions.length} missions, ${m.totalMinutes} min earned`));
    }

    default:
      return { tool: call.tool, ok: false, code: "not_read_only", steps: [], navigate: null };
  }
}

/** Mutating tools: only after confirmation, through the same routes as the app's own buttons. */
export async function runConfirmed(ctx: PilotContext, call: ValidatedCall, inject: Inject): Promise<CallResult> {
  const a = call.args as Record<string, any>;
  const expect = async (res: Injected | Promise<Injected>, text: string, extra: Partial<CallResult> = {}) => {
    const r = await res;
    return okStatus(r.status) ? done(ctx, call, text, extra) : failed(ctx, call, r);
  };
  switch (call.tool) {
    case "send_text": {
      const to = String(a.to);
      const payload = to.startsWith("@") ? { to, body: a.body } : { from: ctx.numbers[0], to, body: a.body };
      return expect(inject("POST", "/v1/messages", payload), tr(ctx, "texto envoyé", "text sent"));
    }
    case "call_number":
      // The browser dials (Twilio Voice SDK); the server never places the call by itself.
      return done(ctx, call, tr(ctx, "composition dans le téléphone de l'app", "dialing in the app's phone"), { clientAction: { type: "dial", number: String(a.number) } });
    case "set_forwarding":
      return expect(
        inject("PATCH", "/v1/me", { forwarding: a.mode === "off" ? { mode: "off" } : { mode: a.mode, target: a.target } }),
        a.mode === "off" ? tr(ctx, "renvoi désactivé", "forwarding off") : tr(ctx, `renvoi actif vers ${fmt(ctx, String(a.target))}`, `forwarding to ${fmt(ctx, String(a.target))}`),
      );
    case "set_dnd":
      return expect(inject("PATCH", "/v1/me", { dnd: { enabled: Boolean(a.enabled) } }), a.enabled ? tr(ctx, "« Ne pas déranger » actif", "Do not disturb on") : tr(ctx, "« Ne pas déranger » désactivé", "Do not disturb off"));
    case "set_voicemail_greeting":
      return a.mode === "default"
        ? expect(inject("DELETE", "/v1/voicemail/greeting"), tr(ctx, "accueil par défaut rétabli", "default greeting restored"))
        : expect(inject("POST", "/v1/voicemail/greeting/call"), tr(ctx, "MIMT vous appelle dans l'app pour enregistrer", "MIMT is calling you in the app to record"));
    case "block_number":
      return expect(inject("POST", "/v1/blocks", { number: a.number }), tr(ctx, `${fmt(ctx, String(a.number))} bloqué`, `${fmt(ctx, String(a.number))} blocked`));
    case "unblock_number": {
      const r = await inject("DELETE", `/v1/blocks?number=${encodeURIComponent(String(a.number))}`);
      if (r.status === 404) return done(ctx, call, tr(ctx, "ce numéro n'était pas bloqué", "that number was not blocked"));
      return expect(r, tr(ctx, `${fmt(ctx, String(a.number))} débloqué`, `${fmt(ctx, String(a.number))} unblocked`));
    }
    case "set_handle":
      return expect(inject("PUT", "/v1/me/handle", { handle: a.handle }), tr(ctx, `@${a.handle} est à vous`, `@${a.handle} is yours`));
    case "start_meeting": {
      const r = await inject("POST", "/v1/meetings", { title: a.title });
      if (!okStatus(r.status)) return failed(ctx, call, r);
      return done(ctx, call, tr(ctx, "réunion créée", "meeting created"), { navigate: { page: "meetings", param: String(r.body?.id ?? ""), highlight: "meeting" } });
    }
    case "set_business_hours": {
      const base = `/v1/business/${encodeURIComponent(String(a.businessId))}/hours`;
      const cur = await inject("GET", base);
      if (!okStatus(cur.status)) return failed(ctx, call, cur);
      const { hours } = cur.body as BusinessHoursResponse;
      const weekly = { ...hours.weekly };
      for (const d of a.days as Array<keyof typeof weekly>) weekly[d] = [{ open: String(a.open), close: String(a.close) }];
      return expect(
        inject("PUT", base, { weekly, holidays: hours.holidays, quebecHolidays: hours.quebecHolidays, openTarget: hours.openTarget, closedTarget: hours.closedTarget }),
        tr(ctx, "heures d'ouverture enregistrées", "opening hours saved"),
      );
    }
    case "set_business_greeting":
      return expect(inject("PUT", `/v1/business/${encodeURIComponent(String(a.businessId))}/ai-receptionist`, { greeting: a.text }), tr(ctx, "accueil enregistré", "greeting saved"));
    default:
      return runReadOnly(ctx, call, inject);
  }
}
