import { describe, expect, it } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import { exchangeMagicLink } from "../auth/magicLinkReturn";
import { failureMessages } from "../auth/signInActions";
import { createFakeBackend, createMemorySecureStore, seedPendingSignIn, TEST_BACKEND_URL } from "./authTestDoubles";

const ERROR_LINK = "bjjroll://auth?r=link_invalid";
const ignored = { ok: false, reason: "ignored", message: null };
const expired = { ok: false, reason: "invalidLink", message: failureMessages.invalidLink };

function linkSetUp() {
  const backend = createFakeBackend();
  const secureStore = createMemorySecureStore();
  const client = createMobileAuthClient({ backendUrl: TEST_BACKEND_URL, storage: secureStore, fetchImplementation: backend.fetchImplementation });
  const open = (url: string, signedOut: AbortSignal) =>
    exchangeMagicLink(client, secureStore, { url, signal: new AbortController().signal, signedOut });
  return { secureStore, open };
}

describe("an error link after a link sign-in succeeded is dropped until the next sign-out (Vera fix 7)", () => {
  it("drops the error link after a success and shows it again once signed out", async () => {
    const { secureStore, open } = linkSetUp();
    const signedIn = new AbortController();
    seedPendingSignIn(secureStore);

    expect(await open("bjjroll://auth?code=exchange-code-1", signedIn.signal)).toEqual({ ok: true });
    expect(await open(ERROR_LINK, signedIn.signal)).toEqual(ignored);

    signedIn.abort();
    expect(await open(ERROR_LINK, new AbortController().signal)).toEqual(expired);
  });

  it("shows an error link when no link sign-in has succeeded", async () => {
    const { open } = linkSetUp();

    expect(await open(ERROR_LINK, new AbortController().signal)).toEqual(expired);
  });
});
