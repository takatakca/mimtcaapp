// Dev/demo-only fixture API (VITE_MOCK_API=1): answers the same routes as api.mimt.ca from memory,
// so every screen can be reviewed without a backend, Twilio or Stripe. Never used in production
// builds of app.mimt.ca. Shapes come from @mimt/shared (the API contract); fixtures are fictional
// (555-01xx numbers). Loaded lazily by client.ts, so it is not in the main bundle.
import {
  AI_CONSENT_KIND,
  BUSINESS_TIMEZONE,
  DEFAULT_RECORDING_POLICY,
  DEFAULT_WEEKLY_SCHEDULE,
  NANP_E164,
  PLANS,
  USER_CONSENT_KINDS,
  filterOffersForPostalCode,
  generateContractSummary,
  isEmergencyNumber,
  isValidExtension,
  generateLoaText,
  signatureMatches,
  PORT_IN_CANCELABLE,
  PORT_IN_OPEN_NUMBER_STATUSES,
  type CreatePortInRequest,
  type NumberPortIn,
  quebecHolidaysCurrentAndNext,
  type AiReceptionistConfigDto,
  type ApiError,
  type AuthTokensResponse,
  type Business,
  type BusinessHours,
  type BusinessMember,
  type BusinessResponse,
  type CallRecord,
  type DidRoute,
  type E911AddressResponse,
  type Extension,
  type ExtensionRequest,
  type IvrMenu,
  type IvrMenuRequest,
  type MeResponse,
  type MessageDto,
  type Offer,
  type OrderEventRecord,
  type RingGroup,
  type RingGroupRequest,
  type ServiceOrder,
  type VoicemailDto,
  type Weekday,
} from "@mimt/shared";
import type { CreateOrderRequest } from "./pending";

const OUR = "+15145550100";
const USER_ID = "user-demo";
const BIZ_ID = "biz-demo";
const ACCESS_PREFIX = "demo-access-";
const REFRESH_PREFIX = "demo-refresh-";

interface State {
  seq: number;
  me: MeResponse;
  e911: E911AddressResponse | null;
  consents: Partial<Record<string, boolean>>;
  calls: CallRecord[];
  messages: MessageDto[];
  voicemails: VoicemailDto[];
  business: Business;
  seats: number;
  members: BusinessMember[];
  extensions: Extension[];
  ringGroups: RingGroup[];
  menus: IvrMenu[];
  hours: BusinessHours;
  dids: DidRoute[];
  receptionist: AiReceptionistConfigDto;
  offers: Offer[];
  orders: ServiceOrder[];
  orderEvents: OrderEventRecord[];
  portIns: NumberPortIn[];
}

const ago = (minutes: number, now = Date.now()) => new Date(now - minutes * 60_000).toISOString();

function offer(p: Pick<Offer, "id" | "code" | "productLine" | "name" | "description" | "monthlyPriceCents" | "attributes"> & Partial<Offer>): Offer {
  const created = "2026-10-01T12:00:00.000Z";
  return {
    provider: "sandbox",
    providerProductCode: null,
    setupFeeCents: 0,
    termMonths: 0,
    discountCents: 0,
    availableFsas: null,
    status: "active",
    stripePriceId: null,
    createdAt: created,
    updatedAt: created,
    ...p,
  };
}

