// « MIMT Connect » consent (docs/MIMT-CONNECT.md « Consentement »): what a partner may see or do on a linked MIMT
// person's account, as named scopes. Each scope is granted separately by the person on /lier (unchecked by default),
// recorded with a receipt, revocable one by one, and enforced on every partner route and webhook. The partner side is
// as strong: it must accept the MIMT Connect partner terms and DPA (docs/legal/conditions-partenaire-mimt-connect.md)
// and declare a purpose per scope before it can ask for any of them.
//
// Versions: change PARTNER_CONSENT_TEXT_VERSION whenever a text below (or the /lier wording it covers) changes, and
// PARTNER_SCOPE_SET_VERSION whenever a scope is added or its meaning changes. Existing grants never grow on their
// own: the partner must send a new link request (an upgrade) and the person approves it on /lier again.

/** Every scope a partner can ask for. Order = display order on /lier and in Compte › Intégrations. */
export const PARTNER_SCOPES = [
  "calls.read",
  "calls.place",
  "line.manage",
  "subscription.read",
  "porting.read",
  "availability.manage",
  "recordings.read",
] as const;
export type PartnerScope = (typeof PARTNER_SCOPES)[number];

export const isPartnerScope = (v: unknown): v is PartnerScope => typeof v === "string" && (PARTNER_SCOPES as readonly string[]).includes(v);

/** Version of the consent wording (scope texts + PARTNER_CONSENT_COMMON). Recorded on every receipt. */
export const PARTNER_CONSENT_TEXT_VERSION = "2026-10-31";
/** Version of the set of scopes and their meaning. Recorded on every receipt. */
export const PARTNER_SCOPE_SET_VERSION = 1;
/** Version of the MIMT Connect partner terms and DPA a partner must accept before asking for any scope. */
export const PARTNER_TERMS_VERSION = "2026-10-31";

/**
 * Links approved before scopes existed (lots A and B, before 2026-10-31) were migrated to what their consent screen
 * actually said for lot A. The three lot B scopes were NOT granted: the person must approve them (owner: « always ask »).
 */
export const PARTNER_LEGACY_CONSENT_VERSION = "lot-a-2026-10-30";
export const PARTNER_LEGACY_SCOPES: readonly PartnerScope[] = ["calls.read", "calls.place", "line.manage"];

/** Longest purpose a partner can state for one scope. */
export const PARTNER_PURPOSE_MAX = 300;
/** Partner API accesses kept in the « Journal d'accès » (then deleted by the daily job). */
export const PARTNER_ACCESS_LOG_RETENTION_DAYS = 90;
/** Entries shown to the person. */
export const PARTNER_ACCESS_LOG_LIMIT = 50;

export interface PartnerScopeText {
  /** Short name of the checkbox. */
  label: string;
  /** What the partner sees or does with it, in plain words. */
  sees: string;
  /** What it never sees or does, even with it. */
  never: string;
}

