// ads.txt for Google AdSense (https://mimt.ca/ads.txt). AdSense reads ads.txt from the ROOT domain only:
// ads shown on app.mimt.ca (the web app) are authorised by https://mimt.ca/ads.txt, no file on the subdomain.
// The publisher id is public (it is in every ad tag) but it is never invented: no id, no file.

/** Google's certification authority id for AdSense, fixed by Google. */
export const GOOGLE_TAG_ID = "f08c47fec0942fa0";

/** "pub-0123456789012345" from "pub-…" or "ca-pub-…"; null when unset or malformed. */
export function adsensePublisherId(raw: string | undefined): string | null {
  const v = (raw ?? "").trim().replace(/^ca-/, "");
  return /^pub-\d{16}$/.test(v) ? v : null;
}

/** The ads.txt body, or null (skip the file) when no valid publisher id is configured. */
export function adsTxt(raw: string | undefined): string | null {
  const id = adsensePublisherId(raw);
  return id ? `google.com, ${id}, DIRECT, ${GOOGLE_TAG_ID}\n` : null;
}
