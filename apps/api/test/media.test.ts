import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanCode } from "@mimt/shared";
import { MemoryMediaStore } from "../src/gateways/media.js";
import type { MemoryRepository } from "../src/repo/memory.js";
import { isTwilioMediaUrl } from "../src/gateways/twilio.js";
import { isInlineSafe, normalizeContentType, sniffContentType } from "../src/lib/sniff.js";
import { deliverEmails, maskEmail, renderVoicemailEmail, ResendEmailSender, type EmailMessage } from "../src/services/email.js";
import { purgeExpiredMedia } from "../src/services/media.js";
import { BASE_URL, fakeTwilio, makeUser, setup, testConfig, twilioPost, type Ctx } from "./helpers.js";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 2)]);
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt "), Buffer.alloc(100, 3)]);
const TWILIO_MEDIA = `https://api.twilio.com/2010-04-01/Accounts/AC${"a".repeat(32)}/Messages/MM${"b".repeat(32)}/Media/ME${"c".repeat(32)}`;

let ctx: Ctx;
let store: MemoryMediaStore;
let repo: MemoryRepository;
const makeTwilio = () => ({
  ...fakeTwilio(),
  fetchMedia: vi.fn(async (_url: string) => ({ contentType: "image/png", body: PNG })),
  deleteMedia: vi.fn(async (_url: string) => {}),
  createCall: vi.fn(async (_input: { to: string; from: string; url: string }) => ({ sid: "CAgreet" })),
});
let tw: ReturnType<typeof makeTwilio>;

beforeEach(async () => {
  tw = makeTwilio();
  ctx = await setup({ twilio: tw });
  store = new MemoryMediaStore();
  ctx.deps.mediaFiles = store;
  repo = ctx.repo;
});

async function subscribe(accountId: string, plan: PlanCode) {
  await repo.upsertSubscription({
    telecomAccountId: accountId, kind: "plan", code: plan, quantity: 1, stripeSubscriptionId: `sub_${plan}`, status: "active", source: "stripe", currentPeriodEnd: null,
  });
}

async function paidUser(plan: PlanCode = "premium", opts: { email?: string | null } = {}) {
  const u = await makeUser(ctx, { number: "+15145550100" });
  await subscribe(u.account.id, plan);
  if (opts.email !== null) await repo.updateUser(u.user.id, { email: opts.email ?? "client@exemple.ca" });
  return u;
}

const upload = (auth: Record<string, string>, payload: object) => ctx.app.inject({ method: "POST", url: "/v1/media/uploads", headers: auth, payload });

/** Simulates the app's PUT to the signed URL. */
async function uploadFile(auth: Record<string, string>, purpose: "mms" | "greeting", contentType: string, body: Buffer) {
  const res = await upload(auth, { purpose, contentType, sizeBytes: body.length });
  expect(res.statusCode).toBe(201);
  const { mediaId } = res.json();
  const row = await repo.media.getMedia(mediaId);
  await store.put(row!.path!, body, contentType);
  return mediaId as string;
}

/** Fetches a signed /v1/media URL without any header. */
const getSigned = (url: string) => ctx.app.inject({ method: "GET", url: url.replace(BASE_URL, "") });

