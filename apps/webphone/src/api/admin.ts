// MIMT staff tools (Compte › Administration): Twilio diagnostics and the import of an existing Twilio number.
// API: apps/api/src/routes/adminTwilio.ts (CATALOG_ADMIN_USER_IDS; 403 admin_only for everyone else).
import type { HttpClient } from "./http";

export interface TwilioDiagnosticsResponse {
  accountSidEnd: string;
  accountName: string | null;
  accountStatus: string | null;
  accountType: string | null;
  balance: { amount: string; currency: string } | null;
  twimlApp: { configured: boolean; voiceUrl: string | null } | null;
  voiceCountries: string[];
  usageTriggers: Array<{ name: string; usageCategory: string; triggerValue: string; recurring: string | null }>;
  numbers: Array<{ e164: string; voiceUrl: string | null; smsUrl: string | null }>;
  expected: { voiceUrl: string; smsUrl: string; statusCallback: string; outboundUrl: string };
}

export interface ImportNumberResponse {
  id: string;
  e164: string;
  state: string;
  plan: string;
  warnings: string[];
}

export function adminEndpoints(request: HttpClient["request"]) {
  return {
    twilioDiagnostics: () => request<TwilioDiagnosticsResponse>("GET", "/v1/admin/twilio/diagnostics"),
    /** Step-up protected: 403 step_up_required until the person confirms (useStepUp). */
    importNumber: (e164: string) => request<ImportNumberResponse>("POST", "/v1/admin/numbers/import", { body: { e164 } }),
  };
}