function initialState(): State {
  const createdAt = "2026-09-01T14:00:00.000Z";
  const ext = (id: string, number: string, displayName: string, userId: string | null, did: string | null): Extension => ({
    id,
    businessId: BIZ_ID,
    number,
    userId,
    displayName,
    voicemail: { enabled: true, greeting: null },
    forwardToMobile: null,
    did,
    ringTimeoutS: 20,
    createdAt,
  });
  return {
    seq: 100,
    me: {
      user: { id: USER_ID, globalUserId: "tk-demo", locale: "fr-CA", displayName: "Camille Tremblay" },
      account: { id: "acct-demo", kind: "business", plan: "business", status: "active" },
      numbers: [{ id: "num-1", e164: OUR, state: "active" }],
      e911: { addressRegistered: true, noticeAccepted: true, noticeVersion: "2026-10-fr-1" },
      usage: { outboundMinutes: 212, inboundMinutes: 340, outboundSms: 418, periodStart: "2026-10-01T00:00:00.000Z" },
    },
    e911: {
      id: "e911-1",
      street: "1234, rue Sainte-Catherine Ouest",
      unit: "200",
      city: "Montréal",
      province: "QC",
      postalCode: "H3B 1A1",
      country: "CA",
      validated: true,
      providerRegistered: true,
    },
    consents: { [AI_CONSENT_KIND]: true },
    calls: [
      { id: "c1", direction: "inbound", kind: "pstn", peer: "+14385550142", ourNumber: OUR, status: "completed", startedAt: ago(35), endedAt: ago(31), durationS: 245, missed: false },
      { id: "c2", direction: "outbound", kind: "pstn", peer: "+15145550199", ourNumber: OUR, status: "completed", startedAt: ago(180), endedAt: ago(177), durationS: 162, missed: false },
      { id: "c3", direction: "inbound", kind: "pstn", peer: "+18195550123", ourNumber: OUR, status: "no-answer", startedAt: ago(60 * 26), endedAt: null, durationS: null, missed: true },
      { id: "c4", direction: "inbound", kind: "pstn", peer: "+12025550188", ourNumber: OUR, status: "completed", startedAt: ago(60 * 50), endedAt: ago(60 * 50 - 1), durationS: 12, missed: false, spamLabel: "scam" },
    ],
    messages: [
      { id: "m1", direction: "inbound", ourNumber: OUR, peer: "+14385550142", body: "Bonjour! Est-ce que vous êtes ouverts samedi?", status: "received", segments: 1, numMedia: 0, createdAt: ago(20) },
      { id: "m2", direction: "outbound", ourNumber: OUR, peer: "+14385550142", body: "Oui, de 10 h à 16 h. Au plaisir!", status: "delivered", segments: 1, numMedia: 0, createdAt: ago(18) },
      { id: "m3", direction: "inbound", ourNumber: OUR, peer: "+14385550142", body: "Parfait, merci. Je passe vers midi.", status: "received", segments: 1, numMedia: 0, createdAt: ago(15) },
      { id: "m4", direction: "outbound", ourNumber: OUR, peer: "+15145550199", body: "Votre commande est prête à être ramassée.", status: "delivered", segments: 1, numMedia: 0, createdAt: ago(60 * 5) },
      { id: "m5", direction: "inbound", ourNumber: OUR, peer: "+12025550188", body: "Votre colis est retenu. Payez les frais ici : bit.ly/xxxx", status: "received", segments: 1, numMedia: 0, createdAt: ago(60 * 49), spamLabel: "scam" },
    ],
    voicemails: [
      {
        id: "vm1",
        from: "+18195550123",
        durationS: 38,
        transcript: "Bonjour, c'est Julie de chez Fleurs Gatineau. Je voulais confirmer la livraison de jeudi. Rappelez-moi au 819 555-0123. Merci!",
        createdAt: ago(60 * 26),
        listened: false,
        audioUrl: null,
        audioUrlExpiresAt: null,
        ai: { summary: "Julie (Fleurs Gatineau) veut confirmer la livraison de jeudi.", locale: "fr-CA", callerIntent: "confirmation de livraison", urgency: "normal", callbackSuggested: true, spamLikelihood: 0.02 },
      },
      { id: "vm2", from: null, durationS: 9, transcript: null, createdAt: ago(60 * 72), listened: true, audioUrl: null, audioUrlExpiresAt: null },
    ],
    business: {
      id: BIZ_ID,
      name: "Café Lumière inc.",
      takatakBusinessId: "tk-biz-demo",
      telecomAccountId: "acct-demo",
      mainNumber: OUR,
      locale: "fr-CA",
      recordingPolicy: DEFAULT_RECORDING_POLICY,
      createdAt,
    },
    seats: 3,
    members: [
      { id: "mem-1", businessId: BIZ_ID, userId: USER_ID, email: "camille@example.com", role: "owner", status: "active", createdAt },
      { id: "mem-2", businessId: BIZ_ID, userId: "user-2", email: "olivier@example.com", role: "member", status: "active", createdAt },
      { id: "mem-3", businessId: BIZ_ID, userId: null, email: "nadia@example.com", role: "admin", status: "invited", createdAt },
    ],
    extensions: [ext("ext-101", "101", "Réception", USER_ID, OUR), ext("ext-102", "102", "Olivier — cuisine", "user-2", null), ext("ext-201", "201", "Comptabilité", null, null)],
    ringGroups: [
      {
        id: "rg-1",
        businessId: BIZ_ID,
        name: "Équipe du comptoir",
        number: "300",
        strategy: "simultaneous",
        memberExtensionIds: ["ext-101", "ext-102"],
        timeoutS: 25,
        overflow: { type: "voicemail", extensionId: "ext-101" },
        createdAt,
      },
    ],
    menus: [
      {
        id: "ivr-1",
        businessId: BIZ_ID,
        name: "Menu principal",
        greeting: {
          fr: "Bonjour et bienvenue au Café Lumière. Pour le comptoir, faites le 1. Pour la comptabilité, faites le 2. Pour nos heures, faites le 3.",
          en: "Hello and welcome to Café Lumière. For the counter, press 1. For accounting, press 2. For our hours, press 3.",
        },
        greetingRecordingUrl: null,
        options: [
          { digit: "1", target: { type: "ring_group", ringGroupId: "rg-1" } },
          { digit: "2", target: { type: "extension", extensionId: "ext-201" } },
          { digit: "3", target: { type: "ai_receptionist" } },
          { digit: "0", target: { type: "directory" } },
        ],
        timeoutS: 6,
        maxRetries: 2,
        timeoutTarget: { type: "ring_group", ringGroupId: "rg-1" },
        invalidTarget: null,
        createdAt,
      },
    ],
    hours: {
      businessId: BIZ_ID,
      timezone: BUSINESS_TIMEZONE,
      weekly: { ...DEFAULT_WEEKLY_SCHEDULE, sat: [{ open: "10:00", close: "16:00" }] },
      holidays: [{ date: "2026-12-26", name: "Lendemain de Noël" }],
      quebecHolidays: true,
      openTarget: { type: "ivr", ivrMenuId: "ivr-1" },
      closedTarget: { type: "voicemail" },
    },
    dids: [
      { id: "did-1", businessId: BIZ_ID, phoneNumberId: "num-1", e164: OUR, target: { type: "schedule" }, createdAt },
      { id: "did-2", businessId: BIZ_ID, phoneNumberId: "num-2", e164: "+14385550111", target: { type: "extension", extensionId: "ext-201" }, createdAt },
    ],
    receptionist: {
      businessId: BIZ_ID,
      enabled: false,
      businessName: "Café Lumière inc.",
      greeting: null,
      faqMarkdown: "",
      hoursText: "Lundi au vendredi, 9 h à 17 h; samedi, 10 h à 16 h.",
      address: "1234, rue Sainte-Catherine Ouest, Montréal",
      languages: ["fr-CA", "en-CA"],
      transferTargets: [],
      acceptedAt: null,
      acceptedVersion: null,
      updatedAt: null,
    },
    offers: [
      offer({
        id: "off-mob-20",
        code: "MOB-20",
        productLine: "mobile",
        name: { fr: "Mobile 20 Go", en: "Mobile 20 GB" },
        description: { fr: "Appels et textos illimités au Canada, 20 Go de données 5G.", en: "Unlimited Canada-wide calls and texts, 20 GB of 5G data." },
        monthlyPriceCents: 3500,
        attributes: { dataGb: 20, throttleKbps: 512, minutes: null, sms: null, network: "5g", esim: true },
      }),
      offer({
        id: "off-mob-60",
        code: "MOB-60",
        productLine: "mobile",
        name: { fr: "Mobile 60 Go", en: "Mobile 60 GB" },
        description: { fr: "60 Go de données 5G, itinérance aux États-Unis incluse.", en: "60 GB of 5G data, US roaming included." },
        monthlyPriceCents: 5000,
        attributes: { dataGb: 60, throttleKbps: 512, minutes: null, sms: null, network: "5g", esim: true, roamingZones: ["us"] },
      }),
      offer({
        id: "off-int-400",
        code: "INT-400",
        productLine: "internet_residential",
        name: { fr: "Internet 400", en: "Internet 400" },
        description: { fr: "Internet par câble, utilisation illimitée, modem inclus.", en: "Cable internet, unlimited usage, modem included." },
        monthlyPriceCents: 6000,
        setupFeeCents: 4999,
        attributes: { downloadMbps: 400, uploadMbps: 30, internetDataGb: null, technology: "cable", technicianInstall: false },
        availableFsas: ["H", "J", "G"],
      }),
      offer({
        id: "off-int-1g",
        code: "INT-1G-24",
        productLine: "internet_residential",
        name: { fr: "Internet Giga fibre (24 mois)", en: "Internet Giga fibre (24 months)" },
        description: { fr: "1 Gbit/s par fibre. Rabais de 10 $/mois avec une entente de 24 mois.", en: "1 Gbit/s fibre. $10/month off with a 24-month agreement." },
        monthlyPriceCents: 7500,
        termMonths: 24,
        discountCents: 24_000,
        attributes: { downloadMbps: 1000, uploadMbps: 1000, internetDataGb: null, technology: "fibre", technicianInstall: true },
        availableFsas: ["H2", "H3"],
      }),
      offer({
        id: "off-home",
        code: "HOME-1",
        productLine: "home_phone",
        name: { fr: "Téléphone résidentiel", en: "Home phone" },
        description: { fr: "Gardez votre numéro fixe. Appels illimités au Canada.", en: "Keep your landline number. Unlimited Canada-wide calls." },
        monthlyPriceCents: 1500,
        attributes: { minutes: null },
      }),
    ],
    orders: [],
    orderEvents: [],
    portIns: [
      {
        id: "port-demo-1",
        kind: "business",
        businessId: BIZ_ID,
        status: "foc_scheduled",
        numbers: [{ e164: "+15145550177", status: "foc_scheduled", focDate: "2026-10-21", rejectionReason: null, completedAt: null }],
        currentCarrier: "Bell Canada",
        customerType: "business",
        customerName: "Café Lumière inc.",
        authorizedName: "Camille Tremblay",
        authorizedEmail: "camille@cafelumiere.example",
        serviceAddress: { street: "1234, rue Sainte-Catherine Ouest", unit: "200", city: "Montréal", province: "QC", postalCode: "H3B 1A1" },
        hasPin: true,
        temporaryNumber: OUR,
        keepTemporaryNumber: false,
        desiredDate: null,
        focDate: "2026-10-21",
        feeCents: 0,
        loa: { version: "2026-10-loa-1", signedName: "Camille Tremblay", signedAt: createdAt, documentSha256: "0".repeat(64) },
        statusReason: null,
        createdAt,
        updatedAt: createdAt,
        completedAt: null,
        canceledAt: null,
      },
    ],
  };
}

