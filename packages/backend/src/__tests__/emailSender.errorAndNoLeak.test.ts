import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { EmailSendError, FakeEmailSender, LettermintEmailSender } from "../email/index.js";

const secretRecipient = "sensitive.athlete@example.com";
const secretCode = "739204";
const secretMagicLinkUrl = "bjjroll://auth/magic?code=secret_exchange_token_8842";

function generateTestApiKey(): string {
  return `lm_test_${randomBytes(16).toString("hex")}`;
}

function assertNoSecretsInError(error: unknown, apiKey: string): void {
  expect(error).toBeInstanceOf(EmailSendError);
  const emailError = error as EmailSendError;
  const serialized = `${String(emailError)} ${emailError.message} ${emailError.stack ?? ""} ${JSON.stringify(emailError)}`;
  expect(serialized).not.toContain(secretRecipient);
  expect(serialized).not.toContain(secretCode);
  expect(serialized).not.toContain(secretMagicLinkUrl);
  expect(serialized).not.toContain(apiKey);
  expect(emailError.cause).toBeUndefined();
}

describe("LettermintEmailSender error handling and zero-PII log capture (HEN-43 AC 3–5)", () => {
  it.each([400, 401, 422, 429, 500, 503])("throws EmailSendError without retries or leaked data on HTTP %i", async (statusCode) => {
    const apiKey = generateTestApiKey();
    let callCount = 0;
    const sender = new LettermintEmailSender({
      apiKey,
      fromAddress: "BJJ Roll <no-reply@bjjroll.test>",
      fetchImplementation: () => {
        callCount += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              message: `Rejected ${secretRecipient} code=${secretCode} url=${secretMagicLinkUrl} key=${apiKey}`,
            }),
            { status: statusCode },
          ),
        );
      },
    });

    let caughtError: unknown;
    try {
      await sender.sendOneTimeCode({
        to: secretRecipient,
        code: secretCode,
        expiresInMinutes: 10,
      });
    } catch (error) {
      caughtError = error;
    }

    expect(callCount).toBe(1);
    assertNoSecretsInError(caughtError, apiKey);
    expect((caughtError as EmailSendError).reason).toBe("http_status");
    expect((caughtError as EmailSendError).statusCode).toBe(statusCode);
  });

  it("throws EmailSendError without retries or leaked data on network and timeout errors", async () => {
    const apiKey = generateTestApiKey();
    let networkCalls = 0;
    const networkFailingSender = new LettermintEmailSender({
      apiKey,
      fromAddress: "BJJ Roll <no-reply@bjjroll.test>",
      fetchImplementation: () => {
        networkCalls += 1;
        return Promise.reject(new TypeError(`connect ECONNREFUSED for ${secretRecipient} ${secretCode} ${secretMagicLinkUrl} ${apiKey}`));
      },
    });

    let networkError: unknown;
    try {
      await networkFailingSender.sendMagicLink({
        to: secretRecipient,
        url: secretMagicLinkUrl,
        expiresInMinutes: 15,
      });
    } catch (error) {
      networkError = error;
    }

    expect(networkCalls).toBe(1);
    assertNoSecretsInError(networkError, apiKey);
    expect((networkError as EmailSendError).reason).toBe("network");

    const timeoutSender = new LettermintEmailSender({
      apiKey,
      fromAddress: "BJJ Roll <no-reply@bjjroll.test>",
      fetchImplementation: () => {
        const timeoutException = new DOMException(`Timed out sending to ${secretRecipient} with ${apiKey}`, "TimeoutError");
        return Promise.reject(timeoutException);
      },
    });

    let timeoutError: unknown;
    try {
      await timeoutSender.sendOneTimeCode({
        to: secretRecipient,
        code: secretCode,
        expiresInMinutes: 10,
      });
    } catch (error) {
      timeoutError = error;
    }

    assertNoSecretsInError(timeoutError, apiKey);
    expect((timeoutError as EmailSendError).reason).toBe("timeout");
  });

  it("logs no email address, no code, no magic-link URL and no API key across both senders (AC 4)", async () => {
    const apiKey = generateTestApiKey();
    const capturedOutput: string[] = [];
    const recordCall = (...values: unknown[]) => {
      capturedOutput.push(values.map((value) => String(value)).join(" "));
    };

    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(recordCall);
    const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(recordCall);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(recordCall);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(recordCall);
    const consoleDebugSpy = vi.spyOn(console, "debug").mockImplementation(recordCall);

    try {
      const fakeSender = new FakeEmailSender();
      await fakeSender.sendOneTimeCode({ to: secretRecipient, code: secretCode, expiresInMinutes: 10 });
      await fakeSender.sendMagicLink({ to: secretRecipient, url: secretMagicLinkUrl, expiresInMinutes: 15 });

      const lettermintSender = new LettermintEmailSender({
        apiKey,
        fromAddress: "BJJ Roll <no-reply@bjjroll.test>",
        fetchImplementation: () => Promise.resolve(new Response(JSON.stringify({ message_id: "msg_ok", status: "pending" }), { status: 202 })),
      });
      await lettermintSender.sendOneTimeCode({ to: secretRecipient, code: secretCode, expiresInMinutes: 10 });
      await lettermintSender.sendMagicLink({ to: secretRecipient, url: secretMagicLinkUrl, expiresInMinutes: 15 });

      const failingLettermintSender = new LettermintEmailSender({
        apiKey,
        fromAddress: "BJJ Roll <no-reply@bjjroll.test>",
        fetchImplementation: () => Promise.resolve(new Response("error", { status: 500 })),
      });
      await expect(failingLettermintSender.sendOneTimeCode({ to: secretRecipient, code: secretCode, expiresInMinutes: 10 })).rejects.toThrow(
        EmailSendError,
      );
    } finally {
      consoleLogSpy.mockRestore();
      consoleInfoSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      consoleDebugSpy.mockRestore();
    }

    const combinedLogs = capturedOutput.join("\n");
    expect(combinedLogs).not.toContain(secretRecipient);
    expect(combinedLogs).not.toContain(secretCode);
    expect(combinedLogs).not.toContain(secretMagicLinkUrl);
    expect(combinedLogs).not.toContain(apiKey);
    expect(capturedOutput).toHaveLength(0);
  });
});
