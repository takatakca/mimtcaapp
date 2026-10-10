/**
 * Content type from the file's first bytes. Uploads go straight to storage with a client-declared type,
 * so the API trusts only this before sending a file to Twilio or playing it to callers.
 */
export function sniffContentType(body: Buffer): string | null {
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "image/jpeg";
  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (body.length >= 6 && /^GIF8[79]a$/.test(body.subarray(0, 6).toString("latin1"))) return "image/gif";
  if (body.length >= 12 && body.subarray(0, 4).toString("latin1") === "RIFF" && body.subarray(8, 12).toString("latin1") === "WAVE") return "audio/wav";
  if (body.length >= 3 && body.subarray(0, 3).toString("latin1") === "ID3") return "audio/mpeg";
  // Bare MPEG audio frame (no ID3 tag): 11-bit frame sync, layer III.
  if (body.length >= 2 && body[0] === 0xff && (body[1]! & 0xe0) === 0xe0 && (body[1]! & 0x06) === 0x02) return "audio/mpeg";
  return null;
}

/** "audio/x-wav; codecs=1" → "audio/wav". */
export function normalizeContentType(ct: string | null | undefined): string {
  const base = (ct ?? "").split(";")[0]!.trim().toLowerCase();
  if (base === "audio/x-wav" || base === "audio/wave" || base === "audio/vnd.wave") return "audio/wav";
  if (base === "audio/mp3") return "audio/mpeg";
  if (base === "image/jpg") return "image/jpeg";
  return base;
}

/** Types the API serves inline; anything else (e.g. text/html in an inbound MMS) is served as a download. */
export function isInlineSafe(ct: string): boolean {
  const t = normalizeContentType(ct);
  if (t === "image/svg+xml") return false;
  return /^(image|audio|video)\/[a-z0-9.+-]+$/.test(t);
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "audio/amr": "amr",
  "text/vcard": "vcf",
  "text/x-vcard": "vcf",
};
export const extensionFor = (ct: string) => EXT[normalizeContentType(ct)] ?? "bin";
