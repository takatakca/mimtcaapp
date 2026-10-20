// ads.txt for Google AdSense (https://mimt.ca/ads.txt). AdSense reads ads.txt from the ROOT domain only:
// ads shown on app.mimt.ca (the web app) are authorised by https://mimt.ca/ads.txt, no file on the subdomain.
// The publisher id is public (it is in every ad tag). MIMT's own account is the default; an env value overrides it.

/** Google's certification authority id for AdSense, fixed by Google. */
export const GOOGLE_TAG_ID = "f08c47fec0942fa0";

/** MIMT's AdSense publisher (account approved for mimt.ca by the owner). Override: NEXT_PUBLIC_ADSENSE_PUBLISHER_ID. */
export const DEFAULT_ADSENSE_CLIENT = "ca-pub-4518068873401341";

/** "pub-0123456789012345" from "pub-…" or "ca-pub-…"; null when unset or malformed. */
export function adsensePublisherId(raw: string | undefined): string | null {
  const v = (raw ?? "").trim().replace(/^ca-/, "");
  return /^pub-\d{16}$/.test(v) ? v : null;
}

/** The ad tag client id ("ca-pub-…"): the env value when set, MIMT's own account otherwise; null when malformed. */
export function adsenseClient(raw: string | undefined): string | null {
  const id = adsensePublisherId((raw ?? "").trim() || DEFAULT_ADSENSE_CLIENT);
  return id ? `ca-${id}` : null;
}

/** The ads.txt body (env publisher, else MIMT's), or null when the env value is malformed. */
export function adsTxt(raw: string | undefined): string | null {
  const id = adsensePublisherId((raw ?? "").trim() || DEFAULT_ADSENSE_CLIENT);
  return id ? `google.com, ${id}, DIRECT, ${GOOGLE_TAG_ID}\n` : null;
}
