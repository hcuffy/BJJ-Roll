import { expect } from "vitest";
import type { FakeSentOneTimeCodeMessage } from "../email/index.js";
import { extractSessionCookie, postAuthJson, testBaseUrl, type StartedAuthTestEnvironment } from "./authTestHelper.js";

export interface SignedInUser {
  readonly email: string;
  readonly cookie: string;
  readonly userId: string;
}

export interface AccountRequestOptions {
  cookie?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

/** Sign-in, delete-code and account requests shared by the HEN-65 Postgres suites. */
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
    const response = await postAuthJson(current().app, "/email-otp/send-verification-otp", {
      body: { email, type: "sign-in", ageConfirmed: true },
      ipAddress,
    });
    expect(response.status).toBe(200);
  };

  const signIn = async (email: string, ipAddress: string): Promise<SignedInUser> => {
    await sendOtp(email, ipAddress);
    const response = await postAuthJson(current().app, "/sign-in/email-otp", { body: { email, otp: latestCodeFor(email, "sign_in") }, ipAddress });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { id: string } };
    return { email, cookie: extractSessionCookie(response), userId: body.user.id };
  };

  const accountRequest = (method: "GET" | "POST" | "DELETE", path: string, options: AccountRequestOptions = {}) => {
    const headers: Record<string, string> = { ...options.headers };
    if (options.cookie) {
      headers.cookie = options.cookie;
    }
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    return current().app.request(`${testBaseUrl}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  };

  /** POST /account/delete-code, then the code from the email it sent. */
  const requestDeleteCode = async (user: SignedInUser): Promise<string> => {
    const response = await accountRequest("POST", "/account/delete-code", { cookie: user.cookie });
    expect(response.status).toBe(200);
    return latestCodeFor(user.email, "account_deletion");
  };

  /** The full fresh-code delete: request a code, then DELETE /account with it. */
  const deleteAccount = async (user: SignedInUser): Promise<Response> => {
    const code = await requestDeleteCode(user);
    return accountRequest("DELETE", "/account", { cookie: user.cookie, body: { code } });
  };

  return { latestCodeFor, sendOtp, signIn, accountRequest, requestDeleteCode, deleteAccount };
}
