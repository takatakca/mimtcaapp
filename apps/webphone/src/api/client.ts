// The app's API client: one HttpClient (http.ts) plus typed endpoints from the shared contract.
// With VITE_MOCK_API=1 requests go to the in-browser fixture API (mock.ts) instead of the network.
import type { CreateMediaUploadResponse, Locale } from "@mimt/shared";
import { ApiClientError, errorKeyFor } from "./errors";
import { env } from "../env";
import { businessEndpoints } from "./business";
import { catalogEndpoints } from "./catalog";
import { portInEndpoints } from "./portIn";
import { meetingEndpoints } from "./meetings";
import { pilotEndpoints } from "./pilot";
import { securityEndpoints } from "./security";
import { adminEndpoints } from "./admin";
import { calendarEndpoints } from "./calendar";
import { partnerLinkEndpoints } from "./partnerLinks";
import { coreEndpoints } from "./core";
import { createHttpClient, type FetchLike } from "./http";
import { createTokenStore } from "./tokens";

let locale: Locale = "fr-CA";
const signedOutListeners = new Set<() => void>();

export function setApiLocale(l: Locale): void {
  locale = l;
}

/** Called when the refresh token is rejected: the app must go back to sign-in. */
export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => signedOutListeners.delete(listener);
}

/**
 * fetch used for the API and for uploads/signed media links. In demo mode, the fixture API.
 * Signed links and upload URLs never get the bearer token (they carry their own short-lived token).
 */
export const fetchImpl: FetchLike = env.mock
  ? (input, init) => import("./mock").then((m) => m.mockFetch(input, init))
  : (input, init) => fetch(input, init);

export const http = createHttpClient({
  baseUrl: env.apiUrl,
  fetch: fetchImpl,
  store: createTokenStore(),
  appVersion: env.appVersion,
  getLocale: () => locale,
  onSignedOut: () => signedOutListeners.forEach((l) => l()),
});

const { request } = http;

export const api = {
  ...coreEndpoints(request),
  /** Revokes the refresh-token family server-side. */
  async logout(): Promise<void> {
    const rt = http.refreshToken();
    if (rt) await request<void>("POST", "/v1/auth/logout", { body: { refreshToken: rt }, auth: false }).catch(() => undefined);
    http.signOutLocally();
  },
  ...businessEndpoints(request),
  ...catalogEndpoints(request),
  ...portInEndpoints(request),
  ...meetingEndpoints(request),
  ...pilotEndpoints(request),
  ...securityEndpoints(request),
  ...calendarEndpoints(request),
  ...partnerLinkEndpoints(request),
  ...adminEndpoints(request),
};

export type Api = typeof api;

/** PUTs a file to the signed upload URL from api.createUpload (no bearer token: the URL carries its own). */
export async function uploadFile(upload: CreateMediaUploadResponse, file: Blob): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl(upload.uploadUrl, { method: upload.uploadMethod, headers: upload.uploadHeaders, body: file });
  } catch (e) {
    throw new ApiClientError(null, "network", "error.network", e instanceof Error ? e.message : "network error");
  }
  if (!res.ok) throw new ApiClientError(res.status, "upload_failed", errorKeyFor(res.status), `upload failed (${res.status})`);
}
