import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import {
  currentSignUpAttestation,
  extractSessionCookie,
  getAuthPath,
  postAuthJson,
  startAuthTestEnvironment,
  type StartedAuthTestEnvironment,
} from "./authTestHelper.js";

/** The app sends this header on every auth request (Expo client); the server reads it as the request origin. */
const appOriginHeaders = { "expo-origin": "bjjroll://" };

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-299 a new sign-in revokes the old session by its token", () => {
  let environment: StartedAuthTestEnvironment | undefined;

  const current = (): StartedAuthTestEnvironment => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    return environment;
  };

  beforeAll(async () => {
    environment = await startAuthTestEnvironment();
  }, 60_000);

  afterAll(async () => {
    await environment?.stop();
  }, 30_000);

  const signIn = async (email: string, ipAddress: string): Promise<{ cookie: string; token: string }> => {
    const { app, emailSender } = current();
    await postAuthJson(app, "/email-otp/send-verification-otp", {
      body: { email, type: "sign-in", age16Confirmed: true, ...currentSignUpAttestation },
      ipAddress,
    });
    const sent = emailSender.sentMessages.filter((message) => message.kind === "one_time_code" && message.to === email).at(-1);
    if (sent?.kind !== "one_time_code") {
      throw new Error("No sign-in code sent");
    }
    const response = await postAuthJson(app, "/sign-in/email-otp", { body: { email, otp: sent.code }, ipAddress });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string };
    return { cookie: extractSessionCookie(response), token: body.token };
  };
  const isLive = async (cookie: string, ipAddress: string) =>
    (await (await getAuthPath(current().app, "/get-session", { cookie, ipAddress })).json()) !== null;
  const revoke = (token: string, cookie: string, ipAddress: string) =>
    postAuthJson(current().app, "/revoke-session", { body: { token }, cookie, ipAddress, headers: appOriginHeaders });

  it("the cookie carries the token the app reads from it (`<token>.<signature>`)", async () => {
    const session = await signIn("revoke.cookie@example.com", "198.51.100.90");
    const signedValue = decodeURIComponent(session.cookie.slice(session.cookie.indexOf("=") + 1));

    expect(signedValue.slice(0, signedValue.lastIndexOf("."))).toBe(session.token);
  });

  it("revokes the old session and the new session survives", async () => {
    const ipAddress = "198.51.100.91";
    const oldSession = await signIn("revoke.same@example.com", ipAddress);
    const newSession = await signIn("revoke.same@example.com", ipAddress);

    const response = await revoke(oldSession.token, newSession.cookie, ipAddress);

    expect(response.status).toBe(200);
    expect(await isLive(oldSession.cookie, ipAddress)).toBe(false);
    expect(await isLive(newSession.cookie, ipAddress)).toBe(true);
  });

  it("never revokes a session of another account", async () => {
    const ipAddress = "198.51.100.92";
    const otherAccount = await signIn("revoke.other@example.com", ipAddress);
    const newSession = await signIn("revoke.mine@example.com", ipAddress);

    await revoke(otherAccount.token, newSession.cookie, ipAddress);

    expect(await isLive(otherAccount.cookie, ipAddress)).toBe(true);
    expect(await isLive(newSession.cookie, ipAddress)).toBe(true);
  });
});
