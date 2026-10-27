// MIMT handles (@nom): talk to other MIMT users without a phone number. Handle-to-handle texts never touch the
// carrier (stored in MIMT's database only), so they cost nothing and are unlimited on every plan, Gratuit included.

/** "@" + 3 to 20 characters: lowercase letters, digits, dot and underscore, not starting or ending with . or _. */
export const MIMT_HANDLE = /^@[a-z0-9](?:[a-z0-9._]{1,18})[a-z0-9]$/;

/** Handles nobody can take (staff impersonation, emergency, brand). */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set(
  ["admin", "administrateur", "mimt", "mimtca", "takatak", "groupetakatak", "support", "soutien", "aide", "help", "info", "security", "securite", "police", "urgence", "emergency", "911", "9-1-1", "twilio", "stripe", "root", "system", "systeme", "noreply"].map((h) => `@${h}`),
);

/** "Camille.T", "@camille_t " → "@camille.t"; null when it cannot be a handle. */
export function normalizeHandle(raw: string | null | undefined): string | null {
  const v = `@${(raw ?? "").trim().replace(/^@+/, "").toLowerCase()}`;
  return MIMT_HANDLE.test(v) && !/[._]{2}/.test(v) ? v : null;
}

export function isHandle(peer: string): boolean {
  return MIMT_HANDLE.test(peer);
}

/** GET/PUT /v1/me/handle */
export interface HandleResponse {
  handle: string | null;
  /** PUT only: the « Choisissez votre @nom » mission was just rewarded (first handle of the account). */
  missionGranted?: import("./api.js").MissionGrantedDto;
}
export interface SetHandleRequest {
  handle: string;
}
/** GET /v1/handles/:handle (signed in): does this MIMT user exist? No other detail is revealed. */
export interface HandleLookupResponse {
  handle: string;
  exists: boolean;
}
