import { SIGN_UP_ATTESTATION_TEXT_VERSION } from "@bjj-roll/shared";
import { expect, vi } from "vitest";
import type { FakeSentOneTimeCodeMessage } from "../email/index.js";
import { extractSessionCookie, postAuthJson, socketEnvironment, testBaseUrl, type StartedAuthTestEnvironment } from "./authTestHelper.js";

export interface SignedInUser {
  readonly email: string;
  readonly cookie: string;
  readonly userId: string;
  readonly ipAddress: string;
}

export interface AccountRequestOptions {
  cookie?: string;
  headers?: Record<string, string>;
  body?: unknown;
  ipAddress?: string;
}

const defaultAccountClientIp = "198.51.100.99";

export function createAccountTestFlow(current: () => StartedAuthTestEnvironment) {
  const latestCodeFor = (email: string, purpose: NonNullable<FakeSentOneTimeCodeMessage["purpose"]>): string => {
    const sent = current()
      .emailSender.sentMessages.filter(
        (message): message is FakeSentOneTimeCodeMessage =>
          message.kind === "one_time_code" && message.to.toLowerCase() === email && (message.purpose ?? "sign_in") === purpose,
      )
      .at(-1);
    if (!sent) {
      throw new Error(`No ${purpose} code sent for ${email}`);
    }
    return sent.code;
  };

  const sendOtp = async (email: string, ipAddress: string): Promise<void> => {
    const sentBefore = current().emailSender.sentMessages.length;
    const response = await postAuthJson(current().app, "/email-otp/send-verification-otp", {
      body: { email, type: "sign-in", age16Confirmed: true, signUpAttestationTextVersionId: SIGN_UP_ATTESTATION_TEXT_VERSION.id },
      ipAddress,
    });
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(current().emailSender.sentMessages.length).toBeGreaterThan(sentBefore), { timeout: 15_000, interval: 50 });
  };

  const signIn = async (email: string, ipAddress: string): Promise<SignedInUser> => {
    await sendOtp(email, ipAddress);
    const response = await postAuthJson(current().app, "/sign-in/email-otp", { body: { email, otp: latestCodeFor(email, "sign_in") }, ipAddress });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { id: string } };
    return { email, cookie: extractSessionCookie(response), userId: body.user.id, ipAddress };
  };

  const accountRequest = (method: "GET" | "POST" | "DELETE", path: string, options: AccountRequestOptions = {}) => {
    const headers: Record<string, string> = { ...options.headers };
    if (options.cookie) {
      headers.cookie = options.cookie;
    }
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    return current().app.request(
      `${testBaseUrl}${path}`,
      { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) },
      socketEnvironment(options.ipAddress ?? defaultAccountClientIp),
    );
  };

  const requestDeleteCode = async (user: SignedInUser): Promise<string> => {
    const response = await accountRequest("POST", "/account/delete-code", { cookie: user.cookie, ipAddress: user.ipAddress });
    expect(response.status).toBe(200);
    return latestCodeFor(user.email, "account_deletion");
  };

  const deleteAccount = async (user: SignedInUser): Promise<Response> => {
    const code = await requestDeleteCode(user);
    return accountRequest("DELETE", "/account", { cookie: user.cookie, body: { code }, ipAddress: user.ipAddress });
  };

  return { latestCodeFor, sendOtp, signIn, accountRequest, requestDeleteCode, deleteAccount };
}
