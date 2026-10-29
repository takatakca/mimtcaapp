// « Google Agenda » connector (docs/MIMT-CALENDAR.md). CALENDAR=off (default): every route here answers 404.
//   GET    /v1/integrations/google-calendar           status, connected email, settings, entitlement
//   GET    /v1/integrations/google-calendar/connect   Google authorization URL (step-up required)
//   GET    /v1/integrations/google-calendar/callback  Google redirects here; we redirect to app.mimt.ca/compte/integrations?gc=ok|error
//   PUT    /v1/integrations/google-calendar           sync settings
//   DELETE /v1/integrations/google-calendar           disconnect + revoke at Google (step-up required)
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { GoogleCalendarConnectResponse, GoogleCalendarSettingsRequest, GoogleCalendarStatusResponse } from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser } from "../auth/guard.js";
import { requireRecentAuth } from "../auth/stepUp.js";
import { clientInfo } from "../lib/clientInfo.js";
import { forbidden, HttpError, notConfigured, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import {
  calendarConfigured,
  calendarEntitlement,
  calendarOn,
  calendarReturnUrl,
  calendarStatus,
  consumeState,
  createAuthUrl,
  disconnectCalendar,
  exchangeCode,
  GoogleReconnectNeeded,
  hasEventsScope,
  pkceVerifier,
  revokeToken,
} from "../services/calendar.js";

const P = "/v1/integrations/google-calendar";

const SettingsBody = z
  .object({
    syncCalls: z.boolean().optional(),
    syncMissedCalls: z.boolean().optional(),
    syncVoicemails: z.boolean().optional(),
    syncSummaries: z.boolean().optional(),
    includeContent: z.boolean().optional(),
    // Only the primary calendar (a dedicated calendar needs the broader « calendar » scope).
    calendar: z.literal("primary").optional(),
  })
  .strict();

const CallbackQuery = z.object({
  code: z.string().min(1).max(2000).optional(),
  state: z.string().min(1).max(2000).optional(),
  error: z.string().max(200).optional(),
});

export async function calendarRoutes(app: FastifyInstance, deps: AppDeps) {
  const { repo } = deps;
  const auth = { preHandler: requireUser(deps) };

  // Kill switch first: with CALENDAR=off nothing below exists (no auth error either, just 404).
  app.addHook("onRequest", async () => {
    if (!calendarOn(deps)) throw notFound("not_found", "Route not found");
  });

  const audit = (req: FastifyRequest, userId: string, action: string, meta?: Record<string, unknown>) =>
    repo.audit({ actorUserId: userId, action, targetType: "user", targetId: userId, ip: clientInfo(req).ipPrefix, ...(meta ? { meta } : {}) });

  app.get(P, auth, async (req): Promise<GoogleCalendarStatusResponse> => {
    const { user } = await loadContext(deps, req);
    return calendarStatus(deps, user.id);
  });

  app.get(`${P}/connect`, { ...auth, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req): Promise<GoogleCalendarConnectResponse> => {
    const { user } = await loadContext(deps, req);
    if (!calendarConfigured(deps)) throw notConfigured("Google Calendar");
    const ent = await calendarEntitlement(deps, user.id);
    if (!ent.entitled) {
      throw forbidden(
        "calendar_not_entitled",
        ent.canBuy ? "Google Agenda est une option de votre forfait : essai gratuit 14 jours, puis 3,95 $/mois." : "Google Agenda est inclus dans les forfaits Affaires.",
      );
    }
    // Connecting an outside account to the user's call history is sensitive: recent authentication (10 min).
    await requireRecentAuth(deps, req);
    await audit(req, user.id, "calendar.connect_started");
    return { authUrl: await createAuthUrl(deps, user.id) };
  });

  // Google redirects the browser here: no Authorization header, the signed single-use state says who it is.
  app.get(`${P}/callback`, { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply: FastifyReply) => {
    const back = (outcome: "ok" | "error", reason?: string) => reply.redirect(calendarReturnUrl(deps, outcome, reason), 302);
    const q = CallbackQuery.safeParse(req.query);
    if (!q.success || !q.data.state) return back("error", "invalid_request");
    if (!calendarConfigured(deps)) return back("error", "not_configured");
    const st = await consumeState(deps, q.data.state);
    if (!st) return back("error", "state");
    if (q.data.error || !q.data.code) {
      await audit(req, st.userId, "calendar.connect_denied");
      return back("error", q.data.error === "access_denied" ? "denied" : "google");
    }
    const user = await repo.getUser(st.userId);
    if (!user || user.status !== "active") return back("error", "account");
    if (!(await calendarEntitlement(deps, st.userId)).entitled) return back("error", "not_entitled");
    let tokens;
    try {
      tokens = await exchangeCode(deps, q.data.code, pkceVerifier(deps, st.nonce));
    } catch (err) {
      req.log.warn({ reason: err instanceof GoogleReconnectNeeded ? "grant" : "exchange" }, "google calendar code exchange failed");
      return back("error", "exchange");
    }
    // Granular consent: the user may untick the calendar permission. Without it there is nothing to sync.
    if (!hasEventsScope(tokens.scope)) {
      if (tokens.accessToken) await revokeToken(deps, tokens.accessToken);
      await audit(req, st.userId, "calendar.connect_denied", { reason: "scope" });
      return back("error", "scope");
    }
    if (!tokens.refreshToken) return back("error", "no_refresh_token");
    await repo.calendar.upsertConnection({
      userId: st.userId,
      googleEmail: tokens.email,
      refreshTokenEncrypted: deps.cipher.encrypt(tokens.refreshToken),
      scope: tokens.scope,
      at: deps.now(),
    });
    await audit(req, st.userId, "calendar.connected");
    return back("ok");
  });

  app.put(P, auth, async (req): Promise<GoogleCalendarStatusResponse> => {
    const { user } = await loadContext(deps, req);
    const body = parse(SettingsBody, req.body) satisfies GoogleCalendarSettingsRequest;
    const { calendar: _calendar, ...patch } = body;
    const updated = await repo.calendar.updateConnection(user.id, patch);
    if (!updated) throw new HttpError(404, "calendar_not_connected", "Google Agenda n'est pas connecté.");
    await audit(req, user.id, "calendar.settings_updated", { ...patch });
    return calendarStatus(deps, user.id);
  });

  app.delete(P, auth, async (req, reply) => {
    const { user } = await loadContext(deps, req);
    await requireRecentAuth(deps, req);
    if (!(await disconnectCalendar(deps, user.id, req.log))) throw new HttpError(404, "calendar_not_connected", "Google Agenda n'est pas connecté.");
    await audit(req, user.id, "calendar.disconnected");
    return reply.code(204).send();
  });
}
