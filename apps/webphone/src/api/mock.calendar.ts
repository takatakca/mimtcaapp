// Demo fixtures for « Google Agenda » (VITE_MOCK_API=1). Same routes as apps/api routes/calendar.ts, simplified: the
// demo « connects » without leaving the app (the auth URL is a same-origin path) and has no step-up here.
import { SUBSCRIPTION_ADD_ONS, type CalendarSettings, type GoogleCalendarStatusResponse, type PlanCode } from "@mimt/shared";
import type { MockHelpers, MockRoute } from "./mock.meetings";

interface State {
  connected: boolean;
  addOn: boolean;
  settings: CalendarSettings;
  lastSyncAt: string | null;
}

const fresh = (): State => ({
  connected: false,
  addOn: false,
  settings: { syncCalls: true, syncMissedCalls: true, syncVoicemails: true, syncSummaries: true, includeContent: false, calendar: "primary" },
  lastSyncAt: null,
});
let state = fresh();

export function resetCalendarMock() {
  state = fresh();
}

export function calendarMockRoutes(h: Pick<MockHelpers, "ok" | "fail">, plan: () => PlanCode): MockRoute[] {
  const P = /^\/v1\/integrations\/google-calendar$/;
  const view = (): GoogleCalendarStatusResponse => {
    const p = plan();
    const included = p === "business" || p === "business_pro";
    const entitled = included || state.addOn;
    return {
      configured: true,
      entitled,
      entitlement: included ? "plan" : state.addOn ? "addon" : null,
      trialAvailable: true,
      canBuy: !entitled && (SUBSCRIPTION_ADD_ONS.google_calendar.availableOn ?? []).includes(p),
      connected: state.connected,
      status: state.connected ? "active" : null,
      email: state.connected ? "marie.tremblay@gmail.com" : null,
      calendarId: state.connected ? "primary" : null,
      connectedAt: state.connected ? new Date(Date.now() - 86_400_000).toISOString() : null,
      lastSyncAt: state.connected ? state.lastSyncAt : null,
      settings: state.settings,
    };
  };
  return [
    ["GET", P, () => h.ok(view())],
    [
      "GET",
      /^\/v1\/integrations\/google-calendar\/connect$/,
      () => {
        if (!view().entitled) return h.fail(403, "calendar_not_entitled");
        state.connected = true;
        state.lastSyncAt = new Date(Date.now() - 4 * 60_000).toISOString();
        return h.ok({ authUrl: "/compte/integrations?gc=ok" });
      },
    ],
    [
      "PUT",
      P,
      ({ body }) => {
        if (!state.connected) return h.fail(404, "calendar_not_connected");
        const { calendar: _c, ...patch } = (body ?? {}) as Partial<CalendarSettings>;
        state.settings = { ...state.settings, ...patch, calendar: "primary" };
        return h.ok(view());
      },
    ],
    [
      "DELETE",
      P,
      () => {
        if (!state.connected) return h.fail(404, "calendar_not_connected");
        state.connected = false;
        return new Response(null, { status: 204 });
      },
    ],
  ];
}
