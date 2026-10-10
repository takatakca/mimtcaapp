import { describe, expect, it } from "vitest";
import { contentTypeFor, inlineImages, uploadProblem } from "./media";

describe("contentTypeFor", () => {
  it("prefers the picker's MIME type and normalises aliases", () => {
    expect(contentTypeFor("file:///a.bin", "image/jpeg")).toBe("image/jpeg");
    expect(contentTypeFor("file:///a.bin", "image/jpg")).toBe("image/jpeg");
    expect(contentTypeFor("file:///a.wav", "audio/x-wav")).toBe("audio/wav");
  });
  it("falls back on the extension", () => {
    expect(contentTypeFor("file:///photos/IMG_1.JPG")).toBe("image/jpeg");
    expect(contentTypeFor("file:///rec/greeting.wav?x=1")).toBe("audio/wav");
    expect(contentTypeFor("file:///rec/greeting.m4a")).toBeNull();
  });
});

describe("uploadProblem (same limits as the API)", () => {
  it("accepts JPEG/PNG/GIF photos up to 5 MB", () => {
    expect(uploadProblem("mms", "image/png", 1000)).toBeNull();
    expect(uploadProblem("mms", "image/heic", 1000)).toBe("error.mediaInvalid");
    expect(uploadProblem("mms", "image/jpeg", 6 * 1024 * 1024)).toBe("error.mediaTooLarge");
    expect(uploadProblem("mms", null, 10)).toBe("error.mediaInvalid");
  });
  it("accepts MP3/WAV greetings only", () => {
    expect(uploadProblem("greeting", "audio/wav", 1000)).toBeNull();
    expect(uploadProblem("greeting", "audio/mp4", 1000)).toBe("error.mediaInvalid");
  });
});

describe("inlineImages", () => {
  it("keeps images with a valid link", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    const list = inlineImages(
      [
        { id: "1", contentType: "image/png", url: "https://api/1", urlExpiresAt: "2026-10-10T12:15:00Z" },
        { id: "2", contentType: "image/png", url: "https://api/2", urlExpiresAt: "2026-10-10T11:00:00Z" },
        { id: "3", contentType: "text/vcard", url: "https://api/3", urlExpiresAt: null },
        { id: "4", contentType: "image/gif", url: null, urlExpiresAt: null },
      ],
      now,
    );
    expect(list.map((m) => m.id)).toEqual(["1"]);
    expect(inlineImages(undefined)).toEqual([]);
  });
});
