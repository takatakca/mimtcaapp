// « Pilote MIMT »: turns proposed tool calls (from Claude or the local parser) into a validated plan.
// Every proposal goes through the same gate: whitelist → argument schema → never-list → the user's plan and role.
// Nothing here changes the account; execute.ts runs confirmed actions through the existing routes.
import { randomUUID } from "node:crypto";
import {
  formatNanp,
  isEmergencyNumber,
  normalizeHandle,
  pilotDialAllowed,
  PILOT_MAX_ACTIONS,
  PILOT_MUTATING,
  PILOT_OWNER_ONLY,
  PILOT_PLAN_TTL_S,
  RESERVED_HANDLES,
  type BusinessRole,
  type Feature,
  type PilotActionView,
  type PilotNavigate,
  type PilotRefusal,
  type PilotStep,
  type PilotTool,
  type PlanCode,
} from "@mimt/shared";
import type { AppDeps } from "../../deps.js";
import { normalizeDialed } from "../../lib/phone.js";
import { planOf } from "../../plansConfig.js";
import type { TelecomAccount, User } from "../../repo/types.js";
import { getFeatures, HELD_STATES } from "../../services/accounts.js";
import { checkForwardTarget } from "../../services/callControls.js";
import { isPilotTool, PILOT_ARG_SCHEMAS } from "./tools.js";

export interface PilotContext {
  deps: AppDeps;
  user: User;
  account: TelecomAccount;
  plan: PlanCode;
  features: ReadonlySet<Feature>;
  businesses: Array<{ id: string; name: string; role: BusinessRole }>;
  /** The user's MIMT numbers that can send and receive (E.164). */
  numbers: string[];
  handle: string | null;
  fr: boolean;
}

export async function loadPilotContext(deps: AppDeps, user: User, account: TelecomAccount): Promise<PilotContext> {
  const [{ plan, features }, memberships, numbers, handle] = await Promise.all([
    getFeatures(deps.repo, account.id),
    deps.repo.pbx.listBusinessesForUser(user.id),
    deps.repo.listNumbersByAccount(account.id),
    deps.repo.handles.forUser(user.id),
  ]);
  return {
    deps,
    user,
    account,
    plan,
    features,
    businesses: memberships.map((m) => ({ id: m.business.id, name: m.business.name, role: m.member.role })),
    numbers: numbers.filter((n) => HELD_STATES.has(n.state)).map((n) => n.e164),
    handle: handle?.handle ?? null,
    fr: user.locale === "fr-CA",
  };
}

/** A proposal that passed every check. `args` are normalized (E.164 numbers, lowercase handle…). */
export interface ValidatedCall {
  tool: PilotTool;
  args: Record<string, unknown>;
  mutating: boolean;
  summary: string;
  navigate: PilotNavigate | null;
}

export interface PlanDraft {
  steps: PilotStep[];
  calls: ValidatedCall[];
}

const tr = (ctx: Pick<PilotContext, "fr">, fr: string, en: string) => (ctx.fr ? fr : en);
const fmt = (ctx: PilotContext, e164: string) => (e164.startsWith("+1") ? formatNanp(e164, ctx.fr ? "fr" : "en") : e164);
const step = (kind: PilotStep["kind"], text: string, ok?: boolean): PilotStep => (ok === undefined ? { kind, text } : { kind, text, ok });

export function refusalSteps(ctx: Pick<PilotContext, "fr">, r: PilotRefusal): PilotStep[] {
  const why: Record<PilotRefusal, [string, string]> = {
    payments: ["Le Pilote ne touche jamais aux paiements. Ouvrez Compte › Gérer la facturation.", "The Pilote never handles payments. Open Account › Manage billing."],
    plan_change: ["Le Pilote ne change pas de forfait. Voyez les forfaits dans Compte.", "The Pilote does not change plans. See plans in Account."],
    account_deletion: ["Le Pilote ne supprime jamais un compte. C'est dans Compte, avec confirmation.", "The Pilote never deletes an account. It is in Account, with a confirmation."],
    e911: ["L'adresse 9-1-1 se change seulement à la main, dans Compte.", "The 9-1-1 address is only changed by hand, in Account."],
    emergency_call: ["En cas d'urgence, composez le 9-1-1 vous-même sur le clavier : c'est toujours permis.", "In an emergency, dial 9-1-1 yourself on the keypad: it always works."],
    other_users: ["Le Pilote n'agit que sur votre propre compte.", "The Pilote only acts on your own account."],
  };
  return [step("refuse", tr(ctx, ...why[r]), false)];
}

