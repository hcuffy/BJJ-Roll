import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEEP_LINK_CALLBACK_URL } from "../auth/authLimits.js";
import { createAccountTestFlow } from "./accountTestFlow.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import {
  boundMagicLinkSend,
  continueMagicLink,
  currentSignUpAttestation,
  postAuthJson,
  startAuthTestEnvironment,
  type StartedAuthTestEnvironment,
} from "./authTestHelper.js";

describe.skipIf(!isPostgresTestEnvironmentAvailable())("B13 account delete removes the user's sign-in link and exchange rows", () => {
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

  const { signIn, deleteAccount } = createAccountTestFlow(current);
  const email = "leftover.link@example.com";
  const ipAddress = "198.51.100.151";

  const latestMagicLink = (): string => {
    const sent = current()
      .emailSender.sentMessages.filter((message) => message.kind === "magic_link" && message.to === email)
      .at(-1);
    if (!sent || sent.kind !== "magic_link") {
      throw new Error("No magic link sent");
    }
    return sent.url;
  };

  const sendLink = async (): Promise<string> => {
    await current().pool.query("DELETE FROM public.rate_limits");
    const sentBefore = current().emailSender.sentMessages.length;
    const response = await postAuthJson(current().app, "/sign-in/magic-link", {
      body: { email, callbackURL: DEEP_LINK_CALLBACK_URL, age16Confirmed: true, ...currentSignUpAttestation, ...boundMagicLinkSend },
      ipAddress,
    });
    expect(response.status).toBe(200);
    await expect.poll(() => current().emailSender.sentMessages.length, { timeout: 15_000, interval: 50 }).toBeGreaterThan(sentBefore);
    return latestMagicLink();
  };

  const verificationRows = async (): Promise<string[]> =>
    (await current().pool.query<{ identifier: string }>("SELECT identifier FROM public.verifications ORDER BY identifier")).rows.map(
      (row) => row.identifier,
    );

  it("a link sent before sign-up, a later link and an unredeemed exchange code are all gone, and the old link no longer signs in", async () => {
    const linkBeforeSignUp = await sendLink();
    const user = await signIn(email, ipAddress);
    const linkAfterSignUp = await sendLink();
    const verified = await continueMagicLink(current().app, linkAfterSignUp, { ipAddress });
    expect(new URL(verified.headers.get("location") ?? "bjjroll://auth").searchParams.get("code")).not.toBeNull();
    expect((await verificationRows()).length).toBeGreaterThan(0);

    await current().pool.query("DELETE FROM public.rate_limits");
    expect((await deleteAccount(user)).status).toBe(200);

    expect(await verificationRows()).toEqual([]);
    const replay = await continueMagicLink(current().app, linkBeforeSignUp, { ipAddress });
    expect(new URL(replay.headers.get("location") ?? "bjjroll://auth").searchParams.get("code")).toBeNull();
    expect((await current().pool.query("SELECT id FROM public.users")).rows).toEqual([]);
  }, 60_000);
});
