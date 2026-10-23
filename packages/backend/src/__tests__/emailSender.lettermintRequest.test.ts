import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LETTERMINT_ENDPOINT,
  EmailSendError,
  type FetchFunction,
  LettermintEmailSender,
  type LettermintSendRequestBody,
  renderMagicLinkEmail,
  renderOneTimeCodeEmail,
} from "../email/index.js";

interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

function generateTestApiKey(): string {
  return `lm_test_${randomBytes(16).toString("hex")}`;
}

function extractRequestUrl(input: Parameters<FetchFunction>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function parseJsonBody(init: RequestInit | undefined): LettermintSendRequestBody {
  const rawBody = typeof init?.body === "string" ? init.body : "";
  return JSON.parse(rawBody) as LettermintSendRequestBody;
}

describe("LettermintEmailSender request construction (HEN-43 AC 3)", () => {
  it("builds the expected POST request for sendOneTimeCode and sendMagicLink", async () => {
    const apiKey = generateTestApiKey();
    const capturedRequests: CapturedRequest[] = [];
    const sender = new LettermintEmailSender({
      apiKey,
      fromAddress: "BJJ Roll <no-reply@bjjroll.test>",
      fetchImplementation: (input, init) => {
        capturedRequests.push({ url: extractRequestUrl(input), init });
        return Promise.resolve(
          new Response(JSON.stringify({ message_id: "msg_accepted", status: "pending" }), {
            status: 202,
            headers: { "Content-Type": "application/json" },
          }),
        );
      },
    });

    await sender.sendOneTimeCode({
      to: "  athlete@example.com ",
      code: "904127",
      expiresInMinutes: 10,
    });

    await sender.sendMagicLink({
      to: "athlete@example.com",
      url: "bjjroll://auth/verify?code=exch_9911",
      expiresInMinutes: 15,
    });

    expect(capturedRequests).toHaveLength(2);

    const firstCall = capturedRequests[0];
    expect(firstCall?.url).toBe(DEFAULT_LETTERMINT_ENDPOINT);
    expect(firstCall?.init?.method).toBe("POST");
    expect(firstCall?.init?.headers).toEqual({
      "Content-Type": "application/json",
      "x-lettermint-token": apiKey,
    });
    expect(firstCall?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(parseJsonBody(firstCall?.init)).toEqual({
      from: "BJJ Roll <no-reply@bjjroll.test>",
      to: ["athlete@example.com"],
      ...renderOneTimeCodeEmail({ to: "athlete@example.com", code: "904127", expiresInMinutes: 10 }),
    });

    const secondCall = capturedRequests[1];
    expect(secondCall?.url).toBe(DEFAULT_LETTERMINT_ENDPOINT);
    expect(parseJsonBody(secondCall?.init)).toEqual({
      from: "BJJ Roll <no-reply@bjjroll.test>",
      to: ["athlete@example.com"],
      ...renderMagicLinkEmail({
        to: "athlete@example.com",
        url: "bjjroll://auth/verify?code=exch_9911",
        expiresInMinutes: 15,
      }),
    });
  });

  it("never exposes the API key when serialising the sender or rejecting invalid configuration", () => {
    const apiKey = generateTestApiKey();
    const sender = new LettermintEmailSender({
      apiKey,
      fromAddress: "BJJ Roll <no-reply@bjjroll.test>",
      fetchImplementation: () => Promise.resolve(new Response(null, { status: 202 })),
    });

    expect(JSON.stringify(sender)).not.toContain(apiKey);
    expect(Object.values(sender).join(" ")).not.toContain(apiKey);

    expect(() => new LettermintEmailSender({ apiKey: "   ", fromAddress: "no-reply@bjjroll.test" })).toThrow(EmailSendError);
    expect(() => new LettermintEmailSender({ apiKey, fromAddress: "   " })).toThrow(EmailSendError);
    expect(() => new LettermintEmailSender({ apiKey, fromAddress: "no-reply@bjjroll.test", endpoint: "   " })).toThrow(EmailSendError);
    expect(() => new LettermintEmailSender({ apiKey, fromAddress: "no-reply@bjjroll.test", timeoutMilliseconds: 0 })).toThrow(EmailSendError);
  });
});