let state = initialState();

/** Tests: start from fresh fixtures. */
export function resetMockState(): void {
  state = initialState();
}

const nextId = (prefix: string) => `${prefix}-${++state.seq}`;

// ------------------------------------------------------------------------------------- helpers

function json(status: number, body: unknown): Response {
  if (status === 204 || body === undefined) return new Response(null, { status: status === 200 ? 204 : status });
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const fail = (status: number, error: string, message = error) => json(status, { error, message } satisfies ApiError);

function tokens(): AuthTokensResponse {
  const r = Math.random().toString(36).slice(2, 10);
  return { accessToken: `${ACCESS_PREFIX}${r}`, refreshToken: `${REFRESH_PREFIX}${r}`, tokenType: "Bearer", expiresIn: 3600 };
}

function businessResponse(): BusinessResponse {
  return { business: state.business, role: "owner", seats: state.seats };
}

const montrealParts = (now: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: get("weekday").toLowerCase().slice(0, 3) as Weekday, time: `${get("hour")}:${get("minute")}`, date: `${get("year")}-${get("month")}-${get("day")}` };
};

/** Open right now in Montreal (weekly grid, minus custom and Quebec holidays). */
export function isOpenNow(hours: Pick<BusinessHours, "weekly" | "holidays" | "quebecHolidays">, now = new Date()): boolean {
  const { day, time, date } = montrealParts(now);
  if (hours.holidays.some((h) => h.date === date)) return false;
  if (hours.quebecHolidays && quebecHolidaysCurrentAndNext(Number(date.slice(0, 4))).some((h) => h.date === date)) return false;
  return (hours.weekly[day] ?? []).some((r) => r.open <= time && time < r.close);
}