/** Plain-language text of each scope, French first. Covered by PARTNER_CONSENT_TEXT_VERSION. */
export const PARTNER_SCOPE_TEXT: Record<PartnerScope, { fr: PartnerScopeText; en: PartnerScopeText }> = {
  "calls.read": {
    fr: {
      label: "Voir les appels liés à ce partenaire",
      sees: "Les appels de ses groupes d'appel que vous répondez et les appels lancés en votre nom : numéros, heures, durées et crédits.",
      never: "Vos autres appels, vos textos, vos messages vocaux personnels et vos contacts.",
    },
    en: {
      label: "See the calls tied to this partner",
      sees: "Calls from its hunt groups that you answer and calls placed on your behalf: numbers, times, durations and credits.",
      never: "Your other calls, your texts, your personal voicemails and your contacts.",
    },
  },
  "calls.place": {
    fr: {
      label: "Appeler en votre nom",
      sees: "Lancer un appel depuis son portail : votre application MIMT (ou votre cellulaire) sonne d'abord, l'appel ne part que si vous répondez, et votre ligne choisie sert d'afficheur. Le partenaire paie ces minutes.",
      never: "Appeler sans que vous répondiez, composer le 9-1-1, un numéro surtaxé ou un numéro hors du Canada et des États-Unis, ni utiliser les minutes de votre forfait.",
    },
    en: {
      label: "Call on your behalf",
      sees: "Start a call from its portal: your MIMT app (or your cellphone) rings first, the call only goes out if you answer, and your chosen line is the caller ID. The partner pays for these minutes.",
      never: "Call without you answering, dial 9-1-1, a premium-rate number or a number outside Canada and the US, or use your plan's minutes.",
    },
  },
  "line.manage": {
    fr: {
      label: "Choisir votre ligne pour ce partenaire",
      sees: "La liste de vos numéros MIMT actifs, et le choix de celui qui sert de ligne pour ses appels.",
      never: "Acheter, transférer ou abandonner un numéro, ni voir vos numéros inactifs.",
    },
    en: {
      label: "Choose your line for this partner",
      sees: "The list of your active MIMT numbers, and choosing which one is the line for its calls.",
      never: "Buy, transfer or give up a number, or see your inactive numbers.",
    },
  },
  "subscription.read": {
    fr: {
      label: "Voir le statut de votre forfait",
      sees: "Le nom de votre forfait MIMT, son statut (actif, à l'essai, paiement en retard, terminé), la fin de la période et si votre compte peut appeler.",
      never: "Votre carte, les montants payés ni vos factures; il ne peut rien acheter ni changer en votre nom.",
    },
    en: {
      label: "See your plan status",
      sees: "The name of your MIMT plan, its status (active, trial, past due, ended), the end of the period and whether your account can call.",
      never: "Your card, amounts paid or invoices; it cannot buy or change anything on your behalf.",
    },
  },
  "porting.read": {
    fr: {
      label: "Suivre vos transferts de numéro",
      sees: "Le numéro transféré vers MIMT, le statut du transfert et la date prévue.",
      never: "Votre numéro de compte chez l'ancien fournisseur, votre NIP, votre signature, votre adresse ni votre nom.",
    },
    en: {
      label: "Follow your number transfers",
      sees: "The number being transferred to MIMT, the transfer status and the expected date.",
      never: "Your account number with the previous carrier, your PIN, your signature, your address or your name.",
    },
  },
  "availability.manage": {
    fr: {
      label: "Régler votre disponibilité pour ses appels d'équipe",
      sees: "Vous marquer disponible, occupé ou hors ligne pour ses groupes d'appel, avec un horaire; il voit aussi le choix que vous faites dans MIMT.",
      never: "Passer outre votre propre choix dans MIMT : le vôtre l'emporte toujours.",
    },
    en: {
      label: "Set your availability for its team calls",
      sees: "Mark you available, busy or offline for its hunt groups, with a schedule; it also sees the choice you make in MIMT.",
      never: "Override your own choice in MIMT: yours always wins.",
    },
  },
  "recordings.read": {
    fr: {
      label: "Écouter les enregistrements de ces appels",
      sees: "Les enregistrements des appels de ses groupes que vous répondez, seulement si l'entreprise partenaire enregistre ses appels (l'appelant en est avisé), par des liens valides 15 minutes.",
      never: "Les enregistrements de vos autres appels, vos messages vocaux, ni aucune transcription.",
    },
    en: {
      label: "Listen to the recordings of these calls",
      sees: "Recordings of the calls from its hunt groups that you answer, only if the partner business records its calls (the caller is told), through links valid 15 minutes.",
      never: "Recordings of your other calls, your voicemails, or any transcript.",
    },
  },
};

/** The rest of the consent wording on /lier, French first. Covered by PARTNER_CONSENT_TEXT_VERSION. */
export const PARTNER_CONSENT_COMMON = {
  fr: {
    linkEffect:
      "Relier votre compte fait sonner vos applications MIMT pour les appels de ses groupes d'appel quand vous êtes disponible. Chaque autre accès ci-dessous est un choix séparé : rien n'est coché d'avance.",
    revoke:
      "Vous pouvez retirer un accès ou tout le lien en tout temps dans Compte › Intégrations › Partenaires; le retrait prend effet immédiatement. Un reçu de votre consentement y est gardé, avec le journal des accès du partenaire.",
    cannot: "Le partenaire ne voit jamais vos textos, vos messages vocaux personnels, vos autres appels ni votre identifiant MIMT, et ne peut rien acheter en votre nom.",
  },
  en: {
    linkEffect:
      "Linking your account makes your MIMT apps ring for calls from its hunt groups when you are available. Every other access below is a separate choice: nothing is checked in advance.",
    revoke:
      "You can remove one access or the whole link at any time in Account › Integrations › Partners; removal takes effect at once. A receipt of your consent is kept there, with the partner's access log.",
    cannot: "The partner never sees your texts, personal voicemails, other calls or MIMT user id, and cannot buy anything on your behalf.",
  },
} as const;