function businessFor(ctx: PilotContext, id: unknown): { business: PilotContext["businesses"][number] | null; steps: PilotStep[] } {
  const owned = ctx.businesses.filter((b) => b.role === "owner");
  const b = typeof id === "string" ? ctx.businesses.find((x) => x.id === id) : owned.length === 1 ? owned[0] : ctx.businesses.length === 1 ? ctx.businesses[0] : undefined;
  if (!b) {
    const none = ctx.businesses.length === 0;
    return {
      business: null,
      steps: [step("check", none ? tr(ctx, "Vérification : aucune entreprise MIMT Affaires sur ce compte", "Check: no MIMT Business on this account") : tr(ctx, "Vérification : précisez l'entreprise", "Check: say which business"), false)],
    };
  }
  if (b.role !== "owner") return { business: null, steps: [step("check", tr(ctx, `Vérification : réservé au propriétaire de ${b.name}`, `Check: owner of ${b.name} only`), false)] };
  return { business: b, steps: [step("check", tr(ctx, `Vérification : propriétaire de ${b.name} ✓`, `Check: owner of ${b.name} ✓`), true)] };
}

function planCheck(ctx: PilotContext, feature: Feature): PilotStep {
  const name = planOf(ctx.plan).name[ctx.fr ? "fr" : "en"];
  return ctx.features.has(feature)
    ? step("check", tr(ctx, `Vérification : forfait ${name} ✓`, `Check: ${name} plan ✓`), true)
    : step("check", tr(ctx, `Vérification : pas inclus dans le forfait ${name}`, `Check: not included in the ${name} plan`), false);
}

const DAY_NAMES: Record<string, [string, string]> = {
  mon: ["lun", "Mon"], tue: ["mar", "Tue"], wed: ["mer", "Wed"], thu: ["jeu", "Thu"], fri: ["ven", "Fri"], sat: ["sam", "Sat"], sun: ["dim", "Sun"],
};

type One = { steps: PilotStep[]; call: ValidatedCall | null };

