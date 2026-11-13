import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import {
  boundMagicLinkSend,
  continueMagicLink,
  currentSignUpAttestation,
  extractSessionCookie,
  postAuthJson,
  startAuthTestEnvironment,
  testSignInVerifier,
  type StartedAuthTestEnvironment,
} from "./authTestHelper.js";

describe.skipIf(!isPostgresTestEnvironmentAvailable())("an expired phone verifier never signs anyone in (Bill nit 2)", () => {
  let environment: StartedAuthTestEnvironment | undefined;

  const current = (): StartedAuthTestEnvironment => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    return environment;
  };

  const signInWithRightVerifier = async (email: string, ipAddress: string, ageVerifier: boolean): Promise<Response> => {
    const { app, codec, emailSender, pool } = current();
    const sent = await postAuthJson(app, "/sign-in/magic-link", {
      body: { email, age16Confirmed: true, ...currentSignUpAttestation, ...boundMagicLinkSend },
      ipAddress,
    });
    expect(sent.status).toBe(200);
    const message = emailSender.sentMessages.filter((candidate) => candidate.kind === "magic_link" && candidate.to === email).at(-1);
    if (!message || message.kind !== "magic_link") {
      throw new Error(`No magic link sent for ${email}`);
    }
    if (ageVerifier) {
      const aged = await pool.query(
        "UPDATE public.verifications SET expires_at = now() - interval '1 second' WHERE identifier LIKE 'magic-link-verifier:%' AND email_hash = $1",
        [codec.computeEmailHmac(email)],
      );
      expect(aged.rowCount).toBe(1);
    }
    const continued = await continueMagicLink(app, message.url, { ipAddress });
    expect(continued.status).toBe(303);
    const code = new URL(continued.headers.get("location") ?? "").searchParams.get("code") ?? "";
    return await postAuthJson(app, "/magic-link/exchange", { body: { code, verifier: testSignInVerifier }, ipAddress });
  };

  beforeAll(async () => {
    environment = await startAuthTestEnvironment();
  }, 60_000);

  afterAll(async () => {
    await environment?.stop();
  }, 30_000);

  it("a live verifier row signs in with the right verifier", async () => {
    const response = await signInWithRightVerifier("verifier.live@example.com", "198.51.110.1", false);
    expect(response.status).toBe(200);
    expect(extractSessionCookie(response)).toContain("=");
  });

  it("once the verifier row has expired, the right verifier gets 401 and no session, and the row is gone", async () => {
    const email = "verifier.aged@example.com";
    const response = await signInWithRightVerifier(email, "198.51.110.2", true);
    expect(response.status).toBe(401);
    expect(extractSessionCookie(response)).toBe("");
    const { codec, pool } = current();
    const left = await pool.query("SELECT 1 FROM public.verifications WHERE identifier LIKE 'magic-link-verifier:%' AND email_hash = $1", [
      codec.computeEmailHmac(email),
    ]);
    expect(left.rowCount).toBe(0);
  });
});
