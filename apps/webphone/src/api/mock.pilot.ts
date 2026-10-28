// Demo mode (VITE_MOCK_API=1) of the « Pilote MIMT »: the shared French/English parser plans the command, and
// confirmed actions run against the fixture API itself (like apps/api runs them through its own routes).
// Simplified on purpose: the real checks live in apps/api/src/ai/pilot/*.
import {
  formatNanp,
  parsePilotCommand,
  PILOT_MUTATING,
  PILOT_PLAN_TTL_S,
  type MeResponse,
  type PilotCommandResponse,
  type PilotConfirmResponse,
  type PilotNavigate,
  type PilotStep,
  type PilotToolCall,
} from "@mimt/shared";

type Call = (method: string, path: string, body?: unknown) => Promise<Response>;

const plans = new Map<string, { calls: PilotToolCall[]; expiresAt: number }>();
const json = (status: number, body: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fmt = (n: unknown) => (typeof n === "string" && n.startsWith("+1") ? formatNanp(n) : String(n ?? "?"));

const NAV: Partial<Record<string, PilotNavigate>> = {
  set_forwarding: { page: "call_settings", highlight: "forwarding" },
  set_dnd: { page: "call_settings", highlight: "dnd" },
  set_voicemail_greeting: { page: "call_settings", highlight: "greeting" },
  block_number: { page: "call_settings", highlight: "blocks" },
  unblock_number: { page: "call_settings", highlight: "blocks" },
  set_handle: { page: "account", highlight: "handle" },
  start_meeting: { page: "meetings" },
  usage_summary: { page: "account", highlight: "usage" },
  missions_status: { page: "missions" },
  open_voicemail: { page: "voicemail" },
  call_number: { page: "calls" },
};

function summary(c: PilotToolCall): string {
  const a = c.args;
  switch (c.tool) {
    case "set_forwarding":
      return a.mode === "off" ? "désactiver le renvoi d'appels" : `activer le renvoi vers ${fmt(a.target)}`;
    case "set_dnd":
      return a.enabled ? "activer « Ne pas déranger »" : "désactiver « Ne pas déranger »";
    case "send_text":
      return `envoyer à ${fmt(a.to)} : « ${String(a.body ?? "")} »`;
    case "call_number":
      return `composer le ${fmt(a.number)}`;
    case "block_number":
      return `bloquer le ${fmt(a.number)}`;
    case "unblock_number":
      return `débloquer le ${fmt(a.number)}`;
    case "set_handle":
      return `réserver @${String(a.handle)}`;
    case "start_meeting":
      return `créer la réunion « ${String(a.title ?? "Réunion MIMT")} »`;
    case "set_voicemail_greeting":
      return a.mode === "default" ? "remettre le message d'accueil par défaut" : "MIMT vous appelle pour enregistrer votre accueil";
    default:
      return c.tool;
  }
}

async function readOnly(c: PilotToolCall, call: Call): Promise<{ steps: PilotStep[]; navigate: PilotNavigate | null }> {
  const result = (text: string): PilotStep => ({ kind: "result", text: `Résultat : ${text}`, ok: true });
  switch (c.tool) {
    case "search_calls": {
      const res = (await (await call("GET", "/v1/calls?limit=100")).json()) as { calls: Array<{ id: string; missed: boolean; peer: string }> };
      const list = c.args.filter === "missed" ? res.calls.filter((x) => x.missed) : res.calls;
      return {
        steps: [{ kind: "understand", text: "Compréhension : afficher l'historique des appels" }, result(`${list.length} appel(s)`)],
        navigate: { page: "calls", query: c.args.filter && c.args.filter !== "all" ? { filtre: String(c.args.filter) } : {}, ...(list[0] ? { highlight: `call-${list[0].id}` } : {}) },
      };
    }
    case "usage_summary": {
      const me = (await (await call("GET", "/v1/me")).json()) as MeResponse;
      return { steps: [{ kind: "understand", text: "Compréhension : minutes et textos restants" }, result(`${me.usage.outboundMinutes} min sortantes utilisées ce mois-ci`)], navigate: NAV.usage_summary! };
    }
    case "navigate":
      return { steps: [{ kind: "understand", text: "Compréhension : navigation" }], navigate: { page: c.args.page as PilotNavigate["page"] } };
    case "open_conversation":
      return { steps: [{ kind: "understand", text: `Compréhension : conversation avec ${fmt(c.args.peer)}` }], navigate: { page: "messages", param: String(c.args.peer) } };
    default:
      return { steps: [{ kind: "understand", text: "Compréhension : lecture" }, result("page ouverte")], navigate: NAV[c.tool] ?? null };
  }
}

async function run(c: PilotToolCall, call: Call): Promise<{ ok: boolean; navigate: PilotNavigate | null; dial?: string }> {
  const a = c.args;
  const okOf = async (r: Promise<Response>) => (await r).ok;
  switch (c.tool) {
    case "set_forwarding":
      return { ok: await okOf(call("PATCH", "/v1/me", { forwarding: a.mode === "off" ? { mode: "off" } : { mode: a.mode, target: a.target } })), navigate: NAV.set_forwarding! };
    case "set_dnd":
      return { ok: await okOf(call("PATCH", "/v1/me", { dnd: { enabled: a.enabled } })), navigate: NAV.set_dnd! };
    case "block_number":
      return { ok: await okOf(call("POST", "/v1/blocks", { number: a.number })), navigate: NAV.block_number! };
    case "send_text": {
      const me = (await (await call("GET", "/v1/me")).json()) as MeResponse;
      return { ok: await okOf(call("POST", "/v1/messages", { from: me.numbers[0]?.e164, to: a.to, body: a.body })), navigate: { page: "messages", param: String(a.to) } };
    }
    case "call_number":
      return { ok: true, navigate: NAV.call_number!, dial: String(a.number) };
    default:
      return { ok: true, navigate: NAV[c.tool] ?? null };
  }
}

export async function pilotMock(path: string, body: unknown, call: Call): Promise<Response> {
  if (path === "/v1/ai/command") {
    const text = String((body as { text?: string })?.text ?? "");
    const parsed = parsePilotCommand(text);
    const local: PilotStep = { kind: "info", text: "Mode local : démonstration sans IA" };
    if (parsed.refusal) {
      return json(200, { planId: null, expiresAt: null, source: "rules", understood: true, steps: [{ kind: "refuse", text: "Le Pilote ne fait jamais cette action. Faites-la vous-même dans Compte.", ok: false }], pending: [], navigate: null } satisfies PilotCommandResponse);
    }
    if (parsed.calls.length === 0) {
      return json(200, { planId: null, expiresAt: null, source: "rules", understood: false, steps: [local, { kind: "info", text: "Je n'ai pas compris. Essayez : « appels manqués », « renvoie mes appels vers 514 555-0123 »." }], pending: [], navigate: null } satisfies PilotCommandResponse);
    }
    const steps: PilotStep[] = [local];
    let navigate: PilotNavigate | null = null;
    const mutating = parsed.calls.filter((c) => PILOT_MUTATING.has(c.tool));
    for (const c of parsed.calls.filter((x) => !PILOT_MUTATING.has(x.tool))) {
      const r = await readOnly(c, call);
      steps.push(...r.steps);
      navigate = r.navigate;
    }
    let planId: string | null = null;
    let expiresAt: string | null = null;
    if (mutating.length) {
      planId = crypto.randomUUID();
      const exp = Date.now() + PILOT_PLAN_TTL_S * 1000;
      expiresAt = new Date(exp).toISOString();
      plans.set(planId, { calls: mutating, expiresAt: exp });
      for (const c of mutating) {
        steps.push({ kind: "understand", text: `Compréhension : ${summary(c)}` });
        if (c.tool === "set_forwarding" && c.args.mode !== "off") steps.push({ kind: "check", text: "Vérification : forfait Premium ✓", ok: true });
        steps.push({ kind: "action", text: `Action proposée : ${summary(c)}` });
      }
      steps.push({ kind: "info", text: "En attente de votre confirmation" });
    }
    return json(200, {
      planId,
      expiresAt,
      source: "rules",
      understood: true,
      steps,
      pending: mutating.map((c) => ({ tool: c.tool, summary: summary(c), mutating: true })),
      navigate,
    } satisfies PilotCommandResponse);
  }

  const planId = String((body as { planId?: string })?.planId ?? "");
  const plan = plans.get(planId);
  plans.delete(planId);
  if (path === "/v1/ai/command/cancel") return json(204, undefined);
  if (!plan) return json(404, { error: "plan_not_found", message: "plan_not_found" });
  if (plan.expiresAt < Date.now()) return json(410, { error: "plan_expired", message: "plan_expired" });
  const out: PilotConfirmResponse = { steps: [], results: [], navigate: null, clientAction: null };
  for (const c of plan.calls) {
    out.steps.push({ kind: "action", text: `Exécution : ${summary(c)}` });
    const r = await run(c, call);
    out.steps.push({ kind: "result", text: r.ok ? "Résultat : c'est fait" : "Échec : refusé", ok: r.ok });
    out.results.push({ tool: c.tool, ok: r.ok });
    out.navigate = r.navigate;
    if (r.dial) out.clientAction = { type: "dial", number: r.dial };
    if (!r.ok) break;
  }
  return json(200, out);
}
