import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import { addPendingSignOut, dropPendingSignOut, PENDING_SIGN_OUT_KEY, SESSION_MAX_LIFETIME_DAYS } from "../auth/pendingSignOuts";
import { finishPendingSignOut, signOut } from "../auth/signInActions";
import { currentMs } from "../dates";
import { createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";

const DAY_MS = 24 * 60 * 60 * 1000;
const cookieOf = (token: string) => `better-auth.session_token=${token}.signature`;

describe("Pending sign-out queue recovery and expiry cleanup (HEN-328)", () => {
  let secureStore: ReturnType<typeof createMemorySecureStore>;
  let client: ReturnType<typeof createMobileAuthClient>;
  let signOutRequests: number;
  let consoleSpies: { readonly mock: { readonly calls: readonly (readonly unknown[])[] } }[] = [];

  const storeQueue = (...entries: readonly { readonly token: string; readonly ageDays: number }[]) =>
    secureStore.items.set(
      PENDING_SIGN_OUT_KEY,
      JSON.stringify(entries.map(({ token, ageDays }) => ({ marker: cookieOf(token), queuedAt: currentMs() - ageDays * DAY_MS }))),
    );
  const queued = () => secureStore.items.get(PENDING_SIGN_OUT_KEY) ?? "";

  beforeEach(() => {
    secureStore = createMemorySecureStore();
    signOutRequests = 0;
    const fetchImplementation = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (!new URL(new Request(input, init).url).pathname.endsWith("/sign-out")) {
        return Promise.resolve(Response.json({}));
      }
      signOutRequests += 1;
      return Promise.resolve(Response.json({ message: "unavailable" }, { status: 503 }));
    };
    client = createMobileAuthClient({ backendUrl: TEST_BACKEND_URL, storage: secureStore, fetchImplementation });
    consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
  });
  afterEach(() => {
    const logged = consoleSpies
      .flatMap((spy) => spy.mock.calls.flat<readonly (readonly unknown[])[]>())
      .map((value) => inspect(value, { depth: 8 }))
      .join("\n");
    for (const secret of ["session-", "signature", "session_token", "queuedAt", "marker"]) {
      expect(logged).not.toContain(secret);
    }
    vi.restoreAllMocks();
  });

  it("a queue write that fails once reaches its caller, and the add and drop after it still run in order", async () => {
    const writeNow = secureStore.setItemAsync;
    let failures = 1;
    secureStore.setItemAsync = async (key: string, value: string) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("SecureStore write failed");
      }
      await writeNow(key, value);
    };

    const results = await Promise.allSettled([
      addPendingSignOut(secureStore, cookieOf("session-1")),
      addPendingSignOut(secureStore, cookieOf("session-2")),
      addPendingSignOut(secureStore, cookieOf("session-3")),
      dropPendingSignOut(secureStore, cookieOf("session-2")),
    ]);

    expect(results.map(({ status }) => status)).toEqual(["rejected", "fulfilled", "fulfilled", "fulfilled"]);
    expect(queued()).not.toContain("session-1");
    expect(queued()).not.toContain("session-2");
    expect(queued()).toContain("session-3");
  });

  it("a queue whose every entry is past the maximum lifetime is cleared on read, without a sign-out request", async () => {
    storeQueue({ token: "session-old", ageDays: SESSION_MAX_LIFETIME_DAYS + 1 }, { token: "session-older", ageDays: SESSION_MAX_LIFETIME_DAYS + 30 });

    await finishPendingSignOut(client, secureStore);

    expect(signOutRequests).toBe(0);
    expect(secureStore.items.has(PENDING_SIGN_OUT_KEY)).toBe(false);
  });

  it("sign-out over a fully expired queue leaves only the new sign-out queued", async () => {
    storeQueue({ token: "session-old", ageDays: SESSION_MAX_LIFETIME_DAYS + 1 });

    await signOut(client, secureStore);

    expect(queued()).not.toContain("session-old");
    expect(queued()).not.toBe("");
  });

  it("a mixed queue keeps only the live entries once read, even when no sign-out succeeds", async () => {
    storeQueue({ token: "session-expired", ageDays: SESSION_MAX_LIFETIME_DAYS + 1 }, { token: "session-live", ageDays: 1 });

    await finishPendingSignOut(client, secureStore);

    expect(signOutRequests).toBe(1);
    expect(queued()).not.toContain("session-expired");
    expect(queued()).toContain("session-live");
  });
});
