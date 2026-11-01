import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { failureMessages } from "../auth/signInActions";
import { colours } from "../theme/tokens";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL, TEST_DELETE_CODE, seedPendingSignIn } from "./authTestDoubles";
import { resetBackListeners } from "./backHandlerHarness";
import { deepLinkState, flattenStyle, renderScreen, settle } from "./screenHarness";

const appClient = vi.hoisted(() => ({ current: null as MobileAuthClient | null, store: null as ReturnType<typeof createMemorySecureStore> | null }));
vi.mock("../auth/appAuthClient", () => ({
  get appAuthClient() {
    return appClient.current;
  },
  get appSecureStore() {
    return appClient.store;
  },
  appBackendUrl: "http://backend.test",
}));

const { App } = await import("../App");

const CODE_STEP = "Enter the code we emailed you";
const NOT_DELETED = "Your account was not deleted.";
const SIGNED_OUT_NOTICE = [
  "You're signed out.",
  "We couldn't confirm the delete.",
  "If you sign in and your data is still there, delete it again under Account.",
].join(" ");
const DELETED_NOTICE = "Your account was deleted. If you sign up again, you get a new, empty account.";
const EMAIL_SCREEN = "Continue with email";

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("App: account delete 401, lost response and a failing session clear (HEN-329)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let secureStore: ReturnType<typeof createMemorySecureStore>;
  let logged: string[];

  const isDelete = (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    return request.method === "DELETE" && new URL(request.url).pathname === "/account";
  };
  let codeReplies: Fetch[] = [];
  const isCodeRequest = (input: string | URL | Request, init?: RequestInit) => {
    return new URL(new Request(input, init).url).pathname === "/account/delete-code";
  };

  const signInAndOpenCodeStep = async (deleteReplies: readonly Fetch[] = []) => {
    const replies = [...deleteReplies];
    const replyFor = (input: string | URL | Request, init?: RequestInit) => {
      if (isDelete(input, init)) {
        return replies.shift();
      }
      return isCodeRequest(input, init) ? codeReplies.shift() : undefined;
    };
    const fetchImplementation: Fetch = (input, init) => {
      const reply = replyFor(input, init);
      return reply ? reply(input, init) : backend.fetchImplementation(input, init);
    };
    appClient.store = secureStore;
    appClient.current = createMobileAuthClient({ backendUrl: TEST_BACKEND_URL, storage: secureStore, fetchImplementation });
    const screen = await renderScreen(createElement(App));
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", "member@example.test");
    await screen.press(EMAIL_SCREEN);
    await screen.changeText("6-digit code", "123456");
    await settle();
    if (screen.text().includes("Not now")) {
      await screen.press("Not now");
    }
    await screen.press("Delete account");
    await screen.press("Email me a code");
    await screen.changeText("6-digit code", TEST_DELETE_CODE);
    return screen;
  };

  const pressDelete = async (screen: Awaited<ReturnType<typeof signInAndOpenCodeStep>>) => {
    await screen.press("Delete my account");
    await settle();
  };

  const lostResponse = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    await backend.fetchImplementation(input, init);
    throw new TypeError("Network request failed");
  };
  const status = (code: number) => () => Promise.resolve(jsonResponse({ error: "Refused" }, code));

  beforeEach(() => {
    backend = createFakeBackend();
    secureStore = createMemorySecureStore();
    seedPendingSignIn(secureStore);
    deepLinkState.url = null;
    resetBackListeners();
    logged = [];
    codeReplies = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...parts: unknown[]) => {
        logged.push(
          parts.map((part) => (part instanceof Error ? `${part.message} ${part.stack ?? ""}` : (JSON.stringify(part) ?? String(part)))).join(" "),
        );
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const expectPoliteNotice = (screen: Awaited<ReturnType<typeof signInAndOpenCodeStep>>, message: string) => {
    const notice = screen.queryByText(message);
    expect(notice?.props).toMatchObject({ accessibilityLiveRegion: "polite" });
    expect(notice?.props.accessibilityRole).toBeUndefined();
  };

  it("a retry that gets 401 after a lost response signs out to the email screen with neutral copy, never deleted or not deleted", async () => {
    const screen = await signInAndOpenCodeStep([lostResponse, status(401)]);

    await pressDelete(screen);
    expect(screen.text()).toContain(CODE_STEP);
    expect(screen.text()).not.toContain(NOT_DELETED);
    await pressDelete(screen);

    expect(screen.text()).toContain(SIGNED_OUT_NOTICE);
    expect(screen.text()).toContain(EMAIL_SCREEN);
    expect(screen.text()).not.toContain(CODE_STEP);
    expect(screen.text()).not.toContain("deleted");
    expect(secureStore.items.has("bjjroll_cookie")).toBe(false);
    expectPoliteNotice(screen, SIGNED_OUT_NOTICE);
  });

  it("a confirmed delete whose phone session clear fails shows the normal deleted copy, leaves the code step and runs the deleted exit", async () => {
    const screen = await signInAndOpenCodeStep();
    secureStore.failingKeys.add("bjjroll_cookie");

    await pressDelete(screen);

    expect(screen.text()).toContain(DELETED_NOTICE);
    expect(screen.text()).not.toContain("reopen");
    expect(screen.text()).toContain(EMAIL_SCREEN);
    expect(screen.text()).not.toContain(CODE_STEP);
    expect(screen.text()).not.toContain(NOT_DELETED);
    expectPoliteNotice(screen, DELETED_NOTICE);
  });

  it("a session clear that fails once after a confirmed delete is tried once more in the background", async () => {
    const screen = await signInAndOpenCodeStep();
    secureStore.deleteItemAsync.mockRejectedValueOnce(new Error("SecureStore write failed"));

    await pressDelete(screen);

    expect(screen.text()).toContain(DELETED_NOTICE);
    expect(secureStore.items.has("bjjroll_cookie")).toBe(false);
  });

  it.each([
    [500, failureMessages.unknown],
    [503, failureMessages.unknown],
    [429, failureMessages.rateLimited],
  ])("a %i on the first delete stays red on the code step", async (code, message) => {
    const screen = await signInAndOpenCodeStep([status(code)]);

    await pressDelete(screen);

    expect(screen.text()).toContain(CODE_STEP);
    const error = screen.queryByText(`${NOT_DELETED} ${message}`);
    expect(flattenStyle(error?.props.style)).toMatchObject({ color: colours.danger });
    expect(screen.text()).not.toContain(SIGNED_OUT_NOTICE);
    expect(secureStore.items.has("bjjroll_cookie")).toBe(true);
  });

  it("a 401 on the first delete signs out to the email screen with the same neutral copy", async () => {
    const screen = await signInAndOpenCodeStep([status(401)]);

    await pressDelete(screen);

    expect(screen.text()).toContain(SIGNED_OUT_NOTICE);
    expect(screen.text()).toContain(EMAIL_SCREEN);
    expect(screen.text()).not.toContain(CODE_STEP);
    expect(screen.text()).not.toContain(NOT_DELETED);
    expect(secureStore.items.has("bjjroll_cookie")).toBe(false);
  });

  it("a 401 on a new delete code request keeps today's red error on the code step and stays signed in", async () => {
    const screen = await signInAndOpenCodeStep();
    codeReplies = [status(401)];

    await screen.press("Send a new code");
    await settle();

    expect(screen.text()).toContain(CODE_STEP);
    expect(screen.text()).toContain(`We could not send the code. ${failureMessages.unknown}`);
    expect(screen.text()).not.toContain(SIGNED_OUT_NOTICE);
    expect(secureStore.items.has("bjjroll_cookie")).toBe(true);
  });

  it("logs no session token, cookie or delete code on the lost-response retry or the failing session clear", async () => {
    const retry = await signInAndOpenCodeStep([lostResponse, status(401)]);
    await pressDelete(retry);
    await pressDelete(retry);
    secureStore = createMemorySecureStore();
    seedPendingSignIn(secureStore);
    const sessionLeft = await signInAndOpenCodeStep();
    secureStore.failingKeys.add("bjjroll_cookie");
    await pressDelete(sessionLeft);

    const output = logged.join("\n");
    for (const secret of ["signed-session-value", "raw-session-token", "session_token", TEST_DELETE_CODE]) {
      expect(output).not.toContain(secret);
    }
  });
});