describe("POST /v1/media/uploads", () => {
  it("requires a session", async () => {
    expect((await upload({}, { purpose: "mms", contentType: "image/jpeg", sizeBytes: 10 })).statusCode).toBe(401);
  });

  it("gates sending MMS and greetings on the plan", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    expect((await upload(u.auth, { purpose: "mms", contentType: "image/jpeg", sizeBytes: 10 })).json().error).toBe("mms_not_in_plan");
    expect((await upload(u.auth, { purpose: "greeting", contentType: "audio/wav", sizeBytes: 10 })).json().error).toBe("vm_greeting_not_in_plan");
    await subscribe(u.account.id, "lock");
    // Number Lock is a paid plan: custom greeting yes, MMS no.
    expect((await upload(u.auth, { purpose: "greeting", contentType: "audio/wav", sizeBytes: 10 })).statusCode).toBe(201);
    expect((await upload(u.auth, { purpose: "mms", contentType: "image/jpeg", sizeBytes: 10 })).statusCode).toBe(403);
  });

  it("returns a signed upload URL for a premium user", async () => {
    const u = await paidUser();
    const res = await upload(u.auth, { purpose: "mms", contentType: "image/jpeg", sizeBytes: 1234 });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ uploadMethod: "PUT", maxBytes: 5 * 1024 * 1024, uploadHeaders: { "content-type": "image/jpeg" } });
    expect(body.uploadUrl).toMatch(new RegExp(`/upload/mms/${u.account.id}/${body.mediaId}\\.jpg\\?token=`));
    expect(Date.parse(body.uploadExpiresAt)).toBeGreaterThan(Date.now());
    expect(await repo.media.getMedia(body.mediaId)).toMatchObject({ status: "pending", kind: "mms_out", sizeBytes: 1234 });
  });

  it("enforces type and size limits", async () => {
    const u = await paidUser();
    expect((await upload(u.auth, { purpose: "mms", contentType: "image/svg+xml", sizeBytes: 10 })).json().error).toBe("unsupported_media_type");
    expect((await upload(u.auth, { purpose: "mms", contentType: "video/mp4", sizeBytes: 10 })).statusCode).toBe(400);
    const big = await upload(u.auth, { purpose: "mms", contentType: "image/png", sizeBytes: 5 * 1024 * 1024 + 1 });
    expect(big.statusCode).toBe(413);
    expect(big.json().error).toBe("media_too_large");
    expect((await upload(u.auth, { purpose: "greeting", contentType: "audio/mp4", sizeBytes: 10 })).statusCode).toBe(400);
    // Aliases are normalised.
    expect((await upload(u.auth, { purpose: "greeting", contentType: "audio/x-wav", sizeBytes: 10 })).statusCode).toBe(201);
  });

  it("answers 503 when storage is not configured", async () => {
    ctx.deps.mediaFiles = null;
    const u = await paidUser();
    expect((await upload(u.auth, { purpose: "mms", contentType: "image/jpeg", sizeBytes: 10 })).statusCode).toBe(503);
  });
});

describe("outbound MMS with uploaded media", () => {
  const send = (auth: Record<string, string>, payload: object) => ctx.app.inject({ method: "POST", url: "/v1/messages", headers: auth, payload });

  it("sends a photo through a signed API URL and shows it in the thread", async () => {
    const u = await paidUser();
    const mediaId = await uploadFile(u.auth, "mms", "image/jpeg", JPEG);
    const res = await send(u.auth, { from: "+15145550100", to: "+15145550199", body: "", mediaIds: [mediaId] });
    expect(res.statusCode).toBe(201);
    const msg = res.json();
    expect(msg.numMedia).toBe(1);
    expect(msg.media[0]).toMatchObject({ id: mediaId, contentType: "image/jpeg" });

    const sent = (tw.sendMessage.mock.calls[0] as unknown as [{ mediaUrls?: string[] }])[0];
    expect(sent.mediaUrls).toHaveLength(1);
    expect(sent.mediaUrls![0]).toMatch(new RegExp(`^${BASE_URL}/v1/media/${mediaId}\\?token=`));
    // Twilio (no headers) can fetch it; the bytes come from our bucket.
    const fetched = await getSigned(sent.mediaUrls![0]!);
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers["content-type"]).toBe("image/jpeg");
    expect(fetched.rawPayload.equals(JPEG)).toBe(true);

    const row = await repo.media.getMedia(mediaId);
    expect(row).toMatchObject({ status: "ready", messageId: msg.id });
    expect(row!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 179 * 86_400_000);

    const thread = await ctx.app.inject({ method: "GET", url: "/v1/conversations/%2B15145550199/messages", headers: u.auth });
    expect(thread.json().messages[0].media[0].url).toContain(`/v1/media/${mediaId}?token=`);
  });

  it("refuses media for free plans, reuse, files never uploaded and fake images", async () => {
    const u = await paidUser();
    const id1 = await uploadFile(u.auth, "mms", "image/jpeg", JPEG);
    expect((await send(u.auth, { from: "+15145550100", to: "+15145550199", body: "a", mediaIds: [id1] })).statusCode).toBe(201);
    expect((await send(u.auth, { from: "+15145550100", to: "+15145550199", body: "b", mediaIds: [id1] })).json().error).toBe("media_already_used");

    const pending = (await upload(u.auth, { purpose: "mms", contentType: "image/jpeg", sizeBytes: 10 })).json().mediaId;
    expect((await send(u.auth, { from: "+15145550100", to: "+15145550199", body: "c", mediaIds: [pending] })).json().error).toBe("media_not_uploaded");

    const fake = await uploadFile(u.auth, "mms", "image/jpeg", Buffer.from("<html><script>alert(1)</script></html>"));
    expect((await send(u.auth, { from: "+15145550100", to: "+15145550199", body: "d", mediaIds: [fake] })).json().error).toBe("invalid_media");
    expect(await repo.media.getMedia(fake)).toBeNull();

    const other = await makeUser(ctx, { number: "+15145550111" });
    await subscribe(other.account.id, "premium");
    expect((await send(other.auth, { from: "+15145550111", to: "+15145550199", body: "e", mediaIds: [pending] })).statusCode).toBe(404);

    await repo.upsertSubscription({
      telecomAccountId: u.account.id, kind: "plan", code: "premium", quantity: 1, stripeSubscriptionId: "sub_premium", status: "canceled", source: "stripe", currentPeriodEnd: null,
    });
    expect((await send(u.auth, { from: "+15145550100", to: "+15145550199", body: "f", mediaIds: [pending] })).json().error).toBe("mms_not_in_plan");
  });

  it("serves media to its owner with a bearer token, never to others", async () => {
    const u = await paidUser();
    const id = await uploadFile(u.auth, "mms", "image/jpeg", JPEG);
    await send(u.auth, { from: "+15145550100", to: "+15145550199", body: "x", mediaIds: [id] });
    expect((await ctx.app.inject({ method: "GET", url: `/v1/media/${id}`, headers: u.auth })).statusCode).toBe(200);
    const other = await makeUser(ctx);
    expect((await ctx.app.inject({ method: "GET", url: `/v1/media/${id}`, headers: other.auth })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: "GET", url: `/v1/media/${id}?token=forged` })).statusCode).toBe(403);
  });
});