/** Validates one proposal. Unknown tools and bad arguments are refused, never repaired silently. */
export async function validateCall(ctx: PilotContext, name: string, input: unknown): Promise<One> {
  if (!isPilotTool(name)) return { steps: [step("refuse", tr(ctx, "Action non permise : ignorée", "Action not allowed: ignored"), false)], call: null };
  const parsed = PILOT_ARG_SCHEMAS[name].safeParse(input ?? {});
  if (!parsed.success) return { steps: [step("refuse", tr(ctx, "Information manquante ou invalide : précisez votre demande", "Missing or invalid detail: please be more specific"), false)], call: null };
  const a = parsed.data as Record<string, any>;
  const mutating = PILOT_MUTATING.has(name);
  const ok = (summary: string, args: Record<string, unknown>, steps: PilotStep[], navigate: PilotNavigate | null): One => ({
    steps: [...steps, step("action", mutating ? tr(ctx, `Action proposée : ${summary}`, `Proposed action: ${summary}`) : tr(ctx, `Action : ${summary}`, `Action: ${summary}`))],
    call: { tool: name, args, mutating, summary, navigate },
  });
  const fail = (fr: string, en: string, extra: PilotStep[] = []): One => ({ steps: [...extra, step("check", tr(ctx, `Vérification : ${fr}`, `Check: ${en}`), false)], call: null });
  const dialable = (raw: string): string | null => (isEmergencyNumber(raw) ? null : normalizeDialed(raw));

  switch (name) {
    case "navigate":
      return ok(tr(ctx, "ouvrir la page", "open the page"), a, [step("understand", tr(ctx, "Compréhension : navigation", "Understanding: navigation"))], { page: a.page });

    case "search_calls": {
      const peer = a.peer ? dialable(a.peer) : null;
      if (a.peer && !peer) return fail("numéro invalide", "invalid number");
      const label = { all: ["l'historique des appels", "call history"], missed: ["les appels manqués", "missed calls"], inbound: ["les appels reçus", "incoming calls"], outbound: ["les appels faits", "outgoing calls"] }[a.filter as "all"]!;
      return ok(tr(ctx, `lire ${label[0]}`, `read ${label[1]}`), { filter: a.filter, ...(peer ? { peer } : {}) }, [step("understand", tr(ctx, `Compréhension : afficher ${label[0]}`, `Understanding: show ${label[1]}`))], {
        page: "calls",
        query: a.filter === "all" ? {} : { filtre: a.filter },
        highlight: "calls",
      });
    }

    case "open_conversation": {
      const peer = a.peer.startsWith("@") ? normalizeHandle(a.peer) && `@${normalizeHandle(a.peer)}` : dialable(a.peer);
      if (!peer) return fail("numéro ou @nom invalide", "invalid number or @handle");
      const who = peer.startsWith("@") ? peer : fmt(ctx, peer);
      return ok(tr(ctx, `ouvrir la conversation avec ${who}`, `open the conversation with ${who}`), { peer }, [step("understand", tr(ctx, `Compréhension : conversation avec ${who}`, `Understanding: conversation with ${who}`))], { page: "messages", param: peer });
    }

    case "open_voicemail": {
      const from = a.from ? (dialable(a.from) ?? a.from.slice(0, 40)) : null;
      const who = from ? (from.startsWith("+") ? fmt(ctx, from) : from) : null;
      return ok(
        who ? tr(ctx, `chercher le message vocal de ${who}`, `find the voicemail from ${who}`) : tr(ctx, "ouvrir la messagerie vocale", "open voicemail"),
        from ? { from } : {},
        [step("understand", who ? tr(ctx, `Compréhension : message vocal de ${who}`, `Understanding: voicemail from ${who}`) : tr(ctx, "Compréhension : messagerie vocale", "Understanding: voicemail"))],
        { page: "voicemail" },
      );
    }

    case "usage_summary":
      return ok(tr(ctx, "lire votre consommation du mois", "read this month's usage"), {}, [step("understand", tr(ctx, "Compréhension : minutes et textos restants", "Understanding: minutes and texts left"))], { page: "account", highlight: "usage" });

    case "missions_status":
      return ok(tr(ctx, "lire vos missions", "read your missions"), {}, [step("understand", tr(ctx, "Compréhension : progression des missions", "Understanding: mission progress"))], { page: "missions" });

    case "send_text": {
      const understand = step("understand", tr(ctx, "Compréhension : envoyer un texto", "Understanding: send a text"));
      let to: string | null;
      if (a.to.startsWith("@")) {
        const h = normalizeHandle(a.to);
        to = h ? `@${h}` : null;
      } else to = dialable(a.to);
      if (!to) return fail("destinataire invalide (jamais le 9-1-1)", "invalid recipient (never 9-1-1)", [understand]);
      if (!a.body) return fail("quel message envoyer? Dites-le après « : »", "what should the text say? Put it after “:”", [understand]);
      if (!to.startsWith("@") && ctx.numbers.length === 0) return fail("il faut un numéro MIMT pour texter un numéro de téléphone", "a MIMT number is needed to text a phone number", [understand]);
      const who = to.startsWith("@") ? to : fmt(ctx, to);
      return ok(tr(ctx, `envoyer à ${who} : « ${a.body} »`, `send to ${who}: “${a.body}”`), { to, body: a.body }, [understand, step("check", tr(ctx, "Vérification : destinataire valide ✓", "Check: valid recipient ✓"), true)], {
        page: "messages",
        param: to,
      });
    }

    case "call_number": {
      const understand = step("understand", tr(ctx, "Compréhension : passer un appel", "Understanding: place a call"));
      if (!pilotDialAllowed(a.number)) return { steps: [understand, ...refusalSteps(ctx, "emergency_call")], call: null };
      const n = normalizeDialed(a.number);
      if (!n) return fail("numéro invalide", "invalid number", [understand]);
      return ok(tr(ctx, `composer le ${fmt(ctx, n)}`, `dial ${fmt(ctx, n)}`), { number: n }, [understand, step("check", tr(ctx, "Vérification : numéro valide ✓", "Check: valid number ✓"), true)], { page: "calls" });
    }

    case "set_forwarding": {
      if (a.mode === "off") {
        return ok(tr(ctx, "désactiver le renvoi d'appels", "turn off call forwarding"), { mode: "off" }, [step("understand", tr(ctx, "Compréhension : arrêter le renvoi", "Understanding: stop forwarding"))], {
          page: "call_settings",
          highlight: "forwarding",
        });
      }
      const target = a.target ? String(a.target) : null;
      const shown = target ? (normalizeDialed(target) ? fmt(ctx, normalizeDialed(target)!) : target) : "?";
      const understand = step("understand", tr(ctx, `Compréhension : renvoyer les appels vers ${shown}`, `Understanding: forward calls to ${shown}`));
      const pc = planCheck(ctx, "call_forwarding");
      if (!pc.ok) return { steps: [understand, pc], call: null };
      if (!target) return fail("vers quel numéro? Le numéro complet (10 chiffres) est requis", "to which number? The full 10-digit number is needed", [understand, pc]);
      const check = await checkForwardTarget(ctx.deps, ctx.account, target);
      if (!check.ok) return fail(`destination refusée (${check.reason})`, `destination refused (${check.reason})`, [understand, pc]);
      const when = a.mode === "no_answer" ? tr(ctx, " si vous ne répondez pas", " when you don't answer") : "";
      return ok(
        tr(ctx, `activer le renvoi vers ${fmt(ctx, check.target)}${when}`, `turn on forwarding to ${fmt(ctx, check.target)}${when}`),
        { mode: a.mode, target: check.target },
        [understand, pc, step("check", tr(ctx, "Vérification : destination Canada/É.-U. ✓", "Check: Canada/US destination ✓"), true)],
        { page: "call_settings", highlight: "forwarding" },
      );
    }

    case "set_dnd":
      return ok(a.enabled ? tr(ctx, "activer « Ne pas déranger »", "turn on Do not disturb") : tr(ctx, "désactiver « Ne pas déranger »", "turn off Do not disturb"), { enabled: a.enabled }, [step("understand", tr(ctx, "Compréhension : ne pas déranger", "Understanding: do not disturb"))], {
        page: "call_settings",
        highlight: "dnd",
      });

    case "set_voicemail_greeting": {
      const understand = step("understand", tr(ctx, "Compréhension : message d'accueil de la messagerie", "Understanding: voicemail greeting"));
      if (a.mode === "default") {
        return ok(tr(ctx, "remettre le message d'accueil par défaut", "reset the greeting to the default"), { mode: "default" }, [understand], { page: "call_settings", highlight: "greeting" });
      }
      const pc = planCheck(ctx, "vm_greeting");
      if (!pc.ok) return { steps: [understand, pc], call: null };
      if (ctx.numbers.length === 0) return fail("il faut un numéro MIMT", "a MIMT number is needed", [understand, pc]);
      return ok(tr(ctx, "MIMT vous appelle pour enregistrer votre accueil", "MIMT calls you to record your greeting"), { mode: "record_by_phone" }, [understand, pc], { page: "call_settings", highlight: "greeting" });
    }

    case "block_number":
    case "unblock_number": {
      const block = name === "block_number";
      const understand = step("understand", block ? tr(ctx, "Compréhension : bloquer un numéro", "Understanding: block a number") : tr(ctx, "Compréhension : débloquer un numéro", "Understanding: unblock a number"));
      if (isEmergencyNumber(a.number)) return fail("le 9-1-1 ne se bloque jamais", "9-1-1 can never be blocked", [understand]);
      const n = normalizeDialed(a.number);
      if (!n) return fail("numéro invalide", "invalid number", [understand]);
      return ok(block ? tr(ctx, `bloquer le ${fmt(ctx, n)}`, `block ${fmt(ctx, n)}`) : tr(ctx, `débloquer le ${fmt(ctx, n)}`, `unblock ${fmt(ctx, n)}`), { number: n }, [understand], { page: "call_settings", highlight: "blocks" });
    }

    case "set_handle": {
      const understand = step("understand", tr(ctx, "Compréhension : choisir votre @nom", "Understanding: choose your @handle"));
      const h = normalizeHandle(a.handle);
      if (!h) return fail("de 3 à 20 caractères : lettres minuscules, chiffres, point ou _", "3 to 20 characters: lowercase letters, digits, dot or _", [understand]);
      if (RESERVED_HANDLES.has(h)) return fail("cet identifiant n'est pas disponible", "this handle is not available", [understand]);
      if (ctx.handle && ctx.handle !== h) return fail(`votre @nom est déjà @${ctx.handle} (il ne change pas)`, `your handle is already @${ctx.handle} (it cannot change)`, [understand]);
      return ok(tr(ctx, `réserver @${h}`, `claim @${h}`), { handle: h }, [understand], { page: "account", highlight: "handle" });
    }

    case "start_meeting": {
      const understand = step("understand", tr(ctx, "Compréhension : démarrer une réunion vidéo", "Understanding: start a video meeting"));
      const pc = planCheck(ctx, "video_meetings");
      if (!pc.ok) return { steps: [understand, pc], call: null };
      const title = a.title ?? tr(ctx, "Réunion MIMT", "MIMT meeting");
      return ok(tr(ctx, `créer la réunion « ${title} »`, `create the meeting “${title}”`), { title }, [understand, pc], { page: "meetings" });
    }

    case "set_business_hours": {
      const understand = step("understand", tr(ctx, "Compréhension : heures d'ouverture", "Understanding: opening hours"));
      if (a.open >= a.close) return fail("l'heure de fermeture doit suivre l'ouverture", "closing time must be after opening", [understand]);
      const { business, steps } = businessFor(ctx, a.businessId);
      if (!business) return { steps: [understand, ...steps], call: null };
      const days = (a.days as string[]).map((d) => DAY_NAMES[d]![ctx.fr ? 0 : 1]).join(", ");
      return ok(tr(ctx, `ouvert ${days} de ${a.open} à ${a.close}`, `open ${days} from ${a.open} to ${a.close}`), { businessId: business.id, days: [...new Set(a.days as string[])], open: a.open, close: a.close }, [understand, ...steps], {
        page: "business_hours",
        param: business.id,
        highlight: "hours",
      });
    }

    case "set_business_greeting": {
      const understand = step("understand", tr(ctx, "Compréhension : accueil de l'entreprise", "Understanding: business greeting"));
      if (!a.text) return fail("quel texte d'accueil? Dites-le après « : »", "what greeting text? Put it after “:”", [understand]);
      const { business, steps } = businessFor(ctx, a.businessId);
      if (!business) return { steps: [understand, ...steps], call: null };
      return ok(tr(ctx, `accueil de la réceptionniste IA : « ${a.text} »`, `AI receptionist greeting: “${a.text}”`), { businessId: business.id, text: a.text }, [understand, ...steps], {
        page: "business_receptionist",
        param: business.id,
        highlight: "greeting",
      });
    }
  }
}

