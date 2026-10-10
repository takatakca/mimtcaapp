import twilio from "twilio";
import type { PortInAddress, PortInCustomerType, PortInNumberStatus } from "@mimt/shared";
import type { Config } from "../config.js";

// Twilio Porting API (numbers.twilio.com/v1/Porting/...), behind one interface so tests use a fake.
// Reference: https://www.twilio.com/docs/phone-numbers/port-in/port-in-request-api
// Field names below are the documented snake_case JSON of that API (the same ones the
// twilio-node SDK models in lib/rest/numbers/v1/portingPortIn.d.ts).

export interface PortInSubmission {
  numbers: Array<{ e164: string; pin?: string }>;
  customerType: PortInCustomerType;
  customerName: string;
  accountNumber: string;
  /** Main (billing) telephone number of the losing-carrier account. */
  accountTelephoneNumber: string;
  authorizedName: string;
  authorizedEmail: string;
  serviceAddress: PortInAddress;
  /** YYYY-MM-DD */
  targetDate?: string;
  notificationEmails: string[];
  /** Twilio document SIDs (recent bill). See the TODO in TwilioRestPortingGateway.createPortIn. */
  documentSids: string[];
}

export interface PortInSnapshot {
  sid: string;
  /** Raw Twilio request status (port_in_request_status). */
  status: string;
  numbers: Array<{
    e164: string;
    /** Raw Twilio number status (port_in_phone_number_status). */
    status: string;
    /** Port date (FOC) once the losing carrier confirmed it. */
    portDate: string | null;
    rejectionReason: string | null;
  }>;
}

export interface Portability {
  portable: boolean;
  reason: string | null;
  pinAndAccountNumberRequired: boolean;
}

export interface TwilioPortingGateway {
  checkPortability(e164: string): Promise<Portability>;
  createPortIn(s: PortInSubmission): Promise<{ sid: string }>;
  getPortIn(sid: string): Promise<PortInSnapshot>;
  cancelPortIn(sid: string): Promise<void>;
  /**
   * Once a number has ported, Twilio holds it as an IncomingPhoneNumber on the account: point it at
   * MIMT's webhooks (same as a purchased number) and attach the 9-1-1 address.
   */
  configurePortedNumber(input: { e164: string; voiceUrl: string; smsUrl: string; statusCallback: string; emergencyAddressSid?: string }): Promise<{ sid: string }>;
}

/**
 * Twilio number status → MIMT number status. Unknown values stay "submitted" so nothing is
 * activated or released by mistake.
 * TODO(twilio): confirm the full list of port_in_phone_number_status values for Canadian numbers
 * against the Porting API docs before launch; only the obvious ones are mapped here.
 */
export function mapTwilioNumberStatus(raw: string, portDate: string | null): PortInNumberStatus {
  const s = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "completed") return "completed";
  if (s === "canceled" || s === "cancelled" || s === "expired") return "canceled";
  if (s === "rejected" || s === "failed" || s === "not_portable") return "rejected";
  if (s === "action_required") return "action_required";
  return portDate ? "foc_scheduled" : "submitted";
}

const PORT_IN_SID = /^KW[0-9a-f]{32}$/i;
const BASE = "https://numbers.twilio.com/v1/Porting";

/** Real Twilio Porting API client. Only documented endpoints; see the TODOs for what is not wired. */
export class TwilioRestPortingGateway implements TwilioPortingGateway {
  private readonly client: twilio.Twilio;