describe("inbound MMS", () => {
  const inbound = (extra: Record<string, string>) =>
    twilioPost(ctx, "/webhooks/twilio/sms/inbound", { MessageSid: `SM${"1".repeat(32)}`, From: "+14165550123", To: "+15145550100", Body: "", ...extra });

  it("copies Twilio media into private storage, deletes it at Twilio, and free users see it", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" }); // free plan
    const res = await inbound({ NumMedia: "1", MediaUrl0: TWILIO_MEDIA, MediaContentType0: "image/png" });
    expect(res.statusCode).toBe(200);
    expect(tw.fetchMedia).toHaveBeenCalledWith(TWILIO_MEDIA);
    expect(tw.deleteMedia).toHaveBeenCalledWith(TWILIO_MEDIA);
    const [path] = [...store.objects.keys()];
    expect(path).toMatch(new RegExp(`^mms/${u.account.id}/[0-9a-f-]+\\.png$`));

    const thread = await ctx.app.inject({ method: "GET", url: "/v1/conversations/%2B14165550123/messages", headers: u.auth });
    const [msg] = thread.json().messages;
    expect(msg.numMedia).toBe(1);
    expect(msg.media[0].contentType).toBe("image/png");
    expect(msg.media[0].url).not.toContain("twilio.com");
    const img = await getSigned(msg.media[0].url);
    expect(img.statusCode).toBe(200);
    expect(img.rawPayload.equals(PNG)).toBe(true);
  });

  it("ignores media URLs that are not Twilio's (no credentialed fetch elsewhere)", async () => {
    await makeUser(ctx, { number: "+15145550100" });
    await inbound({ NumMedia: "1", MediaUrl0: "https://evil.example/steal", MediaContentType0: "image/png" });
    expect(tw.fetchMedia).not.toHaveBeenCalled();
    expect(repo.media.media.size).toBe(0);
  });

  it("keeps the Twilio URL and proxies it when storage is not configured", async () => {
    ctx.deps.mediaFiles = null;
    const u = await makeUser(ctx, { number: "+15145550100" });
    await inbound({ NumMedia: "1", MediaUrl0: TWILIO_MEDIA, MediaContentType0: "image/png" });
    const [row] = [...repo.media.media.values()];
    expect(row).toMatchObject({ kind: "mms_in", twilioUrl: TWILIO_MEDIA, path: null });
    expect(tw.deleteMedia).not.toHaveBeenCalled();
    const res = await ctx.app.inject({ method: "GET", url: `/v1/media/${row!.id}`, headers: u.auth });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(PNG)).toBe(true);
  });

  it("serves unsafe inbound types as downloads", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    tw.fetchMedia.mockResolvedValueOnce({ contentType: "text/html", body: Buffer.from("<script>") });
    await inbound({ NumMedia: "1", MediaUrl0: TWILIO_MEDIA, MediaContentType0: "text/html" });
    const [row] = [...repo.media.media.values()];
    const res = await ctx.app.inject({ method: "GET", url: `/v1/media/${row!.id}`, headers: u.auth });
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    expect(res.headers["content-disposition"]).toContain("attachment");
  });
});

