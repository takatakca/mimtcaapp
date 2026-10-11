// Number port-in (transfert de numéro) of an existing landline or VoIP number INTO MIMT (Twilio).
// Not the mobile port to a SIM of the resale flow (catalogApi.ts, docs/MIMT-RESALE.md).
// Routes: /v1/port-ins (apps/api/src/routes/portIns.ts). Status webhook: /webhooks/twilio/porting.

/** Lifecycle of a port-in request. */
export const PORT_IN_STATUSES = [
  /** Created, waiting for the customer's e-signature on the letter of authorization (LOA). */
  "pending_signature",
  /** LOA signed; not sent to Twilio yet (porting disabled on this server, or the submission failed). */
  "signed",
  /** Sent to Twilio; waiting for the losing carrier. */
  "submitted",
  /** Twilio or the losing carrier needs something from the customer (bill, PIN, name, address). */
  "action_required",
  /** Firm order commitment (FOC): the carrier confirmed the port date. */
  "foc_scheduled",
  "completed",
  "rejected",
  "canceled",
] as const;
export type PortInStatus = (typeof PORT_IN_STATUSES)[number];

export const PORT_IN_NUMBER_STATUSES = ["pending", "submitted", "action_required", "foc_scheduled", "completed", "rejected", "canceled"] as const;
export type PortInNumberStatus = (typeof PORT_IN_NUMBER_STATUSES)[number];

/** Statuses in which a request can still be canceled by the customer. */
export const PORT_IN_CANCELABLE: readonly PortInStatus[] = ["pending_signature", "signed", "submitted", "action_required", "foc_scheduled"];
/** Number statuses that still hold the number (one open port per number). */
export const PORT_IN_OPEN_NUMBER_STATUSES: readonly PortInNumberStatus[] = ["pending", "submitted", "action_required", "foc_scheduled"];

export const PORT_IN_MAX_NUMBERS = 20;
/** Version of the LOA text below. Bump it when the wording changes; the signature stores it. */
export const PORT_IN_LOA_VERSION = "2026-10-loa-1";

export type PortInCustomerType = "individual" | "business";

export interface PortInAddress {
  street: string;
  unit: string | null;
  city: string;
  /** Two-letter province code (QC, ON, …). */
  province: string;
  /** "H2X 1Y4" */
  postalCode: string;
}

export interface PortInNumber {
  e164: string;
  status: PortInNumberStatus;
  /** Port date confirmed by the carrier (YYYY-MM-DD), once known. */
  focDate: string | null;
  rejectionReason: string | null;
  completedAt: string | null;
}

export interface PortInLoaSignature {
  version: string;
  /** Typed name, as signed. */
  signedName: string;
  signedAt: string;
  /** SHA-256 (hex) of the exact LOA text that was signed. */
  documentSha256: string;
}

/**
 * A port-in request as the API returns it. The losing carrier's account number and PIN are stored
 * encrypted and are never returned, even masked.
 */
export interface NumberPortIn {
  id: string;
  kind: "consumer" | "business";
  businessId: string | null;
  status: PortInStatus;
  numbers: PortInNumber[];
  currentCarrier: string;
  customerType: PortInCustomerType;
  /** Name on the current carrier's account (person or business). */
  customerName: string;
  /** Person authorized to sign for the account. */
  authorizedName: string;
  authorizedEmail: string;
  serviceAddress: PortInAddress;
  hasPin: boolean;
  /** MIMT number used meanwhile; kept active until the port completes (FOC date). */
  temporaryNumber: string | null;
  /** false: the temporary number goes back to the normal recycling cycle once the port completes. */
  keepTemporaryNumber: boolean;
  /** Requested date (YYYY-MM-DD); the carrier sets the real one (focDate). */
  desiredDate: string | null;
  /** Earliest confirmed port date among the numbers. */
  focDate: string | null;
  /** Port fee charged by MIMT, in cents (config PORT_IN_FEE_CENTS, 0 by default). */
  feeCents: number;
  loa: PortInLoaSignature | null;
  /** Short machine reason for action_required / rejected / signed-not-submitted. */
  statusReason: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  canceledAt: string | null;
}

/** POST /v1/port-ins */
export interface CreatePortInRequest {
  /** 1 to 20 Canadian numbers in E.164. */
  numbers: string[];
  currentCarrier: string;
  customerType: PortInCustomerType;
  customerName: string;
  authorizedName: string;
  authorizedEmail: string;
  /** Account number at the current carrier. Encrypted at rest, never returned. */
  accountNumber: string;
  /** Port-out PIN / passcode when the carrier uses one. Encrypted at rest, never returned. */
  pin?: string;
  serviceAddress: PortInAddress;
  /** MIMT Affaires: port the numbers into this business (admin or owner only). */
  businessId?: string;
  /** One of the account's active MIMT numbers to use meanwhile. */
  temporaryNumber?: string;
  keepTemporaryNumber?: boolean;
  desiredDate?: string;
}

