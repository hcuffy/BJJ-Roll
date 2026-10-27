import { SIGN_UP_ATTESTATION_REFUSAL_MESSAGE, SIGN_UP_ATTESTATION_TEXT_VERSION } from "@bjj-roll/shared";
import { describe, expect, it, vi } from "vitest";
import { acceptSignUpAttestation, readSignUpAttestation } from "../auth/accountActions";
import { createMobileAuthClient } from "../auth/authClient";
import { completeMagicLink, sendEmailCode, sendMagicLink, verifyEmailCode } from "../auth/signInActions";
import { completeSocialSignIn, signInWithProvider, SOCIAL_SIGN_IN_CALLBACK_URL, type AuthBrowser } from "../auth/socialSignIn";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";

const VERSION_ID = SIGN_UP_ATTESTATION_TEXT_VERSION.id;
const ATTESTATION_REFUSED = { ok: false, reason: "attestationRequired", message: SIGN_UP_ATTESTATION_REFUSAL_MESSAGE } as const;
const ACCEPTED = { age16Confirmed: true, signUpAttestationAccepted: true } as const;

function createTestClient(options: Parameters<typeof createFakeBackend>[0] = {}) {
  const backend = createFakeBackend(options);
  const storage = createMemorySecureStore();
  const client = createMobileAuthClient({ backendUrl: TEST_BACKEND_URL, storage, fetchImplementation: backend.fetchImplementation });
  const browser = {
    openAuthSessionAsync: vi.fn<AuthBrowser["openAuthSessionAsync"]>(() =>
      Promise.resolve({ type: "success", url: `${SOCIAL_SIGN_IN_CALLBACK_URL}?code=one-time-code` }),
    ),
  };
  const social = { client, backendUrl: TEST_BACKEND_URL, platform: "android", browser };
  return { backend, client, storage, social };
}

describe("HEN-183 sign-up attestation requests", () => {
  it("sends no code, link or social request until the duties are accepted", async () => {
    const { backend, client, social } = createTestClient();
    const entry = { email: "member@example.test", age16Confirmed: true };

    expect(await sendEmailCode(client, entry)).toEqual(ATTESTATION_REFUSED);
    expect(await sendMagicLink(client, { ...entry, signUpAttestationAccepted: false })).toEqual(ATTESTATION_REFUSED);
    expect(await verifyEmailCode(client, { ...entry, code: "123456" })).toEqual(ATTESTATION_REFUSED);
    expect(await signInWithProvider(social, "google", { age16Confirmed: true })).toEqual(ATTESTATION_REFUSED);
    expect(backend.fetchImplementation).not.toHaveBeenCalled();
    expect(social.browser.openAuthSessionAsync).not.toHaveBeenCalled();
  });

  it("the 16+ refusal still comes first when neither box is ticked", async () => {
    const { client } = createTestClient();

    expect((await sendEmailCode(client, { email: "member@example.test", age16Confirmed: false })).ok).toBe(false);
    expect(await sendEmailCode(client, { email: "member@example.test", age16Confirmed: false })).toMatchObject({ reason: "ageRequired" });
  });

  it("sends the current text version id with the code, the link and social sign-in", async () => {
    const { backend, client, social } = createTestClient();

    expect(await sendEmailCode(client, { email: "member@example.test", ...ACCEPTED })).toEqual({ ok: true });
    expect(await sendMagicLink(client, { email: "member@example.test", ...ACCEPTED })).toEqual({ ok: true });
    expect(await signInWithProvider(social, "google", ACCEPTED)).toEqual({ ok: true });

    const sent = backend.requests.filter((request) => request.method === "POST" && !request.url.endsWith("/magic-link/exchange"));
    expect(sent.map((request) => request.body?.signUpAttestationTextVersionId ?? request.body?.additionalData)).toEqual([
      VERSION_ID,
      VERSION_ID,
      { age16Confirmed: true, age18Confirmed: false, signUpAttestationTextVersionId: VERSION_ID },
    ]);
  });

  it("reads the backend's refusal code, link reason and social error as the attestation refusal", async () => {
    const refusal = { status: 400, body: { code: "SIGN_UP_ATTESTATION_REQUIRED", message: "raw server text" } };
    const { client } = createTestClient({ emailOtpRefusal: refusal });

    expect(await verifyEmailCode(client, { email: "member@example.test", code: "123456", ...ACCEPTED })).toEqual(ATTESTATION_REFUSED);
    expect(await completeMagicLink(client, "bjjroll://auth?r=attestation_refused")).toEqual(ATTESTATION_REFUSED);
    expect(await completeSocialSignIn(client, `${SOCIAL_SIGN_IN_CALLBACK_URL}?error=SIGN_UP_ATTESTATION_REQUIRED`)).toEqual(ATTESTATION_REFUSED);
  });

  it("reads the attestation status and accepts the shown text version for the signed-in user", async () => {
    const { backend, client, storage } = createTestClient({ signUpAttestationAcceptedVersion: null });
    await verifyEmailCode(client, { email: "member@example.test", code: "123456", ...ACCEPTED });
    const session = { client, secureStore: storage, backendUrl: TEST_BACKEND_URL };

    expect(await readSignUpAttestation(session)).toEqual({
      ok: true,
      status: { required: true, currentTextVersionId: VERSION_ID, acceptedTextVersionId: null },
    });
    expect(await acceptSignUpAttestation(session)).toEqual({
      ok: true,
      status: { required: false, currentTextVersionId: VERSION_ID, acceptedTextVersionId: VERSION_ID },
    });
    expect(backend.requests.at(-1)).toMatchObject({ method: "POST", body: { textVersionId: VERSION_ID } });
  });

  it("fails closed: a read the app cannot parse is a failure, never a pass", async () => {
    const { client, storage } = createTestClient({ signUpAttestationBadPayload: true });
    await verifyEmailCode(client, { email: "member@example.test", code: "123456", ...ACCEPTED });

    expect((await readSignUpAttestation({ client, secureStore: storage, backendUrl: TEST_BACKEND_URL })).ok).toBe(false);
  });
});