function conversations() {
  const byPeer = new Map<string, MessageDto>();
  for (const m of [...state.messages].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) if (!byPeer.has(m.peer)) byPeer.set(m.peer, m);
  return [...byPeer.values()].map((m) => ({
    peer: m.peer,
    ourNumber: m.ourNumber,
    lastMessageAt: m.createdAt,
    lastMessage: { id: m.id, direction: m.direction, preview: m.body.slice(0, 120) },
  }));
}

function extensionError(body: Partial<ExtensionRequest>, selfId?: string): Response | null {
  if (body.number !== undefined) {
    if (!isValidExtension(body.number)) return fail(400, "validation_error", "invalid extension number");
    if (state.extensions.some((e) => e.number === body.number && e.id !== selfId)) return fail(409, "duplicate_extension");
  }
  if (body.displayName !== undefined && !body.displayName.trim()) return fail(400, "validation_error", "displayName required");
  for (const n of [body.forwardToMobile, body.did]) if (n && !NANP_E164.test(n)) return fail(400, "validation_error", "NANP E.164 only");
  return null;
}

function routeHasEmergency(menu: Pick<IvrMenuRequest, "options" | "timeoutTarget" | "invalidTarget">): boolean {
  const targets = [...menu.options.map((o) => o.target), menu.timeoutTarget, menu.invalidTarget];
  return targets.some((t) => t?.type === "external" && (isEmergencyNumber(t.number) || !NANP_E164.test(t.number)));
}

function addOrderEvent(order: ServiceOrder, event: OrderEventRecord["event"], fromState: ServiceOrder["state"] | null, toState: ServiceOrder["state"] | null, actor: OrderEventRecord["actor"], at: string) {
  state.orderEvents.push({ id: nextId("oev"), orderId: order.id, event, fromState, toState, actor, actorUserId: actor === "customer" ? USER_ID : null, details: {}, at });
}

// ------------------------------------------------------------------------------------- router

type Handler = (ctx: { params: string[]; query: URLSearchParams; body: unknown; method: string }) => Response;
type Route = [method: string, pattern: RegExp, handler: Handler, auth?: boolean];

const ok = (body: unknown) => json(200, body);
const created = (body: unknown) => json(201, body);
const B = "/v1/business/([^/]+)";

