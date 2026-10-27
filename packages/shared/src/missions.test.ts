import { describe, expect, it } from "vitest";
import { MISSION_MINUTES_CAP, MISSIONS, isMissionId, missionDef } from "./missions.js";

describe("Missions MIMT", () => {
  it("the table is the owner's: 7 missions, 150 bonus minutes at most per account", () => {
    expect(MISSIONS.map((m) => [m.id, m.minutes])).toEqual([
      ["verify_phone", 15],
      ["choose_handle", 30],
      ["enable_push", 15],
      ["install_app", 30],
      ["first_number", 60],
      ["invite_friend", 0],
      ["go_yearly", 0],
    ]);
    expect(MISSION_MINUTES_CAP).toBe(150);
  });

  it("the referral and yearly missions give their month, not minutes", () => {
    expect(missionDef("invite_friend").rewardKind).toBe("premium_month");
    expect(missionDef("go_yearly").rewardKind).toBe("free_month");
  });

  it("no mission rewards a review, a rating, a like, a follow or a social share", () => {
    const text = MISSIONS.map((m) => `${m.id} ${m.label.fr} ${m.label.en}`).join(" ").toLowerCase();
    for (const word of ["review", "avis", "rating", "note", "étoile", "star", "like", "aime", "follow", "abonnez-vous à", "partage", "share", "tirage", "draw", "concours", "contest"]) {
      expect(text, word).not.toContain(word);
    }
  });

  it("ids are validated", () => {
    expect(isMissionId("choose_handle")).toBe(true);
    expect(isMissionId("leave_review")).toBe(false);
  });
});
