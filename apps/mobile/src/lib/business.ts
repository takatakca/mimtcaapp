// MIMT Affaires on mobile (pure, unit-tested): which business lines the signed-in user has.
// Admin screens are not in the app; the full portal is at app.mimt.ca.
import { isEmergencyNumber, type BusinessResponse, type BusinessRole, type Extension } from "@mimt/shared";

export const BUSINESS_PORTAL_URL = "https://app.mimt.ca";

export interface BusinessLine {
  businessId: string;
  name: string;
  role: BusinessRole;
  /** My extension number in this business ("101"), if I have one. */
  extension: string | null;
  /** The business's main number (E.164). */
  mainNumber: string | null;
  /**
   * Number the API accepts as caller ID for calls on behalf of this business: my extension's direct
   * DID first, else the business main number (apps/api/src/pbx/engine.ts pickBusinessLine).
   */
  callerId: string | null;
}

export function businessLines(
  businesses: BusinessResponse[],
  extensionsByBusiness: Record<string, Extension[] | undefined>,
  userId: string | null | undefined,
): BusinessLine[] {
  return businesses.map(({ business, role }) => {
    const mine = userId ? (extensionsByBusiness[business.id] ?? []).find((e) => e.userId === userId) : undefined;
    return {
      businessId: business.id,
      name: business.name,
      role,
      extension: mine?.number ?? null,
      mainNumber: business.mainNumber,
      callerId: mine?.did ?? business.mainNumber ?? null,
    };
  });
}

/**
 * Twilio Voice connect params. CallerId picks the line the API bills and shows (personal or business).
 * 9-1-1 is never routed through a business line: the emergency path always gets Emergency and no
 * requested caller ID, so the server uses the user's own number or its fallback.
 */
export function outboundParams(to: string, callerId?: string | null): Record<string, string> {
  if (isEmergencyNumber(to)) return { To: to, Emergency: "true" };
  return { To: to, ...(callerId ? { CallerId: callerId } : {}) };
}