describe("custom voicemail greeting", () => {
  const voicemailTwiml = async (numberId: string) => (await twilioPost(ctx, `/webhooks/twilio/voice/dial-result?n=${numberId}`, { DialCallStatus: "no-answer" })).body;

  it("plays the uploaded greeting with <Play>, falls back to the default after reset or downgrade", async () => {
    const u = await paidUser();
    const id = await uploadFile(u.auth, "greeting", "audio/wav", WAV);
    const put = await ctx.app.inject({ method: "PUT", url: "/v1/voicemail/greeting", headers: u.auth, payload: { mediaId: id } });
    expect(put.statusCode).toBe(200);
    expect(put.json().greeting).toMatchObject({ mediaId: id });

    const twiml = await voicemailTwiml(u.number!.id);
    const play = /<Play>([^<]+)<\/Play>/.exec(twiml)?.[1]?.replace(/&amp;/g, "&");
    expect(play).toMatch(new RegExp(`^${BASE_URL}/v1/media/${id}\\?token=`));
    expect(twiml).not.toContain("vous avez joint la messagerie vocale");
    expect(twiml).toMatch(/<Play>[^<]+<\/Play><Record/);
    const audio = await getSigned(play!);
    expect(audio.statusCode).toBe(200);
    expect(audio.headers["content-type"]).toBe("audio/wav");

    // Downgrade: the default greeting plays again (the file is kept until reset).
    await repo.upsertSubscription({
      telecomAccountId: u.account.id, kind: "plan", code: "premium", quantity: 1, stripeSubscriptionId: "sub_premium", status: "canceled", source: "stripe", currentPeriodEnd: null,
    });
    expect(await voicemailTwiml(u.number!.id)).toContain('<Say language="fr-CA">Bonjour, vous avez joint la messagerie vocale');
    await subscribe(u.account.id, "premium");
    expect(await voicemailTwiml(u.number!.id)).toContain("<Play>");

    const del = await ctx.app.inject({ method: "DELETE", url: "/v1/voicemail/greeting", headers: u.auth });
    expect(del.json().greeting).toBeNull();
    expect(store.objects.size).toBe(0);
    expect(await voicemailTwiml(u.number!.id)).not.toContain("<Play>");
  });

  it("keeps the default greeting when storage fails", async () => {
    const u = await paidUser();
    const id = await uploadFile(u.auth, "greeting", "audio/wav", WAV);
    await ctx.app.inject({ method: "PUT", url: "/v1/voicemail/greeting", headers: u.auth, payload: { mediaId: id } });
    vi.spyOn(repo.media, "getVoicemailSettings").mockRejectedValueOnce(new Error("db down"));
    const twiml = await voicemailTwiml(u.number!.id);
    expect(twiml).toContain("vous avez joint la messagerie vocale");
    expect(twiml).toContain("<Record");
  });

  it("rejects a greeting that is not real audio, and free plans", async () => {
    const u = await paidUser();
    const id = await uploadFile(u.auth, "greeting", "audio/mpeg", JPEG);
    expect((await ctx.app.inject({ method: "PUT", url: "/v1/voicemail/greeting", headers: u.auth, payload: { mediaId: id } })).json().error).toBe("invalid_media");
    const free = await makeUser(ctx);
    expect((await ctx.app.inject({ method: "PUT", url: "/v1/voicemail/greeting", headers: free.auth, payload: { mediaId: id } })).statusCode).toBe(403);
  });

  it("records a greeting by phone", async () => {
    const u = await paidUser();
    const res = await ctx.app.inject({ method: "POST", url: "/v1/voicemail/greeting/call", headers: u.auth });
    expect(res.statusCode).toBe(202);
    const call = tw.createCall.mock.calls[0]![0];
    expect(call).toMatchObject({ to: `client:${u.user.id}`, from: "+15145550100" });
    const path = call.url.replace(BASE_URL, "");

    const twiml = (await twilioPost(ctx, path, { CallSid: "CAgreet" })).body;
    expect(twiml).toContain('<Say language="fr-CA">Après le signal, enregistrez votre message d\'accueil');
    expect(twiml).toMatch(/<Record maxLength="60"/);
    const cb = /recordingStatusCallback="([^"]+)"/.exec(twiml)![1]!.replace(/&amp;/g, "&").replace(BASE_URL, "");

    await twilioPost(ctx, cb, { RecordingSid: "RE" + "d".repeat(32), RecordingStatus: "completed", RecordingUrl: "https://api.twilio.com/x" });
    const settings = await ctx.app.inject({ method: "GET", url: "/v1/voicemail/settings", headers: u.auth });
    expect(settings.json().greeting).not.toBeNull();
    expect([...store.objects.keys()][0]).toMatch(new RegExp(`^greetings/${u.account.id}/.+\\.mp3$`));
    expect(tw.deleteRecording).toHaveBeenCalled();
    expect(await voicemailTwiml(u.number!.id)).toContain("<Play>");
  });

  it("rejects forged greeting webhooks", async () => {
    const u = await paidUser();
    const res = await twilioPost(ctx, `/webhooks/twilio/voice/greeting/recording?a=${u.account.id}`, { RecordingSid: "RE1" }, "bad-signature");
    expect(res.statusCode).toBe(403);
  });
});

