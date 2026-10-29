// « Google Agenda » connector (Compte › Intégrations). Shapes: packages/shared/src/calendar.ts; spec docs/MIMT-CALENDAR.md.
import type { GoogleCalendarConnectResponse, GoogleCalendarSettingsRequest, GoogleCalendarStatusResponse } from "@mimt/shared";
import type { HttpClient } from "./http";

const P = "/v1/integrations/google-calendar";

export function calendarEndpoints(request: HttpClient["request"]) {
  return {
    googleCalendar: () => request<GoogleCalendarStatusResponse>("GET", P),
    /** Step-up protected: 403 step_up_required until the person confirms (useStepUp). */
    googleCalendarConnect: () => request<GoogleCalendarConnectResponse>("GET", `${P}/connect`),
    updateGoogleCalendar: (body: GoogleCalendarSettingsRequest) => request<GoogleCalendarStatusResponse>("PUT", P, { body }),
    /** Step-up protected. */
    disconnectGoogleCalendar: () => request<void>("DELETE", P),
  };
}