/** POST /v1/port-ins/:id/sign — electronic signature of the LOA (typed name). */
export interface SignPortInRequest {
  /** Must match authorizedName (case and spacing ignored). */
  signedName: string;
  accept: true;
}

export interface PortInsResponse {
  portIns: NumberPortIn[];
}

/** GET /v1/port-ins/:id/loa?format=json — the LOA text, bilingual. ?format=html (default) returns a printable page. */
export interface PortInLoaResponse {
  version: string;
  documentSha256: string;
  fr: LoaText;
  en: LoaText;
  signature: PortInLoaSignature | null;
}

export interface LoaText {
  title: string;
  paragraphs: string[];
}

export interface LoaInput {
  customerName: string;
  customerType: PortInCustomerType;
  authorizedName: string;
  currentCarrier: string;
  numbers: string[];
  serviceAddress: PortInAddress;
}

const formatAddress = (a: PortInAddress) =>
  `${a.unit ? `${a.unit}-` : ""}${a.street}, ${a.city} (${a.province}) ${a.postalCode}`;

/**
 * The letter of authorization in both languages. Pure: the API hashes this exact text when the
 * customer signs, and the web app shows the same text before the signature.
 * [LAWYER] Wording to be reviewed before launch.
 */
export function generateLoaText(input: LoaInput): { version: string; fr: LoaText; en: LoaText } {
  const numbers = input.numbers.join(", ");
  const address = formatAddress(input.serviceAddress);
  return {
    version: PORT_IN_LOA_VERSION,
    fr: {
      title: "Lettre d'autorisation de transfert de numéro (LOA)",
      paragraphs: [
        `Titulaire du compte : ${input.customerName} (${input.customerType === "business" ? "entreprise" : "particulier"}).`,
        `Fournisseur actuel : ${input.currentCarrier}.`,
        `Numéros à transférer : ${numbers}.`,
        `Adresse de service : ${address}.`,
        `Je, ${input.authorizedName}, déclare être le titulaire du compte ou une personne autorisée à agir en son nom. J'autorise MIMT (GROUPE TAKATAK) et son fournisseur Twilio à demander à ${input.currentCarrier} le transfert des numéros ci-dessus.`,
        "Je comprends que le transfert peut mettre fin à mon service auprès du fournisseur actuel pour ces numéros, que les frais ou contrats de ce fournisseur restent ma responsabilité, et que la date de transfert est fixée par les fournisseurs.",
        "Je comprends que le service 9-1-1 de MIMT utilise l'adresse 9-1-1 enregistrée dans mon compte MIMT, que je dois tenir à jour.",
        "Signature électronique : nom saisi, date et heure, adresse IP et empreinte du présent document sont conservés.",
      ],
    },
    en: {
      title: "Letter of authorization for number transfer (LOA)",
      paragraphs: [
        `Account holder: ${input.customerName} (${input.customerType === "business" ? "business" : "individual"}).`,
        `Current provider: ${input.currentCarrier}.`,
        `Numbers to transfer: ${numbers}.`,
        `Service address: ${address}.`,
        `I, ${input.authorizedName}, declare that I am the account holder or a person authorized to act on its behalf. I authorize MIMT (GROUPE TAKATAK) and its provider Twilio to ask ${input.currentCarrier} to transfer the numbers above.`,
        "I understand that the transfer may end my service with the current provider for these numbers, that this provider's fees or contracts remain my responsibility, and that the transfer date is set by the providers.",
        "I understand that MIMT 9-1-1 service uses the 9-1-1 address registered in my MIMT account, which I must keep up to date.",
        "Electronic signature: typed name, date and time, IP address and fingerprint of this document are kept.",
      ],
    },
  };
}

/** Canonical text that is hashed for the signature (both languages, fixed order). */
export function loaCanonicalText(loa: { version: string; fr: LoaText; en: LoaText }): string {
  const part = (t: LoaText) => [t.title, ...t.paragraphs].join("\n");
  return [`version: ${loa.version}`, part(loa.fr), part(loa.en)].join("\n\n");
}

/** Typed-name signature check: case and spacing ignored (accents count). */
export function signatureMatches(typed: string, authorizedName: string): boolean {
  const norm = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr-CA");
  return norm(typed).length > 0 && norm(typed) === norm(authorizedName);
}

/**
 * Request status from its numbers, once submitted. Partial outcomes: completed wins when every
 * number is settled and at least one completed; otherwise the least advanced open state shows.
 */
export function aggregatePortInStatus(numbers: readonly Pick<PortInNumber, "status">[]): PortInStatus {
  const s = numbers.map((n) => n.status);
  if (s.length === 0) return "submitted";
  const open = s.filter((x) => (PORT_IN_OPEN_NUMBER_STATUSES as readonly string[]).includes(x));
  if (open.length === 0) {
    if (s.includes("completed")) return "completed";
    if (s.includes("rejected")) return "rejected";
    return "canceled";
  }
  if (open.includes("action_required")) return "action_required";
  if (open.every((x) => x === "foc_scheduled")) return "foc_scheduled";
  return "submitted";
}
