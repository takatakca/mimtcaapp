import { describe, expect, it, vi } from "vitest";
import { LogEmailSender } from "../src/services/email.js";
import { LogNotifier } from "../src/services/notifier.js";

describe("disabled delivery adapters never leak customer data into application logs", () => {
  it("does not log voicemail summaries, phone numbers or user IDs when push is not configured", async () => {
    const info = vi.fn();
    const notifier = new LogNotifier({ info } as unknown as ConstructorParameters<typeof LogNotifier>[0]);
    await notifier.notify("private-user-123", "voicemail_received", {
      voicemailId: "private-vm-id",
      text: "CONFIDENTIAL VOICEMAIL TRANSCRIPT",
      title: "Message vocal de +15145559876",
      signedUrl: "https://example.test/audio?token=PRIVATE_TOKEN",
    });
    expect(info).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(info.mock.calls);
    expect(serialized).toContain("delivered");
    expect(serialized).toContain("false");
    for (const secret of ["private-user-123", "private-vm-id", "CONFIDENTIAL", "+15145559876", "PRIVATE_TOKEN"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("does not log recipients, email subjects, call details or signed audio URLs", async () => {
    const info = vi.fn();
    const sender = new LogEmailSender({ info } as unknown as ConstructorParameters<typeof LogEmailSender>[0]);
    await sender.send({
      to: "victim@example.ca",
      subject: "Nouveau message vocal de +15145559876",
      text: "CONFIDENTIAL VOICEMAIL https://example.test/audio?token=PRIVATE_TOKEN",
    });
    expect(info).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(info.mock.calls);
    expect(serialized).toContain("delivered");
    expect(serialized).toContain("false");
    for (const secret of ["victim", "example.ca", "15145559876", "CONFIDENTIAL", "PRIVATE_TOKEN"]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