const routes: Route[] = [
  // Auth: any code works in demo mode.
  ["POST", /^\/v1\/auth\/takatak\/exchange$/, () => ok(tokens()), false],
  ["POST", /^\/v1\/auth\/otp\/start$/, ({ body }) => {
    const phone = (body as { phone?: string }).phone ?? "";
    return NANP_E164.test(phone) ? json(202, { status: "pending" }) : fail(400, "validation_error", "phone must be NANP E.164");
  }, false],
  ["POST", /^\/v1\/auth\/otp\/verify$/, ({ body }) => (/^\d{4,8}$/.test((body as { code?: string }).code ?? "") ? ok(tokens()) : fail(401, "invalid_code")), false],
  ["POST", /^\/v1\/auth\/refresh$/, ({ body }) =>
    ((body as { refreshToken?: string }).refreshToken ?? "").startsWith(REFRESH_PREFIX) ? ok(tokens()) : fail(401, "unauthorized"), false],
  ["POST", /^\/v1\/auth\/logout$/, () => json(204, undefined), false],

  // Me
  ["GET", /^\/v1\/me$/, () => ok(state.me)],
  ["PATCH", /^\/v1\/me$/, ({ body }) => {
    const b = body as { locale?: MeResponse["user"]["locale"]; displayName?: string | null };
    state.me = { ...state.me, user: { ...state.me.user, ...(b.locale ? { locale: b.locale } : {}), ...(b.displayName !== undefined ? { displayName: b.displayName } : {}) } };
    return ok({ id: state.me.user.id, locale: state.me.user.locale, displayName: state.me.user.displayName });
  }],
  ["GET", /^\/v1\/me\/export$/, () =>
    ok({ exportedAt: new Date().toISOString(), format: "mimt-export-v1", profile: state.me, calls: state.calls, messages: state.messages, voicemails: state.voicemails })],
  ["DELETE", /^\/v1\/me$/, () => json(202, { status: "pending_deletion", deletionScheduledAt: new Date(Date.now() + 30 * 86_400_000).toISOString() })],
  ["POST", /^\/v1\/consents$/, ({ body }) => {
    const b = body as { kind: string; granted: boolean; version: string };
    if (!(USER_CONSENT_KINDS as readonly string[]).includes(b.kind)) return fail(400, "validation_error", "unknown consent kind");
    state.consents[b.kind] = b.granted;
    return created({ id: nextId("consent"), kind: b.kind, granted: b.granted, version: b.version, at: new Date().toISOString() });
  }],

  // 9-1-1
  ["GET", /^\/v1\/e911\/address$/, () => (state.e911 ? ok(state.e911) : fail(404, "not_found"))],
  ["PUT", /^\/v1\/e911\/address$/, ({ body }) => {
    const b = body as { street: string; unit?: string; city: string; province: string; postalCode: string };
    state.e911 = { id: state.e911?.id ?? nextId("e911"), street: b.street, unit: b.unit ?? null, city: b.city, province: b.province, postalCode: b.postalCode, country: "CA", validated: true, providerRegistered: true };
    state.me = { ...state.me, e911: { ...state.me.e911, addressRegistered: true } };
    return ok(state.e911);
  }],
  ["GET", /^\/v1\/e911\/notice$/, ({ query }) =>
    ok({
      version: state.me.e911.noticeVersion,
      locale: query.get("locale") === "en-CA" ? "en-CA" : "fr-CA",
      reviewStatus: "demo",
      fr: { title: "Limites du service 9-1-1", paragraphs: ["Texte de démonstration. L'avis officiel est fourni par l'API MIMT."], acknowledgement: "J'ai lu et j'accepte les limites du service 9-1-1." },
      en: { title: "9-1-1 service limitations", paragraphs: ["Demo text. The official notice comes from the MIMT API."], acknowledgement: "I have read and accept the 9-1-1 service limitations." },
    }), false],
  ["POST", /^\/v1\/e911\/acknowledge$/, ({ body }) => {
    state.me = { ...state.me, e911: { ...state.me.e911, noticeAccepted: true } };
    return created({ noticeVersion: (body as { noticeVersion: string }).noticeVersion, acceptedAt: new Date().toISOString() });
  }],

  // Voice, calls
  ["GET", /^\/v1\/voice\/token$/, () => ok({ token: "demo-voice-token", identity: USER_ID, expiresAt: new Date(Date.now() + 3600_000).toISOString() })],
  ["GET", /^\/v1\/calls$/, () => ok({ calls: state.calls, nextCursor: null })],

  // Messaging
  ["GET", /^\/v1\/conversations$/, () => ok({ conversations: conversations() })],
  ["GET", /^\/v1\/conversations\/([^/]+)\/messages$/, ({ params }) =>
    ok({ messages: state.messages.filter((m) => m.peer === params[0]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), nextCursor: null })],
  ["GET", /^\/v1\/conversations\/([^/]+)\/suggestions$/, () =>
    ok(state.consents[AI_CONSENT_KIND]
      ? { suggestions: ["Oui, avec plaisir!", "Je vous reviens d'ici la fin de la journée.", "Merci, bonne journée!"], language: "fr-CA" }
      : { suggestions: [], language: "fr-CA", reason: "unavailable" })],
  ["POST", /^\/v1\/messages$/, ({ body }) => {
    const b = body as { from: string; to: string; body: string };
    if (!NANP_E164.test(b.to) || isEmergencyNumber(b.to)) return fail(400, "validation_error", "to must be NANP E.164");
    if (!b.body?.trim()) return fail(400, "validation_error", "empty body");
    const m: MessageDto = { id: nextId("msg"), direction: "outbound", ourNumber: b.from, peer: b.to, body: b.body, status: "queued", segments: Math.ceil(b.body.length / 160), numMedia: 0, createdAt: new Date().toISOString() };
    state.messages.push(m);
    state.me = { ...state.me, usage: { ...state.me.usage, outboundSms: state.me.usage.outboundSms + m.segments } };
    return created(m);
  }],
  ["GET", /^\/v1\/ai\/status$/, () =>
    ok({ configured: true, consent: Boolean(state.consents[AI_CONSENT_KIND]), plan: state.me.account.plan, monthlyBudgetCadCents: 1000, usedCadCents: 37, period: new Date().toISOString().slice(0, 7) })],

  // Voicemail
  ["GET", /^\/v1\/voicemails$/, () => ok({ voicemails: state.voicemails })],
  ["DELETE", /^\/v1\/voicemails\/([^/]+)$/, ({ params }) => {
    state.voicemails = state.voicemails.filter((v) => v.id !== params[0]);
    return json(204, undefined);
  }],

  // Billing: stays inside the app in demo mode.
  ["POST", /^\/v1\/billing\/checkout$/, () => ok({ checkoutUrl: "/compte?paiement=demo", sessionId: nextId("cs") })],
  ["GET", /^\/v1\/billing\/portal$/, () => ok({ portalUrl: "/compte?portail=demo" })],

  // Business (MIMT Affaires)
  ["GET", /^\/v1\/business$/, () => ok({ businesses: [businessResponse()] })],
  ["GET", new RegExp(`^${B}/usage$`), () => {
    const caps = PLANS.business.caps;
    const u = state.me.usage;
    return ok({
      plan: "business",
      seats: state.seats,
      periodStart: u.periodStart,
      perLine: { outboundMinutes: caps.outboundMinutes, inboundMinutes: caps.inboundMinutes, outboundSms: caps.outboundSms, concurrentCalls: caps.concurrentCalls },
      pooled: {
        outboundMinutes: { used: u.outboundMinutes, cap: caps.outboundMinutes * state.seats },
        inboundMinutes: { used: u.inboundMinutes, cap: caps.inboundMinutes * state.seats },
        outboundSms: { used: u.outboundSms, cap: caps.outboundSms * state.seats },
        concurrentCalls: { cap: caps.concurrentCalls * state.seats },
      },
      byUser: [{ userId: USER_ID, outboundMinutes: u.outboundMinutes, inboundMinutes: u.inboundMinutes }],
    });
  }],
  ["GET", new RegExp(`^${B}/calls$`), () =>
    ok({
      calls: state.calls.map((c) => ({
        id: c.id,
        direction: c.direction,
        kind: c.kind,
        userId: USER_ID,
        from: c.direction === "inbound" ? c.peer : (c.ourNumber ?? OUR),
        to: c.direction === "inbound" ? (c.ourNumber ?? OUR) : c.peer,
        status: c.status,
        startedAt: c.startedAt,
        endedAt: c.endedAt,
        durationS: c.durationS,
      })),
      nextCursor: null,
    })],
  ["POST", new RegExp(`^${B}/seats$`), ({ body }) => {
    const count = (body as { count?: number }).count ?? 0;
    if (!Number.isInteger(count) || count < 1 || count > 500) return fail(400, "validation_error");
    state.seats = count;
    return ok({ seats: count });
  }],
  ["PUT", new RegExp(`^${B}/recording-policy$`), ({ body }) => {
    const b = body as { mode: Business["recordingPolicy"]["mode"]; consentPrompt?: Business["recordingPolicy"]["consentPrompt"]; retentionDays?: number };
    if (b.mode !== "off" && state.me.account.plan !== "business_pro") return fail(402, "feature_required", "recording needs Affaires Pro");
    state.business = { ...state.business, recordingPolicy: { ...state.business.recordingPolicy, ...b } };
    return ok(businessResponse());
  }],

  ["GET", new RegExp(`^${B}/members$`), () => ok({ members: state.members })],
  ["POST", new RegExp(`^${B}/members$`), ({ body }) => {
    const b = body as { email: string; role: "admin" | "member" };
    if (state.members.some((m) => m.email === b.email)) return fail(409, "conflict");
    const m: BusinessMember = { id: nextId("mem"), businessId: BIZ_ID, userId: null, email: b.email, role: b.role, status: "invited", createdAt: new Date().toISOString() };
    state.members.push(m);
    return created(m);
  }],
  ["PATCH", new RegExp(`^${B}/members/([^/]+)$`), ({ params, body }) => {
    const m = state.members.find((x) => x.id === params[1]);
    if (!m) return fail(404, "not_found");
    if (m.role === "owner") return fail(403, "insufficient_role");
    Object.assign(m, { role: (body as { role: "admin" | "member" }).role });
    return ok(m);
  }],
  ["DELETE", new RegExp(`^${B}/members/([^/]+)$`), ({ params }) => {
    if (state.members.find((x) => x.id === params[1])?.role === "owner") return fail(403, "insufficient_role");
    state.members = state.members.filter((x) => x.id !== params[1]);
    return json(204, undefined);
  }],

  ["GET", new RegExp(`^${B}/extensions$`), () => ok({ extensions: [...state.extensions].sort((a, b) => a.number.localeCompare(b.number)) })],
  ["POST", new RegExp(`^${B}/extensions$`), ({ body }) => {
    const b = body as ExtensionRequest;
    const err = extensionError(b);
    if (err) return err;
    const e: Extension = {
      id: nextId("ext"),
      businessId: BIZ_ID,
      number: b.number,
      userId: b.userId ?? null,
      displayName: b.displayName.trim(),
      voicemail: b.voicemail ?? { enabled: true, greeting: null },
      forwardToMobile: b.forwardToMobile ?? null,
      did: b.did ?? null,
      ringTimeoutS: b.ringTimeoutS ?? 20,
      createdAt: new Date().toISOString(),
    };
    state.extensions.push(e);
    return created(e);
  }],
  ["PATCH", new RegExp(`^${B}/extensions/([^/]+)$`), ({ params, body }) => {
    const e = state.extensions.find((x) => x.id === params[1]);
    if (!e) return fail(404, "not_found");
    const b = body as Partial<ExtensionRequest>;
    const err = extensionError(b, e.id);
    if (err) return err;
    Object.assign(e, b);
    return ok(e);
  }],
  ["DELETE", new RegExp(`^${B}/extensions/([^/]+)$`), ({ params }) => {
    state.extensions = state.extensions.filter((x) => x.id !== params[1]);
    state.ringGroups = state.ringGroups.map((g) => ({ ...g, memberExtensionIds: g.memberExtensionIds.filter((id) => id !== params[1]) }));
    return json(204, undefined);
  }],

  ["GET", new RegExp(`^${B}/ring-groups$`), () => ok({ ringGroups: state.ringGroups })],
  ["POST", new RegExp(`^${B}/ring-groups$`), ({ body }) => {
    const b = body as RingGroupRequest;
    if (!b.name?.trim() || b.memberExtensionIds.length === 0) return fail(400, "validation_error");
    const g: RingGroup = { id: nextId("rg"), businessId: BIZ_ID, name: b.name, number: b.number ?? null, strategy: b.strategy, memberExtensionIds: b.memberExtensionIds, timeoutS: b.timeoutS ?? 25, overflow: b.overflow ?? null, createdAt: new Date().toISOString() };
    state.ringGroups.push(g);
    return created(g);
  }],
  ["PUT", new RegExp(`^${B}/ring-groups/([^/]+)$`), ({ params, body }) => {
    const g = state.ringGroups.find((x) => x.id === params[1]);
    if (!g) return fail(404, "not_found");
    const b = body as RingGroupRequest;
    Object.assign(g, { name: b.name, number: b.number ?? null, strategy: b.strategy, memberExtensionIds: b.memberExtensionIds, timeoutS: b.timeoutS ?? g.timeoutS, overflow: b.overflow ?? null });
    return ok(g);
  }],
  ["DELETE", new RegExp(`^${B}/ring-groups/([^/]+)$`), ({ params }) => {
    state.ringGroups = state.ringGroups.filter((x) => x.id !== params[1]);
    return json(204, undefined);
  }],

  ["GET", new RegExp(`^${B}/ivr$`), () => ok({ menus: state.menus })],
  ["POST", new RegExp(`^${B}/ivr$`), ({ body }) => {
    const b = body as IvrMenuRequest;
    if (!b.name?.trim() || !b.greeting?.fr?.trim() || routeHasEmergency(b)) return fail(400, "validation_error");
    const m: IvrMenu = {
      id: nextId("ivr"),
      businessId: BIZ_ID,
      name: b.name,
      greeting: b.greeting,
      greetingRecordingUrl: b.greetingRecordingUrl ?? null,
      options: b.options,
      timeoutS: b.timeoutS ?? 6,
      maxRetries: b.maxRetries ?? 2,
      timeoutTarget: b.timeoutTarget ?? null,
      invalidTarget: b.invalidTarget ?? null,
      createdAt: new Date().toISOString(),
    };
    state.menus.push(m);
    return created(m);
  }],
  ["PUT", new RegExp(`^${B}/ivr/([^/]+)$`), ({ params, body }) => {
    const m = state.menus.find((x) => x.id === params[1]);
    if (!m) return fail(404, "not_found");
    const b = body as IvrMenuRequest;
    if (!b.name?.trim() || !b.greeting?.fr?.trim() || routeHasEmergency(b)) return fail(400, "validation_error");
    Object.assign(m, { ...b, greetingRecordingUrl: b.greetingRecordingUrl ?? null, timeoutTarget: b.timeoutTarget ?? null, invalidTarget: b.invalidTarget ?? null });
    return ok(m);
  }],
  ["DELETE", new RegExp(`^${B}/ivr/([^/]+)$`), ({ params }) => {
    state.menus = state.menus.filter((x) => x.id !== params[1]);
    return json(204, undefined);
  }],

  ["GET", new RegExp(`^${B}/hours$`), () => ok({ hours: state.hours, open: isOpenNow(state.hours) })],
  ["PUT", new RegExp(`^${B}/hours$`), ({ body }) => {
    state.hours = { ...(body as Omit<BusinessHours, "businessId" | "timezone">), businessId: BIZ_ID, timezone: BUSINESS_TIMEZONE };
    return ok({ hours: state.hours, open: isOpenNow(state.hours) });
  }],

  ["GET", new RegExp(`^${B}/dids$`), () => ok({ routes: state.dids })],
  ["PUT", new RegExp(`^${B}/dids$`), ({ body }) => {
    const b = body as { e164: string; target: DidRoute["target"] };
    const r = state.dids.find((x) => x.e164 === b.e164);
    if (!r) return fail(404, "not_found");
    if (b.target.type === "external" && (isEmergencyNumber(b.target.number) || !NANP_E164.test(b.target.number))) return fail(400, "validation_error");
    r.target = b.target;
    return ok(r);
  }],
  ["GET", new RegExp(`^${B}/recordings$`), () => ok({ recordings: [] })],
  ["GET", new RegExp(`^${B}/ai-receptionist$`), () => ok(state.receptionist)],
  ["PUT", new RegExp(`^${B}/ai-receptionist$`), ({ body }) => {
    const { accept, ...rest } = body as Partial<AiReceptionistConfigDto> & { accept?: boolean };
    state.receptionist = { ...state.receptionist, ...rest, updatedAt: new Date().toISOString(), ...(accept ? { acceptedAt: new Date().toISOString(), acceptedVersion: "demo" } : {}) };
    return ok(state.receptionist);
  }],

  // Services (resale catalog, sandbox provider)
  ["GET", /^\/v1\/catalog\/offers$/, ({ query }) => {
    const postal = query.get("postalCode");
    const offers = postal ? filterOffersForPostalCode(state.offers, postal) : state.offers.filter((o) => o.status === "active").sort((a, b) => a.monthlyPriceCents - b.monthlyPriceCents);
    return ok({ postalCode: postal, offers });
  }],
  ["GET", /^\/v1\/catalog\/orders$/, () => ok({ orders: [...state.orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) })],
  ["GET", /^\/v1\/catalog\/orders\/([^/]+)$/, ({ params }) => {
    const order = state.orders.find((o) => o.id === params[0]);
    if (!order) return fail(404, "not_found");
    return ok({ order, events: state.orderEvents.filter((e) => e.orderId === order.id), offer: state.offers.find((o) => o.id === order.offerId) });
  }],
  ["POST", /^\/v1\/catalog\/orders$/, ({ body }) => {
    const b = body as CreateOrderRequest;
    const o = state.offers.find((x) => x.id === b.offerId && x.status === "active");
    if (!o) return fail(404, "not_found");
    const needsAddress = o.productLine.startsWith("internet") || o.productLine === "home_phone";
    if (needsAddress && !b.serviceAddress) return fail(400, "validation_error", "serviceAddress required");
    const now = new Date().toISOString();
    const order: ServiceOrder = {
      id: nextId("ord"),
      telecomAccountId: state.me.account.id,
      userId: USER_ID,
      offerId: o.id,
      offerCode: o.code,
      productLine: o.productLine,
      provider: o.provider,
      state: "submitted",
      serviceAddress: b.serviceAddress ?? null,
      monthlyPriceCents: o.monthlyPriceCents,
      setupFeeCents: o.setupFeeCents,
      termMonths: o.termMonths,
      discountCents: o.discountCents,
      simKind: o.productLine === "mobile" ? (b.simKind ?? "sim") : null,
      contractSummaryVersion: generateContractSummary(o).version,
      contractAcceptedAt: now,
      providerOrderId: null,
      failureReason: null,
      submittedAt: now,
      activatedAt: null,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
    };
    state.orders.push(order);
    addOrderEvent(order, "submit", "draft", "submitted", "customer", now);
    return created(order);
  }],

  // Number port-in (transfert de numéro). The account number and PIN are dropped, never stored.
  ["GET", /^\/v1\/port-ins$/, () => ok({ portIns: [...state.portIns].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) })],
  ["POST", /^\/v1\/port-ins$/, ({ body }) => {
    const b = body as CreatePortInRequest;
    const numbers = b.numbers ?? [];
    if (numbers.length === 0 || numbers.length > 20 || !numbers.every((n) => NANP_E164.test(n))) return fail(400, "validation_error", "numbers");
    if (new Set(numbers).size !== numbers.length) return fail(400, "validation_error", "duplicate numbers");
    for (const f of [b.currentCarrier, b.customerName, b.authorizedName, b.authorizedEmail, b.accountNumber, b.serviceAddress?.street, b.serviceAddress?.city]) {
      if (!f?.trim()) return fail(400, "validation_error", "missing field");
    }
    if (numbers.some((n) => state.me.numbers.some((x) => x.e164 === n))) return fail(409, "number_already_on_mimt");
    const open = (n: string) => state.portIns.some((p) => p.numbers.some((x) => x.e164 === n && (PORT_IN_OPEN_NUMBER_STATUSES as readonly string[]).includes(x.status)));
    if (numbers.some(open)) return fail(409, "port_in_exists");
    const now = new Date().toISOString();
    const p: NumberPortIn = {
      id: nextId("port"),
      kind: b.businessId ? "business" : "consumer",
      businessId: b.businessId ?? null,
      status: "pending_signature",
      numbers: numbers.map((e164) => ({ e164, status: "pending", focDate: null, rejectionReason: null, completedAt: null })),
      currentCarrier: b.currentCarrier.trim(),
      customerType: b.customerType,
      customerName: b.customerName.trim(),
      authorizedName: b.authorizedName.trim(),
      authorizedEmail: b.authorizedEmail.trim().toLowerCase(),
      serviceAddress: { ...b.serviceAddress, unit: b.serviceAddress.unit || null },
      hasPin: Boolean(b.pin),
      temporaryNumber: b.temporaryNumber ?? null,
      keepTemporaryNumber: Boolean(b.keepTemporaryNumber && b.temporaryNumber),
      desiredDate: b.desiredDate ?? null,
      focDate: null,
      feeCents: 0,
      loa: null,
      statusReason: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      canceledAt: null,
    };
    state.portIns.push(p);
    return created(p);
  }],
  ["GET", /^\/v1\/port-ins\/([^/]+)$/, ({ params }) => {
    const p = state.portIns.find((x) => x.id === params[0]);
    return p ? ok(p) : fail(404, "not_found");
  }],
  ["GET", /^\/v1\/port-ins\/([^/]+)\/loa$/, ({ params }) => {
    const p = state.portIns.find((x) => x.id === params[0]);
    if (!p) return fail(404, "not_found");
    const loa = generateLoaText({ ...p, numbers: p.numbers.map((n) => n.e164) });
    return ok({ version: loa.version, documentSha256: "0".repeat(64), fr: loa.fr, en: loa.en, signature: p.loa });
  }],
  ["POST", /^\/v1\/port-ins\/([^/]+)\/sign$/, ({ params, body }) => {
    const p = state.portIns.find((x) => x.id === params[0]);
    if (!p) return fail(404, "not_found");
    const b = body as { signedName?: string; accept?: boolean };
    if (p.status !== "pending_signature") return fail(409, "already_signed");
    if (b.accept !== true) return fail(400, "validation_error", "accept");
    if (!signatureMatches(b.signedName ?? "", p.authorizedName)) return fail(400, "signature_name_mismatch");
    const now = new Date().toISOString();
    Object.assign(p, {
      status: "submitted",
      updatedAt: now,
      loa: { version: "2026-10-loa-1", signedName: (b.signedName ?? "").trim(), signedAt: now, documentSha256: "0".repeat(64) },
      numbers: p.numbers.map((n) => ({ ...n, status: "submitted" })),
    });
    return ok(p);
  }],
  ["POST", /^\/v1\/port-ins\/([^/]+)\/cancel$/, ({ params }) => {
    const p = state.portIns.find((x) => x.id === params[0]);
    if (!p) return fail(404, "not_found");
    if (!PORT_IN_CANCELABLE.includes(p.status)) return fail(409, "not_cancelable");
    const now = new Date().toISOString();
    Object.assign(p, { status: "canceled", canceledAt: now, updatedAt: now, numbers: p.numbers.map((n) => ({ ...n, status: "canceled" })) });
    return ok(p);
  }],
];

