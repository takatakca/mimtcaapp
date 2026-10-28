import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const sha256Hex = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** Constant-time comparison of two strings of any length (compares their SHA-256 digests). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

/** AES-256-GCM for message bodies at rest. Format: "v1." + base64url(iv | tag | ciphertext). */
export class MessageCipher {
  private readonly key: Buffer;
  private readonly fingerprintKey: Buffer;
  private readonly subjectKey: Buffer;

  constructor(keyBase64: string) {
    const key = Buffer.from(keyBase64, "base64");
    if (key.length !== 32) throw new Error("MESSAGE_ENCRYPTION_KEY must be base64 of exactly 32 bytes");
    this.key = key;
    this.fingerprintKey = createHmac("sha256", key).update("mimt:message-fingerprint:v1").digest();
    this.subjectKey = createHmac("sha256", key).update("mimt:subject-hash:v1").digest();
  }

  static generateKey(): string {
    return randomBytes(32).toString("base64");
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return "v1." + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url");
  }

  decrypt(payload: string): string {
    if (!payload.startsWith("v1.")) throw new Error("Unknown ciphertext version");
    const raw = Buffer.from(payload.slice(3), "base64url");
    const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  }

  /**
   * Keyed, one-way pseudonym of an identifier (phone number, TAKATAK id, device key) for anti-abuse records that
   * outlive the account (mission_rewards). Keyed so a stored value cannot be reversed by hashing every phone number.
   */
  subjectHash(kind: "phone" | "global" | "device" | "email", value: string): string {
    return createHmac("sha256", this.subjectKey).update(`${kind}:${value.trim()}`).digest("base64url");
  }

  /** Keyed hash of the normalized body, used to spot bulk-identical sends without decrypting. */
  fingerprint(body: string): string {
    const normalized = body.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
    return createHmac("sha256", this.fingerprintKey).update(normalized).digest("base64url");
  }
}

/** Signature header for outbound TAKATAK webhooks: `t=<unix>,v1=<hex hmac>` over `${t}.${body}`. */
export function signWebhook(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}
