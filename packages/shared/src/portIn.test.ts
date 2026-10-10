import { describe, expect, it } from "vitest";
import { aggregatePortInStatus, generateLoaText, loaCanonicalText, PORT_IN_LOA_VERSION, signatureMatches } from "./portIn.js";

const input = {
  customerName: "Café Lumière inc.",
  customerType: "business" as const,
  authorizedName: "Camille Tremblay",
  currentCarrier: "Bell",
  numbers: ["+15145550123", "+15145550124"],
  serviceAddress: { street: "1234, rue Sainte-Catherine Ouest", unit: "200", city: "Montréal", province: "QC", postalCode: "H3B 1A1" },
};

describe("port-in LOA", () => {
  it("is bilingual, French first, and names the numbers, carrier and signer", () => {
    const loa = generateLoaText(input);
    expect(loa.version).toBe(PORT_IN_LOA_VERSION);
    const fr = loa.fr.paragraphs.join(" ");
    const en = loa.en.paragraphs.join(" ");
    for (const text of [fr, en]) {
      expect(text).toContain("+15145550123, +15145550124");
      expect(text).toContain("Bell");
      expect(text).toContain("Camille Tremblay");
      expect(text).toContain("200-1234, rue Sainte-Catherine Ouest, Montréal (QC) H3B 1A1");
      expect(text).toMatch(/9-1-1/);
    }
    expect(loa.fr.title).toMatch(/Lettre d'autorisation/);
    const canonical = loaCanonicalText(loa);
    expect(canonical.indexOf(loa.fr.title)).toBeLessThan(canonical.indexOf(loa.en.title));
  });

  it("matches the typed signature ignoring case and spaces only", () => {
    expect(signatureMatches("  camille   TREMBLAY ", "Camille Tremblay")).toBe(true);
    expect(signatureMatches("Camille", "Camille Tremblay")).toBe(false);
    expect(signatureMatches("", "")).toBe(false);
  });
});

describe("aggregatePortInStatus", () => {
  const of = (...s: Parameters<typeof aggregatePortInStatus>[0][number]["status"][]) => s.map((status) => ({ status }));
  it("derives the request status from its numbers", () => {
    expect(aggregatePortInStatus(of("submitted", "foc_scheduled"))).toBe("submitted");
    expect(aggregatePortInStatus(of("foc_scheduled", "foc_scheduled"))).toBe("foc_scheduled");
    expect(aggregatePortInStatus(of("foc_scheduled", "action_required"))).toBe("action_required");
    expect(aggregatePortInStatus(of("completed", "completed"))).toBe("completed");
    expect(aggregatePortInStatus(of("completed", "rejected"))).toBe("completed");
    expect(aggregatePortInStatus(of("rejected", "canceled"))).toBe("rejected");
    expect(aggregatePortInStatus(of("canceled"))).toBe("canceled");
    expect(aggregatePortInStatus(of("completed", "foc_scheduled"))).toBe("foc_scheduled");
  });
});