/** Validates up to PILOT_MAX_ACTIONS proposals, in order. Owner-only tools are re-checked here too. */
export async function validateCalls(ctx: PilotContext, proposals: Array<{ name: string; input: unknown }>): Promise<PlanDraft> {
  const steps: PilotStep[] = [];
  const calls: ValidatedCall[] = [];
  if (proposals.length > PILOT_MAX_ACTIONS) steps.push(step("info", tr(ctx, `Seules les ${PILOT_MAX_ACTIONS} premières actions sont gardées`, `Only the first ${PILOT_MAX_ACTIONS} actions are kept`)));
  for (const p of proposals.slice(0, PILOT_MAX_ACTIONS)) {
    const one = await validateCall(ctx, p.name, p.input);
    steps.push(...one.steps);
    if (one.call) {
      if (PILOT_OWNER_ONLY.has(one.call.tool) && !ctx.businesses.some((b) => b.id === one.call!.args.businessId && b.role === "owner")) continue;
      calls.push(one.call);
    }
  }
  return { steps, calls };
}

export const actionView = (c: ValidatedCall): PilotActionView => ({ tool: c.tool, summary: c.summary, mutating: c.mutating });

// ------------------------------------------------------------------------------------- plan store

export interface StoredPlan {
  id: string;
  userId: string;
  /** Validated mutating calls, as proposed (re-validated at confirmation). */
  calls: Array<{ tool: PilotTool; args: Record<string, unknown> }>;
  expiresAt: Date;
  source: "ai" | "rules";
}

