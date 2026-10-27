// Dev/demo-only fixture API (VITE_MOCK_API=1): answers the same routes as api.mimt.ca from memory,
// so every screen can be reviewed without a backend, Twilio or Stripe. Never used in production
// builds of app.mimt.ca. Shapes come from @mimt/shared (the API contract); fixtures are fictional
// (555-01xx numbers). Loaded lazily by client.ts, so it is not in the main bundle.
import {
  normalizeHandle,
  AI_CONSENT_KIND,
  AI_RECEPTIONIST_TERMS_VERSION,
  BUSINESS_TIMEZONE,
  DEFAULT_RECORDING_POLICY,
  DEFAULT_WEEKLY_SCHEDULE,
  NANP_E164,
  PLANS,
  USER_CONSENT_KINDS,
  computeCancellation,
  consumerCodeFor,
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
  type AiReceptionistConfigRequest,
  type Appointment,
  type BusinessRecordingDto,
  type CancellationQuote,
  type CreateOrderRequest,
  type Device,
  type OrderDetailResponse,
  type PortingRequest,
  type PortInRequest,
  type ServiceInstance,
  type SubmitOrderRequest,
  type ApiError,
  type AuthTokensResponse,
  type Business,
  type BusinessHours,
  type BusinessMember,
  type BusinessResponse,
  type BlockedNumberDto,
  type CallRecord,
  type CallSettings,
  DEFAULT_CALL_SETTINGS,
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
  type UpdateMeRequest,
  type VoicemailDto,
  type VoicemailSettingsDto,
  type Weekday,
  MISSION_MINUTES_CAP,
  MISSIONS,
  type MissionGrantedDto,
  type MissionId,
  type MissionsResponse,
} from "@mimt/shared";
import { meetingMockRoutes, resetMeetingsMock } from "./mock.meetings";

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
  /** false = the account has a business plan but no business yet (localStorage "mimt.demo.business" = "none"). */
  hasBusiness: boolean;
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
  // Added with the real /v1/catalog contract and the AI pages.
  aiConfigured: boolean;
  recordings: BusinessRecordingDto[];
  services: ServiceInstance[];
  devices: Device[];
  appointments: Appointment[];
  porting: PortingRequest[];
  /** eSIM activation codes by device id (the real API keeps them encrypted). */
  esimCodes: Record<string, string>;
  // Call controls and voicemail settings (callControls.ts, media.ts).
  blocks: BlockedNumberDto[];
  voicemailSettings: VoicemailSettingsDto;
  /** Uploads created with POST /v1/media/uploads, by media id. */
  uploads: Record<string, { purpose: string; received: boolean }>;
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

/**
 * Demo only: localStorage "mimt.demo.plan" = free | lock | premium shows that consumer plan instead of
 * the default business account (e.g. to preview the free-plan ads placeholder).
 */
function demoPlan(): "free" | "lock" | "premium" | null {
  try {
    const v = globalThis.localStorage?.getItem("mimt.demo.plan");
    return v === "free" || v === "lock" || v === "premium" ? v : null;
  } catch {
    return null;
  }
}

/** Demo only: localStorage "mimt.demo.business" = "none" starts with a business plan and no business (the wizard). */
function demoNoBusiness(): boolean {
  try {
    return globalThis.localStorage?.getItem("mimt.demo.business") === "none";
  } catch {
    return false;
  }
}

function initialState(): State {
  const consumerPlan = demoPlan();
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
      account: consumerPlan
        ? { id: "acct-demo", kind: "consumer", plan: consumerPlan, status: "active", addOns: [] }
        : { id: "acct-demo", kind: "business", plan: "business", status: "active" },
      numbers: [{ id: "num-1", e164: OUR, state: "active" }],
      e911: { addressRegistered: true, noticeAccepted: true, noticeVersion: "2026-10-fr-1" },
      usage: consumerPlan
        ? { outboundMinutes: 12, inboundMinutes: 25, messages: 18, periodStart: "2026-10-01T00:00:00.000Z" }
        : { outboundMinutes: 212, inboundMinutes: 340, messages: 398, periodStart: "2026-10-01T00:00:00.000Z" },
      callSettings: DEFAULT_CALL_SETTINGS,
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
      {
        id: "vm3",
        from: "+15145550199",
        durationS: 21,
        transcript: "Salut, c'est Marc. Je voulais savoir si vous livrez dans le Plateau le samedi. Merci de me revenir.",
        createdAt: ago(60 * 30),
        listened: true,
        audioUrl: null,
        audioUrlExpiresAt: null,
      },
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
    hasBusiness: consumerPlan ? true : !demoNoBusiness(),
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
    aiConfigured: true,
    recordings: [
      {
        id: "rec-1",
        businessId: BIZ_ID,
        callSid: "CAdemo0000000000000000000000000001",
        extensionId: "ext-101",
        source: "on_demand",
        fromNumber: "+14385550142",
        toNumber: OUR,
        durationS: 245,
        createdAt: ago(35),
        deleteAfter: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        audioUrl: SILENT_WAV,
        audioUrlExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        summary: {
          text: "Une cliente demande une soumission pour l'entretien de sa thermopompe. Elle est disponible les matins de semaine.",
          actionItems: ["Envoyer la soumission par courriel", "Proposer une visite un matin de semaine"],
          locale: "fr-CA",
        },
      },
    ],
    services: [],
    devices: [],
    appointments: [],
    porting: [],
    esimCodes: {},
    blocks: [{ id: "block-1", e164: "+12025550188", label: "Faux soutien technique", createdAt: ago(60 * 49) }],
    voicemailSettings: { available: { greeting: true, email: true }, greeting: null, emailEnabled: false, email: "camille@example.com" },
    uploads: {},
  };
}