  constructor(private readonly config: Config) {
    const { TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET } = config;
    if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY_SID || !TWILIO_API_KEY_SECRET) throw new Error("Twilio is not configured");
    this.client = twilio(TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, { accountSid: TWILIO_ACCOUNT_SID, autoRetry: true, maxRetries: 2 });
  }

  private auth() {
    const { TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET } = this.config;
    return `Basic ${Buffer.from(`${TWILIO_API_KEY_SID}:${TWILIO_API_KEY_SECRET}`).toString("base64")}`;
  }

  private async call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { authorization: this.auth(), accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    // Never include the response body in the error: it can echo the account number or PIN.
    if (!res.ok) throw new Error(`Twilio Porting API ${method} ${path.split("/")[1] ?? ""} failed with HTTP ${res.status}`);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  private sid(sid: string) {
    if (!PORT_IN_SID.test(sid)) throw new Error("invalid port-in request SID");
    return sid;
  }

  async checkPortability(e164: string): Promise<Portability> {
    // GET /v1/Porting/Portability/PhoneNumber/{PhoneNumber}
    const r = await this.call<{ portable: boolean; not_portable_reason: string | null; pin_and_account_number_required: boolean }>(
      "GET",
      `/Portability/PhoneNumber/${encodeURIComponent(e164)}`,
    );
    return { portable: Boolean(r.portable), reason: r.not_portable_reason ?? null, pinAndAccountNumberRequired: Boolean(r.pin_and_account_number_required) };
  }

  async createPortIn(s: PortInSubmission) {
    // POST /v1/Porting/PortIn
    // TODO(twilio): Twilio requires a recent bill from the losing carrier as a document SID
    // (`documents`). Uploading it (Twilio Documents upload API) is not wired yet: until it is, ops
    // upload the bill in the Twilio Console and the request stays in action_required at Twilio.
    // TODO(twilio): Twilio emails the authorized representative its own LOA to sign
    // (signature_request_url). MIMT's signed LOA is our consent record; confirm with Twilio whether
    // it can replace theirs for Canadian ports.
    const a = s.serviceAddress;
    const r = await this.call<{ port_in_request_sid: string }>("POST", "/PortIn", {
      account_sid: this.config.TWILIO_ACCOUNT_SID,
      documents: s.documentSids,
      phone_numbers: s.numbers.map((n) => ({ phone_number: n.e164, ...(n.pin ? { pin: n.pin } : {}) })),
      losing_carrier_information: {
        customer_type: s.customerType === "business" ? "Business" : "Individual",
        customer_name: s.customerName,
        account_number: s.accountNumber,
        account_telephone_number: s.accountTelephoneNumber,
        authorized_representative: s.authorizedName,
        authorized_representative_email: s.authorizedEmail,
        address: { street: a.street, ...(a.unit ? { street_2: a.unit } : {}), city: a.city, state: a.province, zip: a.postalCode, country: "CA" },
      },
      notification_emails: s.notificationEmails,
      ...(s.targetDate ? { target_port_in_date: s.targetDate } : {}),
    });
    return { sid: r.port_in_request_sid };
  }

  async getPortIn(sid: string): Promise<PortInSnapshot> {
    // GET /v1/Porting/PortIn/{PortInRequestSid}
    const r = await this.call<{
      port_in_request_sid: string;
      port_in_request_status: string;
      phone_numbers: Array<{ phone_number: string; port_in_phone_number_status: string; port_date: string | null; rejection_reason: string | null }>;
    }>("GET", `/PortIn/${this.sid(sid)}`);
    return {
      sid: r.port_in_request_sid,
      status: r.port_in_request_status ?? "",
      numbers: (r.phone_numbers ?? []).map((n) => ({
        e164: n.phone_number,
        status: n.port_in_phone_number_status ?? "",
        portDate: n.port_date ? String(n.port_date).slice(0, 10) : null,
        rejectionReason: n.rejection_reason ?? null,
      })),
    };
  }

  async cancelPortIn(sid: string) {
    // DELETE /v1/Porting/PortIn/{PortInRequestSid}
    await this.call<void>("DELETE", `/PortIn/${this.sid(sid)}`);
  }

  async configurePortedNumber(input: { e164: string; voiceUrl: string; smsUrl: string; statusCallback: string; emergencyAddressSid?: string }) {
    const [n] = await this.client.incomingPhoneNumbers.list({ phoneNumber: input.e164, limit: 1 });
    if (!n) throw new Error("ported number not found on the Twilio account yet");
    await this.client.incomingPhoneNumbers(n.sid).update({
      voiceUrl: input.voiceUrl,
      voiceMethod: "POST",
      smsUrl: input.smsUrl,
      smsMethod: "POST",
      statusCallback: input.statusCallback,
      statusCallbackMethod: "POST",
      ...(input.emergencyAddressSid ? { emergencyAddressSid: input.emergencyAddressSid } : {}),
    });
    return { sid: n.sid };
  }
}

/**
 * X-Twilio-Signature check for the porting webhook. JSON bodies are signed over the URL, which
 * carries a bodySHA256 query parameter; form bodies are signed over URL + parameters.
 */
export function validatePortingSignature(authToken: string, signature: string | undefined, url: string, rawBody: string, form: Record<string, unknown> | null): boolean {
  if (!signature) return false;
  if (form) return twilio.validateRequest(authToken, signature, url, form);
  return twilio.validateRequestWithBody(authToken, signature, url, rawBody);
}
