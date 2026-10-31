import { signUpAttestationVersion } from "@bjj-roll/shared";
import { describe, expect, it } from "vitest";
import { generateTestAuthSecrets, GOOGLE_CLIENT_ID_ENV, GOOGLE_CLIENT_SECRET_ENV } from "../auth/index.js";
import { AUTH_BASE_URL_ENV, DATABASE_URL_ENV, EMAIL_FROM_ADDRESS_ENV, LETTERMINT_API_KEY_ENV, loadServerConfig } from "../serverConfig.js";

const validEnvironment = (nodeEnvironment: string | undefined): Record<string, string | undefined> => ({
  ...generateTestAuthSecrets(),
  [AUTH_BASE_URL_ENV]: "https://api.example.test",
  [DATABASE_URL_ENV]: "postgres://app@db.example.test/bjj",
  [LETTERMINT_API_KEY_ENV]: "lm-test-value-not-a-secret",
  [EMAIL_FROM_ADDRESS_ENV]: "login@example.test",
  [GOOGLE_CLIENT_ID_ENV]: "test-google-client.apps.example.test",
  [GOOGLE_CLIENT_SECRET_ENV]: "test-google-secret-not-real",
  NODE_ENV: nodeEnvironment,
});

const reviewedTextVersion = { id: "attestation-signup-2027-01", isDraft: false } as const;

describe("HEN-183 sign-up attestation text version in the startup config check", () => {
  it("the shipped sign-up attestation text is a draft until the lawyer review (HEN-45)", () => {
    expect(signUpAttestationVersion.isDraft).toBe(true);
    expect(signUpAttestationVersion.id).toContain("draft");
  });

  it("a production config with a draft attestation text version fails before the server starts", () => {
    expect(() => loadServerConfig(validEnvironment("production"))).toThrow(
      `Sign-up attestation text version ${signUpAttestationVersion.id} is a draft; production needs a lawyer-reviewed version`,
    );
  });

  it.each([undefined, "", "development", "test"])("NODE_ENV=%s accepts the draft attestation text version", (nodeEnvironment) => {
    expect(loadServerConfig(validEnvironment(nodeEnvironment)).signUpAttestationTextVersionId).toBe(signUpAttestationVersion.id);
  });

  it("a production config with a reviewed (non-draft) text version starts", () => {
    expect(
      loadServerConfig(validEnvironment("production"), { signUpAttestationTextVersion: reviewedTextVersion }).signUpAttestationTextVersionId,
    ).toBe(reviewedTextVersion.id);
  });
});