/** One second of silence (8 kHz, 8-bit mono WAV) so the demo player has something to play. */
const SILENT_WAV = (() => {
  const n = 8000;
  const bytes = new Uint8Array(44 + n);
  const v = new DataView(bytes.buffer);
  const str = (o: number, x: string) => [...x].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  str(36, "data");
  v.setUint32(40, n, true);
  bytes.fill(128, 44);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return `data:audio/wav;base64,${btoa(bin)}`;
})();

let state = initialState();
/** Demo MIMT handle of the signed-in user (null until chosen) and the handles that exist in the demo. */
let mockHandle: string | null = null;
const DEMO_HANDLES = new Set(["@camille", "@cafe.lumiere", "@jules"]);

/** Demo « Missions MIMT »: mission → when it was granted (same rules as apps/api services/missions.ts, in memory). */
let mockMissions = new Map<MissionId, string>();

/** Grants a demo mission once; returns what the real API would put in `missionGranted`. */
function grantMockMission(id: MissionId): MissionGrantedDto | null {
  if (mockMissions.has(id)) return null;
  mockMissions.set(id, new Date().toISOString());
  const def = MISSIONS.find((m) => m.id === id)!;
  const bucket = def.minutes > 0 ? (PLANS[state.me.account.plan].caps.onNetMinutes !== null ? "on_net" : "outbound") : null;
  return { id, minutes: def.minutes, bucket, status: "granted", period: bucket ? new Date().toISOString().slice(0, 7) : null };
}

function missionsResponse(): MissionsResponse {
  const missions = MISSIONS.map((def) => {
    const grantedAt = mockMissions.get(def.id) ?? null;
    return { id: def.id, status: grantedAt ? ("done" as const) : ("todo" as const), rewardKind: def.rewardKind, minutes: def.minutes, needsPurchase: def.needsPurchase, grantedAt };
  });
  return {
    enabled: true,
    missions,
    totalMinutes: missions.filter((m) => m.status === "done").reduce((s, m) => s + m.minutes, 0),
    capMinutes: MISSION_MINUTES_CAP,
    bucket: PLANS[state.me.account.plan].caps.onNetMinutes !== null ? "on_net" : "outbound",
    period: new Date().toISOString().slice(0, 7),
  };
}