/**
 * Pending plans, in memory: short-lived (PILOT_PLAN_TTL_S), single use, bound to the user who asked.
 * One API instance serves MIMT today; with several instances, sticky sessions or a shared store are needed.
 */
export class PilotPlanStore {
  private readonly plans = new Map<string, StoredPlan>();
  constructor(private readonly max = 5000) {}

  put(userId: string, calls: StoredPlan["calls"], source: StoredPlan["source"], now: Date): StoredPlan {
    this.sweep(now);
    // One pending plan per user: a new command replaces the previous one.
    for (const [id, p] of this.plans) if (p.userId === userId) this.plans.delete(id);
    if (this.plans.size >= this.max) this.plans.delete(this.plans.keys().next().value!);
    const plan: StoredPlan = { id: randomUUID(), userId, calls, source, expiresAt: new Date(now.getTime() + PILOT_PLAN_TTL_S * 1000) };
    this.plans.set(plan.id, plan);
    return plan;
  }

  /** Removes and returns the plan. Another user's plan id reads as unknown. */
  take(id: string, userId: string, now: Date): StoredPlan | "expired" | null {
    const p = this.plans.get(id);
    if (!p || p.userId !== userId) return null;
    this.plans.delete(id);
    return p.expiresAt.getTime() < now.getTime() ? "expired" : p;
  }

  private sweep(now: Date) {
    for (const [id, p] of this.plans) if (p.expiresAt.getTime() < now.getTime()) this.plans.delete(id);
  }
}
