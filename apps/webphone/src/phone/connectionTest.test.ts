// « Tester ma connexion »: Twilio preflight report → labels shown in the audio settings, and the edge list.
import { describe, expect, it } from "vitest";
import { DEFAULT_TWILIO_EDGES, parseEdges } from "../env";
import { translate } from "../i18n/core";
import { needsNetworkTip, qualityFromTwilio, qualityLabelKey, summarizePreflight } from "./connectionTest";
import { MockEngine } from "./mockEngine";

describe("connection test mapping", () => {
  it("maps Twilio's five grades to four labels, with the MOS as a fallback", () => {
    expect(qualityFromTwilio("excellent")).toBe("excellent");
    expect(qualityFromTwilio("great")).toBe("excellent");
    expect(qualityFromTwilio("good")).toBe("good");
    expect(qualityFromTwilio("fair")).toBe("fair");
    expect(qualityFromTwilio("degraded")).toBe("poor");
    expect(qualityFromTwilio(undefined, 4.3)).toBe("excellent");
    expect(qualityFromTwilio(undefined, 3.8)).toBe("good");
    expect(qualityFromTwilio(undefined, 3.4)).toBe("fair");
    expect(qualityFromTwilio(undefined, 2.5)).toBe("poor");
    expect(qualityFromTwilio(undefined)).toBeNull();
    expect(qualityFromTwilio(undefined, 0)).toBeNull();
  });

  it("labels in French first, and in English", () => {
    expect(translate("fr", qualityLabelKey("excellent"))).toBe("Excellente");
    expect(translate("fr", qualityLabelKey("good"))).toBe("Bonne");
    expect(translate("fr", qualityLabelKey("fair"))).toBe("Moyenne");
    expect(translate("fr", qualityLabelKey("poor"))).toBe("Faible");
    expect(translate("fr", qualityLabelKey(null))).toBe("Indéterminée");
    expect(translate("en", qualityLabelKey("poor"))).toBe("Poor");
  });

  it("summarizes a report: rounded jitter/RTT, loss in %, TURN and the edge that answered", () => {
    const r = summarizePreflight({
      callQuality: "great",
      isTurnRequired: true,
      edge: "ashburn",
      selectedEdge: "ashburn",
      stats: { jitter: { average: 3.6 }, rtt: { average: 41.4 }, mos: { average: 4.15 } },
      totals: { packetsLostFraction: 0.04 },
    });
    expect(r).toEqual({ quality: "excellent", jitterMs: 4, packetLossPct: 0, rttMs: 41, turnRequired: true, edge: "ashburn" });
    expect(needsNetworkTip(r)).toBe(false);
  });

  it("keeps unknown values empty instead of inventing them", () => {
    expect(summarizePreflight({})).toEqual({ quality: null, jitterMs: null, packetLossPct: null, rttMs: null, turnRequired: null, edge: null });
  });

  it("shows the Wi-Fi tip for an average or weak grade, or past Twilio's thresholds", () => {
    const ok = { quality: "good" as const, jitterMs: 5, packetLossPct: 0, rttMs: 60, turnRequired: false, edge: null };
    expect(needsNetworkTip(ok)).toBe(false);
    expect(needsNetworkTip({ ...ok, quality: "fair" })).toBe(true);
    expect(needsNetworkTip({ ...ok, quality: "poor" })).toBe(true);
    expect(needsNetworkTip({ ...ok, jitterMs: 45 })).toBe(true);
    expect(needsNetworkTip({ ...ok, packetLossPct: 5 })).toBe(true);
    expect(needsNetworkTip({ ...ok, rttMs: 450 })).toBe(true);
    expect(translate("fr", "phone.test.tip")).toBe("Rapprochez-vous du routeur Wi-Fi ou passez au réseau cellulaire.");
  });

  it("the demo engine answers without the Twilio SDK", async () => {
    const r = await new MockEngine().runConnectionTest();
    expect(r.quality).toBe("good");
  });
});

describe("Twilio edges (VITE_TWILIO_EDGE)", () => {
  it("defaults to Ashburn then Umatilla, and accepts a comma list", () => {
    expect(DEFAULT_TWILIO_EDGES).toEqual(["ashburn", "umatilla"]);
    expect(parseEdges(undefined)).toEqual(["ashburn", "umatilla"]);
    expect(parseEdges(" ")).toEqual(["ashburn", "umatilla"]);
    expect(parseEdges("Umatilla, ashburn,,ashburn")).toEqual(["umatilla", "ashburn"]);
    expect(parseEdges("roaming")).toEqual(["roaming"]);
  });
});