describe("voicemail to email", () => {
  const settings = (auth: Record<string, string>, payload: object) => ctx.app.inject({ method: "PATCH", url: "/v1/voicemail/settings", headers: auth, payload });
  const leaveVoicemail = async (numberId: string, sid: string) => {
    await twilioPost(ctx, "/webhooks/twilio/voice/inbound", { CallSid: `CA${sid}`, From: "+14165550123", To: "+15145550100" });
    await twilioPost(ctx, `/webhooks/twilio/voice/recording?n=${numberId}`, {
      CallSid: `CA${sid}`, RecordingSid: `RE${sid}`, RecordingUrl: `https://api.twilio.com/rec/RE${sid}`, RecordingDuration: "42", RecordingStatus: "completed",
    });
    return (await repo.listVoicemails((await repo.getNumber(numberId))!.telecomAccountId!))[0]!;
  };

  it("is a paid option that needs an email address", async () => {
    const free = await makeUser(ctx);
    expect((await settings(free.auth, { emailEnabled: true })).json().error).toBe("vm_email_not_in_plan");
    const noEmail = await paidUser("premium", { email: null });
    expect((await settings(noEmail.auth, { emailEnabled: true })).json().error).toBe("no_email");
  });

  it("queues an email only for opted-in paid users", async () => {
    const u = await paidUser();
    await leaveVoicemail(u.number!.id, "1");
    expect(repo.media.emails).toHaveLength(0); // not opted in

    const on = await settings(u.auth, { emailEnabled: true });
    expect(on.json()).toMatchObject({ emailEnabled: true, email: "client@exemple.ca", available: { email: true, greeting: true } });
    const vm = await leaveVoicemail(u.number!.id, "2");
    expect(repo.media.emails).toHaveLength(1);
    expect(repo.media.emails[0]).toMatchObject({ userId: u.user.id, template: "voicemail_received", payload: { voicemailId: vm.id } });

    // Downgraded but still opted in: nothing is queued.
    await repo.upsertSubscription({
      telecomAccountId: u.account.id, kind: "plan", code: "premium", quantity: 1, stripeSubscriptionId: "sub_premium", status: "canceled", source: "stripe", currentPeriodEnd: null,
    });
    await leaveVoicemail(u.number!.id, "3");
    expect(repo.media.emails).toHaveLength(1);
  });

  it("delivers the transcript and a signed, expiring audio link (French first)", async () => {
    const u = await paidUser();
    await settings(u.auth, { emailEnabled: true });
    const vm = await leaveVoicemail(u.number!.id, "4");
    await twilioPost(ctx, "/webhooks/twilio/voice/transcription", { RecordingSid: "RE4", TranscriptionStatus: "completed", TranscriptionText: "Rappelle-moi" });

    const sent: EmailMessage[] = [];
    ctx.deps.email = { send: async (m) => void sent.push(m) };
    // Not due yet (waits for the transcription).
    expect((await deliverEmails(ctx.deps, ctx.app.log)).sent).toBe(0);
    const later = new Date(Date.now() + 5 * 60_000);
    expect(await deliverEmails(ctx.deps, ctx.app.log, later)).toMatchObject({ sent: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail.to).toBe("client@exemple.ca");
    expect(mail.subject).toMatch(/^Nouveau message vocal/);
    expect(mail.text.indexOf("Nouveau message vocal")).toBeLessThan(mail.text.indexOf("New voicemail"));
    expect(mail.text).toContain("Rappelle-moi");
    const link = /(https:\/\/\S+\/v1\/voicemails\/\S+)/.exec(mail.text)![1]!;
    expect(link).toContain(`/v1/voicemails/${vm.id}/audio?token=`);
    expect(mail.text).not.toContain("twilio.com");
    const audio = await getSigned(link);
    expect(audio.statusCode).toBe(200);

    // Sent once.
    expect((await deliverEmails(ctx.deps, ctx.app.log, later)).sent).toBe(0);
  });

  it("retries failed sends and skips voicemails deleted meanwhile", async () => {
    const u = await paidUser();
    await settings(u.auth, { emailEnabled: true });
    const vm = await leaveVoicemail(u.number!.id, "5");
    ctx.deps.email = { send: async () => Promise.reject(new Error("provider down")) };
    const later = new Date(Date.now() + 5 * 60_000);
    expect((await deliverEmails(ctx.deps, ctx.app.log, later)).failed).toBe(1);
    expect(repo.media.emails[0]).toMatchObject({ attempts: 1, lastError: "provider down" });
    await repo.deleteVoicemail(vm.id);
    const evenLater = new Date(later.getTime() + 10 * 60_000);
    expect((await deliverEmails(ctx.deps, ctx.app.log, evenLater)).skipped).toBe(1);
  });

  it("renders without a transcript or audio", () => {
    const r = renderVoicemailEmail({ from: null, durationS: 5, transcript: null, audioUrl: null, expiresAt: null, receivedAt: new Date() });
    expect(r.text).toContain("Transcription non disponible.");
    expect(r.text).toContain("Numéro inconnu");
  });
});

describe("media retention", () => {
  it("deletes expired MMS media and unused uploads (file and row)", async () => {
    const u = await paidUser();
    const id = await uploadFile(u.auth, "mms", "image/jpeg", JPEG);
    expect(store.objects.size).toBe(1);
    expect(await purgeExpiredMedia(ctx.deps, ctx.app.log)).toBe(0);
    expect(await purgeExpiredMedia(ctx.deps, ctx.app.log, new Date(Date.now() + 25 * 3600_000))).toBe(1);
    expect(await repo.media.getMedia(id)).toBeNull();
    expect(store.objects.size).toBe(0);
  });
});

describe("media helpers", () => {
  it("sniffs magic bytes and normalises types", () => {
    expect(sniffContentType(JPEG)).toBe("image/jpeg");
    expect(sniffContentType(PNG)).toBe("image/png");
    expect(sniffContentType(Buffer.from("GIF89a....."))).toBe("image/gif");
    expect(sniffContentType(WAV)).toBe("audio/wav");
    expect(sniffContentType(Buffer.from("ID3\u0004\u0000"))).toBe("audio/mpeg");
    expect(sniffContentType(Buffer.from("<svg></svg>"))).toBeNull();
    expect(normalizeContentType("audio/x-wav; codecs=1")).toBe("audio/wav");
    expect(isInlineSafe("image/svg+xml")).toBe(false);
    expect(isInlineSafe("text/html")).toBe(false);
    expect(isInlineSafe("image/jpeg")).toBe(true);
  });

  it("only accepts Twilio media URLs", () => {
    expect(isTwilioMediaUrl(TWILIO_MEDIA)).toBe(true);
    expect(isTwilioMediaUrl(`${TWILIO_MEDIA}/../x`)).toBe(false);
    expect(isTwilioMediaUrl("https://api.twilio.com.evil.example/2010-04-01/Accounts/x")).toBe(false);
  });

  it("email provider: log by default, Resend needs a key, recipient masked", async () => {
    expect(testConfig().EMAIL_PROVIDER).toBe("log");
    expect(() => testConfig({ EMAIL_PROVIDER: "resend" })).toThrow(/EMAIL_API_KEY/);
    expect(maskEmail("jean.tremblay@exemple.ca")).toBe("j***@exemple.ca");
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response("{}", { status: 200 }));
    await new ResendEmailSender("re_test", "MIMT <messagerie@mimt.ca>", fetchImpl as unknown as typeof fetch).send({ to: "a@b.ca", subject: "s", text: "t" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(String(init!.body))).toMatchObject({ to: ["a@b.ca"], subject: "s" });
  });
});
