import { describe, expect, it } from "vitest";
import { AFFILIATE_STORAGE_KEY, captureAffiliate, checkoutAffiliate, markAffiliateSent, readPendingAffiliate } from "./affiliate";

function memory() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}
const DAY = 86_400_000;

describe("affiliate link capture", () => {
  it("keeps the first code with the click time (first touch) and normalizes it", () => {
    const s = memory();
    const t0 = new Date("2026-11-01T12:00:00Z");
    expect(captureAffiliate("?aff=abcd-2345", s, t0)).toEqual({ code: "ABCD2345", touchedAt: t0.toISOString() });
    expect(captureAffiliate("?aff=ZZZZ9999", s, new Date(t0.getTime() + DAY))!.code).toBe("ABCD2345");
    expect(checkoutAffiliate(s, new Date(t0.getTime() + DAY))).toEqual({ code: "ABCD2345", touchedAt: t0.toISOString() });
  });

  it("expires after 60 days, then a new link counts", () => {
    const s = memory();
    const t0 = new Date("2026-11-01T12:00:00Z");
    captureAffiliate("?aff=ABCD2345", s, t0);
    const later = new Date(t0.getTime() + 61 * DAY);
    expect(readPendingAffiliate(s, later)).toBeNull();
    expect(s.data.has(AFFILIATE_STORAGE_KEY)).toBe(false);
    expect(captureAffiliate("?aff=ZZZZ9999", s, later)!.code).toBe("ZZZZ9999");
  });

  it("ignores bad codes, garbage storage and blocked storage", () => {
    const s = memory();
    expect(captureAffiliate("?aff=<script>", s)).toBeNull();
    expect(captureAffiliate("?other=1", s)).toBeNull();
    s.setItem(AFFILIATE_STORAGE_KEY, "{not json");
    expect(readPendingAffiliate(s)).toBeNull();
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => undefined };
    expect(() => captureAffiliate("?aff=ABCD2345", throwing)).not.toThrow();
    expect(checkoutAffiliate(null)).toBeUndefined();
  });

  it("remembers that the API has seen it", () => {
    const s = memory();
    const t0 = new Date();
    captureAffiliate("?aff=ABCD2345", s, t0);
    markAffiliateSent(s, t0);
    expect(readPendingAffiliate(s, t0)!.sentAt).toBe(t0.toISOString());
  });
});
