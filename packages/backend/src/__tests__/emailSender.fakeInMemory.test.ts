import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EmailSendError,
  type EmailSender,
  FakeEmailSender,
  LettermintEmailSender,
  renderMagicLinkEmail,
  renderOneTimeCodeEmail,
} from "../email/index.js";

function generateTestToken(): string {
  return `lm_test_${randomBytes(16).toString("hex")}`;
}

describe("EmailSender interface and FakeEmailSender (HEN-43 AC 1–2)", () => {
  it("satisfies EmailSender for both FakeEmailSender and LettermintEmailSender", () => {
    const fakeSender: EmailSender = new FakeEmailSender();
    const lettermintSender: EmailSender = new LettermintEmailSender({
      apiKey: generateTestToken(),
      fromAddress: "BJJ Roll <auth@bjjroll.test>",
      fetchImplementation: () => Promise.resolve(new Response(JSON.stringify({ message_id: "msg_1", status: "pending" }), { status: 202 })),
    });
    expect(typeof fakeSender.sendOneTimeCode).toBe("function");
    expect(typeof fakeSender.sendMagicLink).toBe("function");
    expect(typeof lettermintSender.sendOneTimeCode).toBe("function");
    expect(typeof lettermintSender.sendMagicLink).toBe("function");
  });

  it("records one-time code and magic-link messages in memory and exposes defensive copies", async () => {
    const sender = new FakeEmailSender();
    const code = "482910";
    const magicLinkUrl = "bjjroll://auth/magic-link?code=exch_test_token";

    await sender.sendOneTimeCode({
      to: "grappler@example.com",
      code,
      expiresInMinutes: 10,
    });
    await sender.sendMagicLink({
      to: "grappler@example.com",
      url: magicLinkUrl,
      expiresInMinutes: 15,
    });

    expect(sender.sentMessages).toHaveLength(2);
    expect(sender.sentMessages[0]).toEqual({
      kind: "one_time_code",
      to: "grappler@example.com",
      code,
      expiresInMinutes: 10,
      ...renderOneTimeCodeEmail({ to: "grappler@example.com", code, expiresInMinutes: 10 }),
    });
    expect(sender.sentMessages[1]).toEqual({
      kind: "magic_link",
      to: "grappler@example.com",
      url: magicLinkUrl,
      expiresInMinutes: 15,
      ...renderMagicLinkEmail({ to: "grappler@example.com", url: magicLinkUrl, expiresInMinutes: 15 }),
    });

    const snapshot = sender.sentMessages as unknown[];
    snapshot.pop();
    expect(sender.sentMessages).toHaveLength(2);
    expect(JSON.stringify(sender)).toBe("{}");

    sender.clear();
    expect(sender.sentMessages).toHaveLength(0);
  });

  it("rejects blank recipient, code, url or non-positive expiry with EmailSendError", async () => {
    const sender = new FakeEmailSender();
    await expect(sender.sendOneTimeCode({ to: "   ", code: "123456", expiresInMinutes: 10 })).rejects.toThrow(EmailSendError);
    await expect(sender.sendOneTimeCode({ to: "grappler@example.com", code: "", expiresInMinutes: 10 })).rejects.toThrow(EmailSendError);
    await expect(sender.sendOneTimeCode({ to: "grappler@example.com", code: "123456", expiresInMinutes: 0 })).rejects.toThrow(EmailSendError);
    await expect(sender.sendMagicLink({ to: "grappler@example.com", url: "   ", expiresInMinutes: 15 })).rejects.toThrow(EmailSendError);
    await expect(sender.sendMagicLink({ to: "grappler@example.com", url: "bjjroll://auth", expiresInMinutes: -5 })).rejects.toThrow(EmailSendError);
  });
});