const latencyMs = () => (import.meta.env.MODE === "test" ? 0 : 150);

/** Drop-in replacement for fetch() used by http.ts when VITE_MOCK_API=1. */
export async function mockFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input, "https://mock.mimt.local");
  const method = (init.method ?? "GET").toUpperCase();
  const delay = latencyMs();
  if (delay) await new Promise((r) => setTimeout(r, delay));
  let body: unknown = undefined;
  if (typeof init.body === "string" && init.body) {
    try {
      body = JSON.parse(init.body);
    } catch {
      return fail(400, "invalid_request", "invalid JSON");
    }
  }
  const pathMatches = routes.filter(([, re]) => re.test(url.pathname));
  if (pathMatches.length === 0) return fail(404, "not_found", `${method} ${url.pathname}`);
  const route = pathMatches.find(([m]) => m === method);
  if (!route) return fail(405, "method_not_allowed");
  const [, re, handler, auth = true] = route;
  if (auth) {
    const header = new Headers(init.headers).get("Authorization") ?? "";
    if (!header.startsWith(`Bearer ${ACCESS_PREFIX}`)) return fail(401, "unauthorized");
  }
  const params = (re.exec(url.pathname) ?? []).slice(1).map((p) => decodeURIComponent(p ?? ""));
  if (params[0] && url.pathname.startsWith("/v1/business/") && params[0] !== BIZ_ID) return fail(403, "not_a_member");
  return handler({ params, query: url.searchParams, body, method });
}
