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

describe.skipIf(!isPostgresTestEnvironmentAvailable())(
  "HEN-299 the app ends an old session by presenting that session's own cookie to `/sign-out`",
  () => {
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
    /** What the app sends: no stored session, only the old session's cookie and the app origin. */
    const signOutWith = (cookie: string, ipAddress: string) =>
      postAuthJson(current().app, "/sign-out", { body: {}, cookie, ipAddress, headers: appOriginHeaders });

    it("the app stores the cookie it later presents (`<name>=<token>.<signature>`)", async () => {
      const session = await signIn("revoke.cookie@example.com", "198.51.100.90");
      const signedValue = decodeURIComponent(session.cookie.slice(session.cookie.indexOf("=") + 1));

      expect(session.cookie.split("=")[0]).toMatch(/session_token$/u);
      expect(signedValue.slice(0, signedValue.lastIndexOf("."))).toBe(session.token);
    });

    it("the old session's cookie ends that session and the newer session of the same account survives", async () => {
      const ipAddress = "198.51.100.91";
      const oldSession = await signIn("revoke.same@example.com", ipAddress);
      const newSession = await signIn("revoke.same@example.com", ipAddress);

      const response = await signOutWith(oldSession.cookie, ipAddress);

      expect(response.status).toBe(200);
      expect(await isLive(oldSession.cookie, ipAddress)).toBe(false);
      expect(await isLive(newSession.cookie, ipAddress)).toBe(true);
    });

    it("account A's old cookie ends A's session while account B's session survives", async () => {
      const ipAddress = "198.51.100.92";
      const accountA = await signIn("revoke.alpha@example.com", ipAddress);
      const accountB = await signIn("revoke.bravo@example.com", ipAddress);

      const response = await signOutWith(accountA.cookie, ipAddress);

      expect(response.status).toBe(200);
      expect(await isLive(accountA.cookie, ipAddress)).toBe(false);
      expect(await isLive(accountB.cookie, ipAddress)).toBe(true);
    });

    it("an already ended session's cookie still answers success, so the app clears its marker", async () => {
      const ipAddress = "198.51.100.93";
      const session = await signIn("revoke.twice@example.com", ipAddress);
      expect((await signOutWith(session.cookie, ipAddress)).status).toBe(200);

      expect((await signOutWith(session.cookie, ipAddress)).status).toBe(200);
    });

    it("a sign-out without a cookie answers success but ends nothing (why the app must present the old cookie)", async () => {
      const ipAddress = "198.51.100.94";
      const session = await signIn("revoke.nocookie@example.com", ipAddress);

      const response = await postAuthJson(current().app, "/sign-out", { body: {}, ipAddress, headers: appOriginHeaders });

      expect(response.status).toBe(200);
      expect(await isLive(session.cookie, ipAddress)).toBe(true);
    });
  },
);