/** Tests: start from fresh fixtures. */
export function resetMockState(): void {
  state = initialState();
  mockHandle = null;
  mockMissions = new Map();
  resetMeetingsMock();
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

/** POST /v1/business in demo mode: a fresh, empty business owned by the demo user. */
function startBusiness(name: string, locale: "fr-CA" | "en-CA") {
  const now = new Date().toISOString();
  state.hasBusiness = true;
  state.business = { id: BIZ_ID, name, takatakBusinessId: null, telecomAccountId: state.me.account.id, mainNumber: null, locale, recordingPolicy: DEFAULT_RECORDING_POLICY, createdAt: now };
  state.seats = 1;
  state.members = [{ id: nextId("mem"), businessId: BIZ_ID, userId: USER_ID, email: "camille@example.com", role: "owner", status: "active", createdAt: now }];
  state.extensions = [];
  state.ringGroups = [];
  state.menus = [];
  state.dids = [];
  state.recordings = [];
  state.hours = { businessId: BIZ_ID, timezone: BUSINESS_TIMEZONE, weekly: structuredClone(DEFAULT_WEEKLY_SCHEDULE), holidays: [], quebecHolidays: true, openTarget: { type: "voicemail" }, closedTarget: { type: "voicemail" } };
  state.receptionist = { ...state.receptionist, enabled: false, businessName: name, greeting: null, faqMarkdown: "", hoursText: "", address: null, transferTargets: [], acceptedAt: null, acceptedVersion: null, updatedAt: null };
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
    if (state.extensions.some((e) => e.number === body.number && e.id !== selfId)) return fail(409, "extension_number_taken");
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

// ------------------------------------------------------------------------------------- AI, catalog helpers

/** apps/api order of checks for AI features: 503 not_configured → 403 ai_consent_required. */
function aiGate(): Response | null {
  if (!state.aiConfigured) return fail(503, "not_configured", "AI is not configured on this server");
  if (!state.consents[AI_CONSENT_KIND]) return fail(403, "ai_consent_required");
  return null;
}

const CANCELLABLE: readonly ServiceOrder["state"][] = ["draft", "submitted", "credit_check", "pending_provider", "scheduled", "active", "suspended"];
const needsAddress = (line: ServiceOrder["productLine"]) => line.startsWith("internet") || line === "home_phone";
const findOrder = (id: string | undefined) => state.orders.find((o) => o.id === id);

function orderDetail(order: ServiceOrder): OrderDetailResponse {
  const offer = state.offers.find((o) => o.id === order.offerId);
  return {
    order,
    events: state.orderEvents.filter((e) => e.orderId === order.id),
    ...(offer ? { offer } : {}),
    service: state.services.find((x) => x.orderId === order.id) ?? null,
    appointments: state.appointments.filter((a) => a.orderId === order.id),
    devices: state.devices.filter((d) => d.orderId === order.id),
    porting: state.porting.find((p) => p.orderId === order.id) ?? null,
  };
}

/** Summary for the price and term frozen on the order (apps/api orderContractSummary). */
function orderSummary(order: ServiceOrder) {
  const offer = state.offers.find((o) => o.id === order.offerId)!;
  return generateContractSummary({
    ...offer,
    productLine: order.productLine,
    monthlyPriceCents: order.monthlyPriceCents,
    setupFeeCents: order.setupFeeCents,
    termMonths: order.termMonths,
    discountCents: order.discountCents,
  });
}

function move(order: ServiceOrder, event: OrderEventRecord["event"], to: ServiceOrder["state"], actor: OrderEventRecord["actor"]) {
  const now = new Date().toISOString();
  addOrderEvent(order, event, order.state, to, actor, now);
  order.state = to;
  order.updatedAt = now;
}

function toProvider(order: ServiceOrder, event: OrderEventRecord["event"] = "provider_accepted") {
  order.providerOrderId = nextId("sbx-ord");
  move(order, event, "pending_provider", event === "credit_approved" ? "admin" : "provider");
  const port = state.porting.find((p) => p.orderId === order.id && p.status === "pending");
  if (port) Object.assign(port, { status: "submitted", providerRef: nextId("sbx-port") });
}

function activate(order: ServiceOrder) {
  const now = new Date().toISOString();
  move(order, "activated", "active", "provider");
  order.activatedAt = now;
  const port = state.porting.find((p) => p.orderId === order.id && p.status !== "rejected" && p.status !== "cancelled");
  if (port) Object.assign(port, { status: "completed", completedAt: now });
  for (const d of state.devices) if (d.orderId === order.id && d.status !== "inactive") d.status = "active";
  for (const a of state.appointments) if (a.orderId === order.id && a.status === "booked") a.status = "completed";
  state.services.push({
    id: nextId("svc"),
    telecomAccountId: order.telecomAccountId,
    orderId: order.id,
    offerId: order.offerId,
    offerCode: order.offerCode,
    productLine: order.productLine,
    provider: order.provider,
    providerServiceId: nextId("sbx-svc"),
    status: "active",
    phoneE164: order.productLine === "mobile" ? (port?.phoneE164 ?? "+15145550161") : null,
    serviceAddress: order.serviceAddress,
    monthlyPriceCents: order.monthlyPriceCents,
    termMonths: order.termMonths,
    discountCents: order.discountCents,
    activatedAt: now,
    termEndsAt: order.termMonths ? new Date(Date.now() + order.termMonths * 30 * 86_400_000).toISOString() : null,
    cancelledAt: null,
    overageCapConsentCents: null,
    roamingCapConsentCents: null,
    usageNotified: { period: now.slice(0, 7), thresholds: [] },
    stripeSubscriptionId: null,
    stripeSubscriptionItemId: null,
    createdAt: now,
    updatedAt: now,
  });
}

function quote(order: ServiceOrder): CancellationQuote {
  const r = computeCancellation({
    productLine: order.productLine,
    termMonths: order.termMonths,
    discountCents: order.discountCents,
    monthlyPriceCents: order.monthlyPriceCents,
    activatedAt: order.activatedAt ? new Date(order.activatedAt) : null,
    cancelAt: new Date(),
    deviceBalanceCents: state.devices.filter((d) => d.orderId === order.id).reduce((sum, d) => sum + d.financedBalanceCents, 0),
  });
  return {
    orderId: order.id,
    feeCents: r.feeCents,
    deviceBalanceCents: r.deviceBalanceCents,
    totalCents: r.totalCents,
    basis: r.basis,
    inTrial: r.inTrial,
    monthsRemaining: r.monthsRemaining,
    effectiveAt: r.effectiveAt.toISOString(),
    explanation: r.explanation,
  };
}

/** Three install slots from the day after tomorrow (fixed hours so tests can book them). */
function demoSlots(): Array<{ startsAt: string; endsAt: string }> {
  return [2, 3, 4].map((days) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    d.setUTCHours(12, 0, 0, 0);
    return { startsAt: d.toISOString(), endsAt: new Date(d.getTime() + 4 * 3_600_000).toISOString() };
  });
}

function mobileAtProvider(order: ServiceOrder): Response | null {
  if (order.productLine !== "mobile") return fail(409, "not_mobile");
  if (order.state !== "pending_provider" || !order.providerOrderId) return fail(409, "order_not_ready");
  return null;
}

function newDevice(order: ServiceOrder, kind: "sim" | "esim", iccid: string, eid: string | null): Device {
  const now = new Date().toISOString();
  const device: Device = {
    id: nextId("dev"),
    telecomAccountId: order.telecomAccountId,
    orderId: order.id,
    serviceId: null,
    kind,
    serial: null,
    iccid,
    imei: null,
    eid,
    mac: null,
    status: "pending",
    financedBalanceCents: 0,
    createdAt: now,
    updatedAt: now,
  };
  state.devices.push(device);
  return device;
}

function esimResponse(order: ServiceOrder, device: Device) {
  const activationCode = state.esimCodes[device.id]!;
  const [, smdpAddress = "", matchingId = ""] = activationCode.split("$");
  return { order, device, activationCode, smdpAddress, matchingId };
}


// ------------------------------------------------------------------------------------- router

type Handler = (ctx: { params: string[]; query: URLSearchParams; body: unknown; method: string }) => Response;
type Route = [method: string, pattern: RegExp, handler: Handler, auth?: boolean];

/** Same rules as apps/api routes/me.ts: forwarding needs call_forwarding and a Canada/US target, never 9-1-1. */
function callSettingsPatch(b: UpdateMeRequest): CallSettings | Response {
  const current = state.me.callSettings ?? DEFAULT_CALL_SETTINGS;
  const next: CallSettings = { ...current };
  if (b.forwarding) {
    const target = b.forwarding.target === undefined ? current.forwarding.target : b.forwarding.target;
    if (b.forwarding.mode !== "off") {
      if (!PLANS[state.me.account.plan].features.includes("call_forwarding")) return fail(403, "plan_required");
      if (!target) return fail(400, "forwarding_target_required");
    }
    if (target && (isEmergencyNumber(target) || !NANP_E164.test(target))) return fail(400, "forwarding_destination_not_allowed");
    next.forwarding = { mode: b.forwarding.mode, target, timeoutS: b.forwarding.timeoutS ?? current.forwarding.timeoutS };
  }
  if (b.dnd) next.dnd = { enabled: b.dnd.enabled, schedule: b.dnd.schedule === undefined ? current.dnd.schedule : b.dnd.schedule };
  if (b.blockedCallAction) next.blockedCallAction = b.blockedCallAction;
  return next;
}

/** "514 555-0123", "+1…" → E.164 (Canada/US), like apps/api normalizeDialed. */
function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const e164 = raw.trim().startsWith("+") ? `+${digits}` : digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : null;
  return e164 && NANP_E164.test(e164) ? e164 : null;
}

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
    const b = body as UpdateMeRequest;
    const next = callSettingsPatch(b);
    if (next instanceof Response) return next;
    state.me = {
      ...state.me,
      callSettings: next,
      user: { ...state.me.user, ...(b.locale ? { locale: b.locale } : {}), ...(b.displayName !== undefined ? { displayName: b.displayName } : {}) },
    };
    return ok({ id: state.me.user.id, locale: state.me.user.locale, displayName: state.me.user.displayName, callSettings: next });
  }],
  ["GET", /^\/v1\/me\/export$/, () =>
    ok({ exportedAt: new Date().toISOString(), format: "mimt-export-v1", profile: state.me, calls: state.calls, messages: state.messages, voicemails: state.voicemails })],
  ["DELETE", /^\/v1\/me$/, () => json(202, { status: "pending_deletion", deletionScheduledAt: new Date(Date.now() + 30 * 86_400_000).toISOString() })],
  ["GET", /^\/v1\/consents$/, () =>
    ok({
      consents: Object.entries(state.consents).map(([kind, granted]) => ({ id: `consent-${kind}`, kind, granted: Boolean(granted), version: "demo", at: new Date().toISOString() })),
    })],
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
  // Same order of checks as apps/api/src/routes/ai.ts: 503 → 403 consent → 429 budget.
  ["GET", /^\/v1\/conversations\/([^/]+)\/suggestions$/, () =>
    aiGate() ?? ok({ suggestions: ["Oui, avec plaisir!", "Je vous reviens d'ici la fin de la journée.", "Merci, bonne journée!"], language: "fr-CA" })],
  ["GET", /^\/v1\/me\/handle$/, () => ok({ handle: mockHandle })],
  ["PUT", /^\/v1\/me\/handle$/, ({ body }) => {
    const h = normalizeHandle((body as { handle?: string }).handle);
    if (!h) return fail(400, "invalid_handle");
    if (mockHandle && mockHandle !== h) return fail(409, "handle_already_set");
    if (DEMO_HANDLES.has(h)) return fail(409, "handle_taken");
    if (mockHandle === h) return ok({ handle: h });
    mockHandle = h;
    const missionGranted = grantMockMission("choose_handle");
    return ok(missionGranted ? { handle: h, missionGranted } : { handle: h });
  }],
  // Missions MIMT (read-only; rewards come from the routes above, never from a claim).
  ["GET", /^\/v1\/missions$/, () => ok(missionsResponse())],
  ["GET", /^\/v1\/referrals$/, () =>
    ok({ code: "DEMO2345", shareUrl: "https://mimt.ca/invitation/DEMO2345", reward: { months: 1, plan: "premium" }, referrals: [], referredBy: null })],
  ["GET", /^\/v1\/push\/web\/key$/, () => ok({ publicKey: "BDemoPublicKeyForTheMockApiOnly" }), false],
  ["POST", /^\/v1\/push\/web\/subscribe$/, () => {
    grantMockMission("enable_push");
    return json(204, undefined);
  }],
  ["POST", /^\/v1\/push\/web\/unsubscribe$/, () => json(204, undefined)],
  ["POST", /^\/v1\/messages$/, ({ body }) => {
    const b = body as { from?: string; to: string; body: string };
    if (b.to.startsWith("@")) {
      if (!mockHandle) return fail(403, "handle_required");
      const to = normalizeHandle(b.to);
      if (!to || !DEMO_HANDLES.has(to)) return fail(404, "handle_not_found");
      if (!b.body?.trim()) return fail(400, "validation_error", "empty body");
      const m: MessageDto = { id: nextId("msg"), direction: "outbound", ourNumber: mockHandle, peer: to, body: b.body, status: "delivered", segments: 1, numMedia: 0, createdAt: new Date().toISOString() };
      state.messages.push(m);
      return created(m);
    }
    if (!NANP_E164.test(b.to) || isEmergencyNumber(b.to)) return fail(400, "validation_error", "to must be NANP E.164");
    if (!b.body?.trim()) return fail(400, "validation_error", "empty body");
    const m: MessageDto = { id: nextId("msg"), direction: "outbound", ourNumber: b.from ?? "", peer: b.to, body: b.body, status: "queued", segments: Math.ceil(b.body.length / 160), numMedia: 0, createdAt: new Date().toISOString() };
    state.messages.push(m);
    state.me = { ...state.me, usage: { ...state.me.usage, messages: state.me.usage.messages + m.segments } };
    return created(m);
  }],
  ["POST", /^\/v1\/ai\/help$/, ({ body }) => {
    const msgs = (body as { messages?: Array<{ role: string; text: string }> }).messages ?? [];
    const q = (msgs[msgs.length - 1]?.text ?? "").toLowerCase();
    if (!state.consents[AI_CONSENT_KIND]) return fail(403, "ai_consent_required");
    const answer = q.includes("transf")
      ? "Dans l'app : Services › Transférer un numéro. C'est gratuit; il faut le numéro de compte et le NIP de votre fournisseur actuel."
      : "Mode démo : posez une question sur les forfaits, le transfert de numéro ou le 9-1-1.";
    return ok({ answer, needsHuman: false });
  }],
  ["GET", /^\/v1\/ai\/status$/, () =>
    ok({ configured: state.aiConfigured, consent: Boolean(state.consents[AI_CONSENT_KIND]), plan: state.me.account.plan, monthlyBudgetCadCents: 1000, usedCadCents: 37, period: new Date().toISOString().slice(0, 7) })],

  // Voicemail
  // Call blocking (9-1-1 can never be blocked).
  ["GET", /^\/v1\/blocks$/, () => ok({ blocks: state.blocks })],
  ["POST", /^\/v1\/blocks$/, ({ body }) => {
    const b = body as { number?: string; label?: string | null };
    if (isEmergencyNumber(b.number ?? "")) return fail(400, "cannot_block_emergency");
    const e164 = toE164(b.number ?? "");
    if (!e164) return fail(400, "validation_error");
    const existing = state.blocks.find((x) => x.e164 === e164);
    if (existing) return ok(existing);
    if (state.blocks.length >= 500) return fail(409, "block_limit");
    const row: BlockedNumberDto = { id: nextId("block"), e164, label: b.label?.trim() || null, createdAt: new Date().toISOString() };
    state.blocks = [row, ...state.blocks];
    return created(row);
  }],
  ["DELETE", /^\/v1\/blocks\/([^/]+)$/, ({ params }) => {
    state.blocks = state.blocks.filter((x) => x.id !== params[0]);
    return json(204, undefined);
  }],
  ["DELETE", /^\/v1\/blocks$/, ({ query }) => {
    const e164 = toE164(query.get("number") ?? "");
    state.blocks = state.blocks.filter((x) => x.e164 !== e164);
    return json(204, undefined);
  }],

  // Media uploads: the signed URL points back at this fixture API (no bearer token, like Supabase).
  ["POST", /^\/v1\/media\/uploads$/, ({ body }) => {
    const b = body as { purpose?: string; contentType?: string; sizeBytes?: number };
    if (b.purpose !== "greeting" && b.purpose !== "mms") return fail(400, "validation_error");
    const mediaId = nextId("media");
    state.uploads[mediaId] = { purpose: b.purpose, received: false };
    return created({
      mediaId,
      uploadUrl: `https://mock.mimt.local/upload/${mediaId}`,
      uploadMethod: "PUT",
      uploadHeaders: { "Content-Type": b.contentType ?? "application/octet-stream" },
      uploadExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      maxBytes: 5 * 1024 * 1024,
    });
  }],
  ["PUT", /^\/upload\/([^/]+)$/, ({ params }) => {
    const u = state.uploads[params[0]!];
    if (!u) return fail(404, "not_found");
    u.received = true;
    return ok({});
  }, false],

  // Voicemail settings: custom greeting and voicemail by email (courriel).
  ["GET", /^\/v1\/voicemail\/settings$/, () => ok(state.voicemailSettings)],
  ["PATCH", /^\/v1\/voicemail\/settings$/, ({ body }) => {
    const b = body as { emailEnabled?: boolean };
    if (b.emailEnabled) {
      if (!state.voicemailSettings.available.email) return fail(403, "vm_email_not_in_plan");
      if (!state.voicemailSettings.email) return fail(409, "no_email");
    }
    if (b.emailEnabled !== undefined) state.voicemailSettings = { ...state.voicemailSettings, emailEnabled: b.emailEnabled };
    return ok(state.voicemailSettings);
  }],
  ["PUT", /^\/v1\/voicemail\/greeting$/, ({ body }) => {
    if (!state.voicemailSettings.available.greeting) return fail(403, "vm_greeting_not_in_plan");
    const mediaId = (body as { mediaId?: string }).mediaId ?? "";
    const u = state.uploads[mediaId];
    if (!u || u.purpose !== "greeting" || !u.received) return fail(400, "validation_error");
    const now = new Date();
    state.voicemailSettings = {
      ...state.voicemailSettings,
      greeting: { mediaId, url: SILENT_WAV, urlExpiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(), updatedAt: now.toISOString() },
    };
    return ok(state.voicemailSettings);
  }],
  ["DELETE", /^\/v1\/voicemail\/greeting$/, () => {
    state.voicemailSettings = { ...state.voicemailSettings, greeting: null };
    return ok(state.voicemailSettings);
  }],
  ["POST", /^\/v1\/voicemail\/greeting\/call$/, () =>
    state.voicemailSettings.available.greeting ? json(202, { status: "calling" }) : fail(403, "vm_greeting_not_in_plan")],

  ["GET", /^\/v1\/voicemails$/, () => ok({ voicemails: state.voicemails })],
  ["POST", /^\/v1\/voicemails\/([^/]+)\/summary$/, ({ params }) => {
    const vm = state.voicemails.find((v) => v.id === params[0]);
    if (!vm) return fail(404, "not_found");
    const gate = aiGate();
    if (gate) return gate;
    if (!vm.transcript) return fail(409, "no_transcript");
    vm.ai = {
      summary: `Résumé de démonstration : ${vm.transcript.slice(0, 90)}`,
      locale: "fr-CA",
      callerIntent: "demande de renseignements",
      urgency: "normal",
      callbackSuggested: true,
      spamLikelihood: 0.05,
    };
    return ok(vm);
  }],
  ["DELETE", /^\/v1\/voicemails\/([^/]+)$/, ({ params }) => {
    state.voicemails = state.voicemails.filter((v) => v.id !== params[0]);
    return json(204, undefined);
  }],

  // Billing: stays inside the app in demo mode.
  ["GET", /^\/v1\/public\/numbers\/holds\/([^/]+)$/, ({ params }) =>
    ok({ id: decodeURIComponent(params[0]!), e164: "+15145550102", status: "held", expiresAt: new Date(Date.now() + 9 * 60_000).toISOString() }), false],
  ["POST", /^\/v1\/billing\/checkout$/, () => ok({ checkoutUrl: "/compte?paiement=demo", sessionId: nextId("cs") })],
  ["GET", /^\/v1\/billing\/portal$/, () => ok({ portalUrl: "/compte?portail=demo" })],

  // Business (MIMT Affaires)
  ["GET", /^\/v1\/business$/, () => ok({ businesses: state.hasBusiness ? [businessResponse()] : [] })],
  ["POST", /^\/v1\/business$/, ({ body }) => {
    const b = body as { name?: string; locale?: "fr-CA" | "en-CA" };
    const name = b.name?.trim() ?? "";
    if (!name || name.length > 120) return fail(400, "validation_error", "name required");
    if (state.hasBusiness) return fail(409, "business_exists", "This account already has a business");
    startBusiness(name, b.locale ?? state.me.user.locale);
    return created(businessResponse());
  }],
  ["PATCH", new RegExp(`^${B}$`), ({ body }) => {
    const b = body as { name?: string; mainNumber?: string | null; locale?: "fr-CA" | "en-CA" };
    if (b.name !== undefined && !b.name.trim()) return fail(400, "validation_error");
    if (b.mainNumber && !state.me.numbers.some((n) => n.e164 === b.mainNumber)) return fail(400, "number_not_in_business");
    state.business = { ...state.business, ...b, name: b.name?.trim() ?? state.business.name };
    return ok(businessResponse());
  }],
  ["GET", new RegExp(`^${B}/usage$`), () => {
    const caps = PLANS.business.caps;
    const u = state.me.usage;
    return ok({
      plan: "business",
      seats: state.seats,
      periodStart: u.periodStart,
      perLine: { outboundMinutes: caps.outboundMinutes, inboundMinutes: caps.inboundMinutes, messages: caps.messages, concurrentCalls: caps.concurrentCalls },
      pooled: {
        outboundMinutes: { used: u.outboundMinutes, cap: caps.outboundMinutes * state.seats },
        inboundMinutes: { used: u.inboundMinutes, cap: caps.inboundMinutes * state.seats },
        messages: { used: u.messages, cap: caps.messages * state.seats },
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
    if (b.mode !== "off" && state.me.account.plan !== "business_pro") return fail(403, "plan_required", "recording needs Affaires Pro");
    state.business = { ...state.business, recordingPolicy: { ...state.business.recordingPolicy, ...b } };
    return ok(businessResponse());
  }],

  ["GET", new RegExp(`^${B}/members$`), () => ok({ members: state.members })],
  ["POST", new RegExp(`^${B}/members$`), ({ body }) => {
    const b = body as { email: string; role: "admin" | "member" };
    if (state.members.some((m) => m.email === b.email)) return fail(409, "member_exists");
    const m: BusinessMember = { id: nextId("mem"), businessId: BIZ_ID, userId: null, email: b.email, role: b.role, status: "invited", createdAt: new Date().toISOString() };
    state.members.push(m);
    return created(m);
  }],
  ["PATCH", new RegExp(`^${B}/members/([^/]+)$`), ({ params, body }) => {
    const m = state.members.find((x) => x.id === params[1]);
    if (!m) return fail(404, "not_found");
    if (m.role === "owner") return fail(403, "owner_immutable");
    Object.assign(m, { role: (body as { role: "admin" | "member" }).role });
    return ok(m);
  }],
  ["DELETE", new RegExp(`^${B}/members/([^/]+)$`), ({ params }) => {
    if (state.members.find((x) => x.id === params[1])?.role === "owner") return fail(403, "owner_immutable");
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
    if (b.target.type === "external" && (isEmergencyNumber(b.target.number) || !NANP_E164.test(b.target.number))) return fail(400, "validation_error");
    if (b.target.type === "ivr" && !state.menus.some((m) => m.id === (b.target as { ivrMenuId: string }).ivrMenuId)) return fail(400, "invalid_target");
    const r = state.dids.find((x) => x.e164 === b.e164);
    if (r) {
      r.target = b.target;
      return ok(r);
    }
    // Like the API: any number the account holds can be routed (upsert).
    const n = state.me.numbers.find((x) => x.e164 === b.e164);
    if (!n) return fail(400, "number_not_in_business");
    const route: DidRoute = { id: nextId("did"), businessId: BIZ_ID, phoneNumberId: n.id, e164: n.e164, target: b.target, createdAt: new Date().toISOString() };
    state.dids.push(route);
    return ok(route);
  }],
  // Signed links last 15 minutes (apps/api RECORDING_URL_TTL_S): each listing hands out fresh ones.
  ["GET", new RegExp(`^${B}/recordings$`), () =>
    ok({ recordings: state.recordings.map((r) => ({ ...r, audioUrlExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString() })) })],
  ["GET", new RegExp(`^${B}/ai-receptionist$`), () =>
    state.aiConfigured ? ok(state.receptionist) : fail(503, "not_configured", "AI is not configured on this server")],
  ["PUT", new RegExp(`^${B}/ai-receptionist$`), ({ body }) => {
    if (!state.aiConfigured) return fail(503, "not_configured", "AI is not configured on this server");
    const { accept, ...rest } = body as AiReceptionistConfigRequest;
    if (rest.languages && !rest.languages.includes("fr-CA")) return fail(400, "invalid_request", "fr-CA is required");
    for (const t of rest.transferTargets ?? []) {
      if (!t.number && !t.extension) return fail(400, "invalid_target");
      if (t.number && (!NANP_E164.test(t.number) || isEmergencyNumber(t.number))) return fail(400, "external_number_not_allowed");
    }
    const now = new Date().toISOString();
    const accepted = accept ? { acceptedAt: now, acceptedVersion: AI_RECEPTIONIST_TERMS_VERSION } : {};
    const next: AiReceptionistConfigDto = { ...state.receptionist, ...rest, ...accepted, updatedAt: now };
    // The demo user is the owner; the API also refuses accept: true from an admin (403 business_role_required).
    if (next.enabled && next.acceptedVersion !== AI_RECEPTIONIST_TERMS_VERSION) return fail(409, "terms_not_accepted");
    state.receptionist = next;
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
    const order = findOrder(params[0]);
    return order ? ok(orderDetail(order)) : fail(404, "order_not_found");
  }],
  // Draft only: nothing reaches the (sandbox) wholesaler before /submit.
  ["POST", /^\/v1\/catalog\/orders$/, ({ body }) => {
    const b = body as CreateOrderRequest;
    const o = state.offers.find((x) => x.id === b.offerId && x.status === "active");
    if (!o) return fail(404, "offer_not_found");
    if (needsAddress(o.productLine) && !b.serviceAddress) return fail(400, "service_address_required");
    if (b.serviceAddress && !filterOffersForPostalCode([o], b.serviceAddress.postalCode).length) return fail(422, "offer_not_available");
    if (o.productLine === "mobile" && !b.simKind) return fail(400, "sim_kind_required");
    if (b.simKind === "esim" && o.attributes.esim === false) return fail(400, "esim_not_supported");
    const now = new Date().toISOString();
    const order: ServiceOrder = {
      id: nextId("ord"),
      telecomAccountId: state.me.account.id,
      userId: USER_ID,
      offerId: o.id,
      offerCode: o.code,
      productLine: o.productLine,
      provider: o.provider,
      state: "draft",
      serviceAddress: needsAddress(o.productLine) ? (b.serviceAddress ?? null) : null,
      monthlyPriceCents: o.monthlyPriceCents,
      setupFeeCents: o.setupFeeCents,
      termMonths: o.termMonths,
      discountCents: o.discountCents,
      simKind: o.productLine === "mobile" ? (b.simKind ?? null) : null,
      contractSummaryVersion: null,
      contractAcceptedAt: null,
      providerOrderId: null,
      failureReason: null,
      submittedAt: null,
      activatedAt: null,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
    };
    state.orders.push(order);
    addOrderEvent(order, "note", null, "draft", "customer", now);
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
  ["GET", /^\/v1\/catalog\/orders\/([^/]+)\/contract-summary$/, ({ params }) => {
    const order = findOrder(params[0]);
    return order ? ok(orderSummary(order)) : fail(404, "order_not_found");
  }],
  ["POST", /^\/v1\/catalog\/orders\/([^/]+)\/submit$/, ({ params, body }) => {
    const order = findOrder(params[0]);
    if (!order) return fail(404, "order_not_found");
    if (order.state !== "draft") return fail(409, "invalid_transition");
    const b = (body ?? {}) as Partial<SubmitOrderRequest>;
    const summary = orderSummary(order);
    if (b.acceptContractSummary !== true || !b.contractSummaryVersion) return fail(400, "contract_summary_required");
    if (b.contractSummaryVersion !== summary.version) return fail(409, "contract_summary_outdated");
    if (consumerCodeFor(order.productLine) !== "none" && b.acceptConsumerCode !== true) return fail(400, "consumer_code_required");
    if (order.termMonths > 0 && b.creditCheckConsent !== true) return fail(400, "credit_check_consent_required");
    const now = new Date().toISOString();
    Object.assign(order, { contractSummaryVersion: summary.version, contractAcceptedAt: now, submittedAt: now, updatedAt: now });
    move(order, "submit", "submitted", "customer");
    // Month to month goes to the wholesaler at once; a term contract waits for a credit check.
    if (order.termMonths > 0) move(order, "credit_check_started", "credit_check", "system");
    else toProvider(order);
    return ok(order);
  }],
  // Demo: the sandbox wholesaler approves credit, and activates a line once its SIM/eSIM or install is done.
  ["POST", /^\/v1\/catalog\/orders\/([^/]+)\/sync$/, ({ params }) => {
    const order = findOrder(params[0]);
    if (!order) return fail(404, "order_not_found");
    if (order.state === "credit_check") toProvider(order, "credit_approved");
    else if (order.state === "pending_provider" && order.productLine === "mobile" && state.devices.some((d) => d.orderId === order.id && d.status !== "inactive")) activate(order);
    else if (order.state === "scheduled") activate(order);
    return ok(order);
  }],
  ["GET", /^\/v1\/catalog\/orders\/([^/]+)\/cancellation-quote$/, ({ params }) => {
    const order = findOrder(params[0]);
    return order ? ok(quote(order)) : fail(404, "order_not_found");
  }],
  ["POST", /^\/v1\/catalog\/orders\/([^/]+)\/cancel$/, ({ params }) => {
    const order = findOrder(params[0]);
    if (!order) return fail(404, "order_not_found");
    if (!CANCELLABLE.includes(order.state)) return fail(409, "order_not_cancellable");
    const cancellation = quote(order);
    move(order, "cancel_requested", "cancel_requested", "customer");
    // The sandbox wholesaler confirms at once.
    move(order, "cancel_confirmed", "cancelled", "provider");
    order.cancelledAt = new Date().toISOString();
    return ok({ order, cancellation });
  }],
  ["GET", /^\/v1\/catalog\/orders\/([^/]+)\/appointment-slots$/, ({ params }) => {
    const order = findOrder(params[0]);
    if (!order) return fail(404, "order_not_found");
    if (!needsAddress(order.productLine)) return fail(409, "appointment_not_needed");
    if (!order.providerOrderId || (order.state !== "pending_provider" && order.state !== "scheduled")) return fail(409, "order_not_ready");
    return ok({ slots: demoSlots() });
  }],
  ["POST", /^\/v1\/catalog\/orders\/([^/]+)\/appointment$/, ({ params, body }) => {
    const order = findOrder(params[0]);
    if (!order) return fail(404, "order_not_found");
    if (!needsAddress(order.productLine)) return fail(409, "appointment_not_needed");
    if (!order.providerOrderId || (order.state !== "pending_provider" && order.state !== "scheduled")) return fail(409, "order_not_ready");
    const b = body as { startsAt: string; endsAt: string };
    if (!demoSlots().some((x) => x.startsAt === b.startsAt && x.endsAt === b.endsAt)) return fail(422, "provider_slot_unavailable");
    const now = new Date().toISOString();
    for (const a of state.appointments) if (a.orderId === order.id && a.status === "booked") a.status = "cancelled";
    const appt: Appointment = { id: nextId("appt"), orderId: order.id, providerRef: nextId("sbx-appt"), startsAt: b.startsAt, endsAt: b.endsAt, status: "booked", notes: null, createdAt: now, updatedAt: now };
    state.appointments.push(appt);
    if (order.state === "pending_provider") move(order, "appointment_scheduled", "scheduled", "customer");
    return created(appt);
  }],
  ["POST", /^\/v1\/catalog\/orders\/([^/]+)\/sim$/, ({ params, body }) => {
    const order = findOrder(params[0]);
    if (!order) return fail(404, "order_not_found");
    const err = mobileAtProvider(order);
    if (err) return err;
    if (order.simKind !== "sim") return fail(409, "sim_kind_mismatch");
    const iccid = (body as { iccid?: string }).iccid ?? "";
    if (!/^\d{19,20}$/.test(iccid)) return fail(400, "invalid_request", "ICCID: 19 à 20 chiffres");
    for (const d of state.devices) if (d.orderId === order.id && d.kind === "sim") d.status = "inactive";
    const device = newDevice(order, "sim", iccid, null);
    return ok({ order, device });
  }],
  ["POST", /^\/v1\/catalog\/orders\/([^/]+)\/esim$/, ({ params, body }) => {
    const order = findOrder(params[0]);
    if (!order) return fail(404, "order_not_found");
    const existing = state.devices.find((d) => d.orderId === order.id && d.kind === "esim" && state.esimCodes[d.id]);
    if (existing) return ok(esimResponse(order, existing)); // idempotent, like the API
    const err = mobileAtProvider(order);
    if (err) return err;
    if (order.simKind !== "esim") return fail(409, "sim_kind_mismatch");
    const eid = (body as { eid?: string | null } | undefined)?.eid ?? null;
    if (eid && !/^\d{32}$/.test(eid)) return fail(400, "invalid_request", "EID: 32 chiffres");
    const device = newDevice(order, "esim", `8912230000${String(state.seq).padStart(10, "0")}`, eid);
    state.esimCodes[device.id] = `LPA:1$smdp.sandbox.mimt.local$DEMO-${device.id.toUpperCase()}`;
    return ok(esimResponse(order, device));
  }],
  ["GET", /^\/v1\/catalog\/orders\/([^/]+)\/esim$/, ({ params }) => {
    const order = findOrder(params[0]);
    if (!order) return fail(404, "order_not_found");
    const device = state.devices.find((d) => d.orderId === order.id && d.kind === "esim" && state.esimCodes[d.id]);
    return device ? ok(esimResponse(order, device)) : fail(404, "esim_not_found");
  }],
  ["POST", /^\/v1\/catalog\/orders\/([^/]+)\/porting$/, ({ params, body }) => {
    const order = findOrder(params[0]);
    if (!order) return fail(404, "order_not_found");
    if (order.productLine !== "mobile") return fail(409, "not_mobile");
    if (!["submitted", "credit_check", "pending_provider"].includes(order.state)) return fail(409, "order_not_ready");
    const b = body as PortInRequest;
    const d = (b.phoneNumber ?? "").replace(/\D/g, "");
    const phone = d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith("1") ? `+${d}` : "";
    if (!NANP_E164.test(phone) || isEmergencyNumber(phone)) return fail(400, "invalid_phone_number");
    if (!b.pin && !b.imei) return fail(400, "invalid_request", "NIP de transfert ou IMEI requis");
    const existing = state.porting.find((x) => x.orderId === order.id);
    if (existing && existing.status !== "rejected" && existing.status !== "cancelled") return fail(409, "porting_exists");
    const now = new Date().toISOString();
    // The account number, PIN and IMEI are not kept, even in demo mode.
    const p: PortingRequest = {
      id: existing?.id ?? nextId("port"),
      orderId: order.id,
      telecomAccountId: order.telecomAccountId,
      phoneE164: phone,
      losingCarrier: b.losingCarrier,
      authorizedName: b.authorizedName,
      status: order.providerOrderId ? "submitted" : "pending",
      providerRef: order.providerOrderId ? nextId("sbx-port") : null,
      rejectReason: null,
      dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      completedAt: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    state.porting = [...state.porting.filter((x) => x.orderId !== order.id), p];
    return created(p);
  }],
  ["GET", /^\/v1\/catalog\/orders\/([^/]+)\/porting$/, ({ params }) => {
    const p = state.porting.find((x) => x.orderId === params[0]);
    return p ? ok(p) : fail(404, "porting_not_found");
  }],
];

// Réunions MIMT (mock.meetings.ts).
routes.push(
  ...meetingMockRoutes({
    ok,
    created,
    fail,
    nextId,
    userId: USER_ID,
    displayName: () => state.me.user.displayName ?? "MIMT",
    businessId: BIZ_ID,
  }),
);

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
  // apps/api answers 404 to non-members (no existence leak).
  if (params[0] && url.pathname.startsWith("/v1/business/") && (params[0] !== BIZ_ID || !state.hasBusiness)) return fail(404, "not_found");
  return handler({ params, query: url.searchParams, body, method });
}
