import { pathToFileURL } from "node:url";
import { dailyTriggerUsd, voiceCountryPermission } from "../twilio/guardrails.js";

const TRIGGER_NAME = "MIMT daily spend";

interface TwilioList<T> {
  content?: T[];
  countries?: T[];
  usage_triggers?: T[];
  meta?: { next_page_url?: string | null };
  next_page_uri?: string | null;
}

async function twilioFetch(url: string, auth: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const res = await fetchImpl(url, { ...init, headers: { authorization: auth, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
  return res;
}

function basic(keySid: string, secret: string) {
  return `Basic ${Buffer.from(`${keySid}:${secret}`).toString("base64")}`;
}

/** Canada and the US only, high-risk ranges off, SMS pumping if the API exists, daily spend trigger. */
export async function applyTwilioGuardrails(input: {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  callbackUrl: string;
  alertCad: number;
  usdToCad: number;
  fetchImpl?: typeof fetch;
}): Promise<{ countries: number; trigger: "created" | "exists"; pumping: "enabled" | "unsupported" }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const auth = basic(input.apiKeySid, input.apiKeySecret);
  const countries: Array<{ iso_code?: string; isoCode?: string }> = [];
  let next: string | null = "https://voice.twilio.com/v1/DialingPermissions/Countries?PageSize=1000";
  for (let page = 0; page < 5 && next; page++) {
    const res = await twilioFetch(next, auth, {}, fetchImpl);
    if (!res.ok) throw new Error(`voice countries HTTP ${res.status}`);
    const body = (await res.json()) as TwilioList<{ iso_code?: string; isoCode?: string }>;
    countries.push(...(body.content ?? body.countries ?? []));
    next = body.meta?.next_page_url ?? null;
  }
  const updates = countries
    .map((c) => c.iso_code ?? c.isoCode)
    .filter((iso): iso is string => Boolean(iso))
    .map(voiceCountryPermission);
  const form = new URLSearchParams({ UpdateRequest: JSON.stringify(updates) });
  const bulk = await twilioFetch(
    "https://voice.twilio.com/v1/DialingPermissions/BulkCountryUpdates",
    auth,
    { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() },
    fetchImpl,
  );
  if (!bulk.ok) throw new Error(`voice geo permissions HTTP ${bulk.status}`);

  const pumpingRes = await twilioFetch(
    "https://messaging.twilio.com/v1/SmsPumpingProtection",
    auth,
    { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ SmsPumpingProtectionEnabled: "true" }).toString() },
    fetchImpl,
  );
  const pumping = pumpingRes.ok ? "enabled" : "unsupported";

  const listUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(input.accountSid)}/Usage/Triggers.json?PageSize=100`;
  const existing = await twilioFetch(listUrl, auth, {}, fetchImpl);
  if (!existing.ok) throw new Error(`usage triggers HTTP ${existing.status}`);
  const listed = (await existing.json()) as TwilioList<{ friendly_name?: string }>;
  const already = (listed.usage_triggers ?? []).some((t) => t.friendly_name === TRIGGER_NAME);
  if (already) return { countries: updates.length, trigger: "exists", pumping };

  const trigger = new URLSearchParams({
    FriendlyName: TRIGGER_NAME,
    UsageCategory: "totalprice",
    TriggerBy: "price",
    Recurring: "daily",
    TriggerValue: dailyTriggerUsd(input.alertCad, input.usdToCad),
    CallbackUrl: input.callbackUrl,
    CallbackMethod: "POST",
  });
  const created = await twilioFetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(input.accountSid)}/Usage/Triggers.json`,
    auth,
    { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: trigger.toString() },
    fetchImpl,
  );
  if (!created.ok) throw new Error(`usage trigger create HTTP ${created.status}`);
  return { countries: updates.length, trigger: "created", pumping };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { loadConfig } = await import("../config.js");
  const config = loadConfig();
  if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_API_KEY_SID || !config.TWILIO_API_KEY_SECRET) {
    console.log("skipped: Twilio API key is not configured");
    process.exit(0);
  }
  const result = await applyTwilioGuardrails({
    accountSid: config.TWILIO_ACCOUNT_SID,
    apiKeySid: config.TWILIO_API_KEY_SID,
    apiKeySecret: config.TWILIO_API_KEY_SECRET,
    callbackUrl: `${config.PUBLIC_BASE_URL.replace(/\/$/, "")}/webhooks/twilio/usage`,
    alertCad: config.DAILY_SPEND_ALERT_CAD,
    usdToCad: config.USD_TO_CAD,
  });
  console.log(`voice countries updated: ${result.countries}; spend trigger: ${result.trigger}; sms pumping: ${result.pumping}`);
}
