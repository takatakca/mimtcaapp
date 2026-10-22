import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transcribeVoicemail, transcriptLanguage, usesIntelligence } from "../src/services/voicemailTranscription.js";
import { makeUser, setup, type Ctx } from "./helpers.js";

let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup();
});
afterEach(() => ctx.app.close());

const log = { warn: vi.fn(), error: vi.fn() };
const noSleep = async () => {};

async function voicemail() {
  const u = await makeUser(ctx, { number: "+15145550100" });
  const number = (await ctx.repo.getNumberByE164("+15145550100"))!;
  await ctx.repo.createVoicemail({
    telecomAccountId: u.account.id, phoneNumberId: number.id, callSid: "CA1", recordingSid: "RE1",
    fromNumber: "+15145550199", audioUrl: null, durationS: 12,
  });
}

function transcriber(results: Array<{ status: "pending" | "completed" | "failed"; text: string | null }>) {
  return {
    start: vi.fn(async () => "GT1"),
    result: vi.fn(async () => results.shift() ?? { status: "pending" as const, text: null }),
    remove: vi.fn(async () => {}),
  };
}

describe("voicemail transcription in French", () => {
  it("stores the French transcript, then deletes the transcript and the Twilio recording", async () => {
    await voicemail();
    const t = transcriber([{ status: "pending", text: null }, { status: "completed", text: "Bonjour, rappelez-moi." }]);
    ctx.deps.twilio = Object.assign(ctx.deps.twilio!, { intelligence: t });
    const deleteRecording = vi.fn(async () => {});
    const out = await transcribeVoicemail(ctx.deps, { recordingSid: "RE1", language: "fr", deleteRecording }, log, noSleep);
    expect(out).toBe("completed");
    expect(t.start).toHaveBeenCalledWith({ language: "fr", recordingSid: "RE1", customerKey: "RE1" });
    const vm = (await ctx.repo.updateVoicemailByRecordingSid("RE1", {}))!;
    expect(vm).toMatchObject({ transcript: "Bonjour, rappelez-moi.", transcriptLang: "fr" });
    expect(t.remove).toHaveBeenCalledWith("GT1");
    expect(deleteRecording).toHaveBeenCalledOnce();
  });

  it("still deletes the recording when transcription fails", async () => {
    await voicemail();
    const t = transcriber([{ status: "failed", text: null }]);
    ctx.deps.twilio = Object.assign(ctx.deps.twilio!, { intelligence: t });
    const deleteRecording = vi.fn(async () => {});
    expect(await transcribeVoicemail(ctx.deps, { recordingSid: "RE1", language: "fr", deleteRecording }, log, noSleep)).toBe("failed");
    expect(deleteRecording).toHaveBeenCalledOnce();
    expect((await ctx.repo.updateVoicemailByRecordingSid("RE1", {}))?.transcript).toBeNull();
  });

  it("picks the language from the user's locale and needs a transcriber", () => {
    expect(transcriptLanguage("fr-CA")).toBe("fr");
    expect(transcriptLanguage("en-CA")).toBe("en");
    expect(transcriptLanguage(null)).toBe("fr");
    expect(usesIntelligence(ctx.deps)).toBe(false);
  });
});