/**
 * Scopes a webhook needs when it concerns a linked person (an event about a member with no MIMT link is the partner's
 * own data). Without them the event is not queued, and a queued one is dropped at delivery if the scope was revoked.
 */
export const PARTNER_EVENT_SCOPES: Readonly<Record<string, PartnerScope>> = {
  "call.ringing": "calls.read",
  "call.answered": "calls.read",
  "call.completed": "calls.read",
  "recording.ready": "recordings.read",
  "member.number_changed": "line.manage",
  "member.subscription_changed": "subscription.read",
  "member.port_in_updated": "porting.read",
  "member.availability_changed": "availability.manage",
};

/** One scope in a link request: the partner's purpose for it, and whether its service cannot work without it. */
export interface PartnerScopeRequestItem {
  scope: PartnerScope;
  /** Why the partner needs it, in its own words (shown to the person on /lier). */
  purpose: string;
  /** The service needs it: approval is refused unless it is checked. */
  required?: boolean;
}

/** Body of POST /v1/partner/members/:externalId/link-requests. */
export interface PartnerLinkRequestBody {
  scopes: PartnerScopeRequestItem[];
}

/** GET /v1/partner/consent-text: the exact texts the portal must show before sending the person to /lier. */
export interface PartnerConsentTextResponse {
  consentVersion: string;
  scopeSetVersion: number;
  termsVersion: string;
  scopes: Array<{ scope: PartnerScope; fr: PartnerScopeText; en: PartnerScopeText }>;
  common: typeof PARTNER_CONSENT_COMMON;
}

// ------------------------------------------------------------------------------------- partner terms (DPA)

/** POST /v1/admin/partners/:id/terms-acceptance (MIMT admin, step-up, audited). */
export interface PartnerTermsAcceptanceRequest {
  /** Must be PARTNER_TERMS_VERSION. */
  termsVersion: string;
  /** When the partner signed (not in the future). */
  acceptedAt: string;
  signerName: string;
  signerTitle: string;
  /** The partner's legal name (REQ / registry), shown to the person on /lier. */
  legalName: string;
  /** Privacy officer or contact, shown to the person on /lier. */
  privacyContactEmail: string;
  /** Declared purpose per scope: the partner can only ask for these scopes. */
  purposes: Partial<Record<PartnerScope, string>>;
}

export interface PartnerTermsAcceptanceDto extends PartnerTermsAcceptanceRequest {
  id: string;
  /** True when termsVersion is the current PARTNER_TERMS_VERSION. */
  current: boolean;
  recordedAt: string;
}

// ------------------------------------------------------------------------------------- receipts and access log

export type PartnerConsentAction = "granted" | "upgraded" | "scope_revoked" | "revoked" | "migrated";

/** A consent receipt: what was granted, under which texts, when, from which coarse device and network. */
export interface PartnerConsentReceiptDto {
  id: string;
  action: PartnerConsentAction;
  /** Who acted: the person, the partner (unlink) or MIMT (migration). */
  actor: "user" | "partner" | "system";
  /** Scopes granted after this step. */
  scopes: PartnerScope[];
  /** Scopes this step added or removed. */
  changed: PartnerScope[];
  requiredScopes: PartnerScope[];
  /** The partner's stated purpose for each granted scope, as shown on /lier. */
  purposes: Partial<Record<PartnerScope, string>>;
  consentVersion: string;
  scopeSetVersion: number;
  /** The partner terms version accepted when this consent was given. */
  termsVersion: string | null;
  /** Coarse device label (« Chrome · Windows »), never the full user agent. */
  device: string | null;
  /** Network class (a.b.c.0/24 or xxxx:xxxx:xxxx::/48), never the full IP address. */
  network: string | null;
  createdAt: string;
}

/** One partner API access to the person's data (never the request or response body). */
export interface PartnerAccessLogEntryDto {
  scope: PartnerScope;
  /** Method and route template, e.g. « GET /v1/partner/members/:externalId/subscription ». */
  route: string;
  /** denied: the partner tried without the scope (403 scope_not_granted). */
  outcome: "allowed" | "denied";
  at: string;
}

export interface PartnerAccessLogResponse {
  entries: PartnerAccessLogEntryDto[];
  retentionDays: number;
}
