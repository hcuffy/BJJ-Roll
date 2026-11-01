import { describe, expect, it } from "vitest";
import { currentSignUpAttestation, postAuthJson, testSignInVerifier } from "./authTestHelper.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import { createGoogleSignInTestContext } from "./googleSignInTestContext.js";

describe.skipIf(!isPostgresTestEnvironmentAvailable())("Google sign-in code bound to the app's verifier", () => {
  const { current, signInWithGoogle, exchangeForSession } = createGoogleSignInTestContext();

  it("an exchange without the verifier, or with the wrong one, returns 401 and leaves the code unspent", async () => {
    const { location } = await signInWithGoogle(
      { subject: "google-sub-verifier", email: "google.verifier@example.com", emailVerified: true },
      { additionalData: { age16Confirmed: true, ...currentSignUpAttestation } },
    );
    const code = location.searchParams.get("code") ?? "";

    const missing = await postAuthJson(current().app, "/magic-link/exchange", { body: { code }, ipAddress: "198.51.100.211" });
    expect(missing.status).toBe(401);
    const wrong = await postAuthJson(current().app, "/magic-link/exchange", {
      body: { code, verifier: `${testSignInVerifier.slice(0, -1)}0` },
      ipAddress: "198.51.100.211",
    });
    expect(wrong.status).toBe(401);

    const { cookie } = await exchangeForSession(code);
    expect(cookie).toContain("=");
  });

  it("a Google start without a verifier hash never exchanges for a session", async () => {
    const { location } = await signInWithGoogle(
      { subject: "google-sub-unbound", email: "google.unbound@example.com", emailVerified: true },
      { additionalData: { verifierHash: undefined, age16Confirmed: true, ...currentSignUpAttestation } },
    );
    const response = await postAuthJson(current().app, "/magic-link/exchange", {
      body: { code: location.searchParams.get("code") ?? "", verifier: testSignInVerifier },
      ipAddress: "198.51.100.212",
    });
    expect(response.status).toBe(401);
  });
});
