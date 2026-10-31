// The pending sign-out queue stays small, stops retrying sessions the server says are gone, never loses an entry to a race,
// and fails safe on bad stored data (HEN-315, Sara's calls 2026-10-29).
import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import { addPendingSignOut, dropPendingSignOut, PENDING_SIGN_OUT_KEY, SESSION_MAX_LIFETIME_DAYS } from "../auth/pendingSignOuts";
import { finishPendingSignOut, signOut } from "../auth/signInActions";
import { createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";

const DAY_MS = 24 * 60 * 60 * 1000;
const cookieOf = (token: string) => `better-auth.session_token=${token}.signature`;
const SESSION_PATTERN = /better-auth\.session_token=([^.;]+)\./u;
/** Requests that present no session cookie (the stored session is gone from the phone). */
const NO_COOKIE = "no-cookie";

type SignOutAnswer = number | "hang";

/** `/sign-out` answers per presented session token (default 200) and records the order the sessions were presented in. */
function createSignOutServer() {
  const answers = new Map<string, SignOutAnswer>();
  const presented: string[] = [];
  const fetchImplementation = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    if (!new URL(request.url).pathname.endsWith("/sign-out")) {
      return Response.json({});
    }
    const session = SESSION_PATTERN.exec(request.headers.get("cookie") ?? "")?.[1] ?? NO_COOKIE;
    presented.push(session);
    const answer = answers.get(session) ?? 200;
    if (answer === "hang") {
      return await new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))),
      );
    }
    return Response.json(answer < 400 ? { success: true } : { message: "refused" }, { status: answer });
  };
  return { answers, presented, fetchImplementation };
}

describe("Pending sign-out queue hardening (HEN-315)", () => {
  let server: ReturnType<typeof createSignOutServer>;
  let secureStore: ReturnType<typeof createMemorySecureStore>;
  let client: ReturnType<typeof createMobileAuthClient>;
  let consoleSpies: { readonly mock: { readonly calls: readonly (readonly unknown[])[] } }[] = [];

  /** Stores the queue as the app writes it: oldest first, each with the time it was queued. */
  const storeQueue = (...entries: readonly { readonly token: string; readonly ageDays: number }[]) =>
    secureStore.items.set(
      PENDING_SIGN_OUT_KEY,
      JSON.stringify(entries.map(({ token, ageDays }) => ({ marker: cookieOf(token), queuedAt: Date.now() - ageDays * DAY_MS }))),
    );
  const queued = () => secureStore.items.get(PENDING_SIGN_OUT_KEY) ?? "";

  beforeEach(() => {
    server = createSignOutServer();
    secureStore = createMemorySecureStore();
    client = createMobileAuthClient({ backendUrl: TEST_BACKEND_URL, storage: secureStore, fetchImplementation: server.fetchImplementation });
    consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
  });
  afterEach(() => {
    const logged = consoleSpies
      .flatMap((spy) => spy.mock.calls.flat<readonly (readonly unknown[])[]>())
      .map((value) => inspect(value, { depth: 8 }))
      .join("\n");
    for (const secret of ["session-", "signature", "session_token", "garbage"]) {
      expect(logged).not.toContain(secret);
    }
    vi.restoreAllMocks();
  });

  describe("cap: only entries past the server's maximum session lifetime are dropped", () => {
    it("the app's lifetime matches the backend's absolute maximum session lifetime", () => {
      const backendLimits = readFileSync(new URL("../../../backend/src/auth/authLimits.ts", import.meta.url), "utf8");
      expect(backendLimits).toContain(`export const SESSION_ABSOLUTE_MAX_LIFETIME_DAYS = ${String(SESSION_MAX_LIFETIME_DAYS)};`);
    });

    it("an expired entry is dropped without a request, a younger one is kept, and the oldest is retried first", async () => {
      storeQueue(
        { token: "session-expired", ageDays: SESSION_MAX_LIFETIME_DAYS + 1 },
        { token: "session-old", ageDays: SESSION_MAX_LIFETIME_DAYS - 1 },
        { token: "session-new", ageDays: 1 },
      );
      server.answers.set("session-old", 503);

      await finishPendingSignOut(client, secureStore);

      expect(server.presented).toEqual(["session-old", "session-new"]);
      expect(queued()).not.toContain("session-expired");
      expect(queued()).toContain("session-old");
      expect(queued()).not.toContain("session-new");
    });
  });

  describe("server answers: only 401, 404 and 410 mean the session is gone", () => {
    it.each([401, 404, 410])("%i: the session counts as ended and its entry is dropped", async (status) => {
      storeQueue({ token: "session-1", ageDays: 1 });
      server.answers.set("session-1", status);

      await finishPendingSignOut(client, secureStore);

      expect(secureStore.items.has(PENDING_SIGN_OUT_KEY)).toBe(false);
    });

    it("401 for a cookie-less entry (the stored session) also drops it", async () => {
      secureStore.items.set(PENDING_SIGN_OUT_KEY, "1");
      server.answers.set(NO_COOKIE, 401);

      await finishPendingSignOut(client, secureStore);

      expect(secureStore.items.has(PENDING_SIGN_OUT_KEY)).toBe(false);
    });

    it.each([400, 403, 408, 429, 500, 502, 503])("%i: the entry stays queued for a retry", async (status) => {
      storeQueue({ token: "session-1", ageDays: 1 });
      server.answers.set("session-1", status);

      await finishPendingSignOut(client, secureStore);

      expect(queued()).toContain("session-1");
    });

    it("a timeout: the entry stays queued for a retry", async () => {
      storeQueue({ token: "session-1", ageDays: 1 });
      server.answers.set("session-1", "hang");
      const deadline = new AbortController();

      const finished = finishPendingSignOut(client, secureStore, deadline.signal);
      await vi.waitFor(() => expect(server.presented).toEqual(["session-1"]));
      deadline.abort();
      await finished;

      expect(queued()).toContain("session-1");
    });
  });

  it("writes are serialized: an add and a drop that overlap both take effect", async () => {
    secureStore.items.set(PENDING_SIGN_OUT_KEY, cookieOf("session-1"));
    // A keystore read takes a moment, as on a phone, so both changes read the queue before either writes.
    const readNow = secureStore.getItemAsync;
    secureStore.getItemAsync = async (key: string) => {
      const value = await readNow(key);
      await new Promise((resolve) => setTimeout(resolve, 0));
      return value;
    };

    await Promise.all([addPendingSignOut(secureStore, cookieOf("session-2")), dropPendingSignOut(secureStore, cookieOf("session-1"))]);

    expect(queued()).not.toContain("session-1");
    expect(queued()).toContain("session-2");
  });

  describe("legacy single-value marker (before HEN-314)", () => {
    it("a bare cookie is retried with that cookie and cleared once the server confirms", async () => {
      secureStore.items.set(PENDING_SIGN_OUT_KEY, cookieOf("session-1"));

      expect(await finishPendingSignOut(client, secureStore)).toBe(true);

      expect(server.presented).toEqual(["session-1"]);
      expect(secureStore.items.has(PENDING_SIGN_OUT_KEY)).toBe(false);
    });

    it("a bare cookie the server cannot end yet stays queued ahead of a new sign-out", async () => {
      secureStore.items.set(PENDING_SIGN_OUT_KEY, cookieOf("session-1"));

      await addPendingSignOut(secureStore, cookieOf("session-2"));

      expect(queued().indexOf("session-1")).toBeGreaterThanOrEqual(0);
      expect(queued().indexOf("session-1")).toBeLessThan(queued().indexOf("session-2"));
    });

    it('a bare "1" signs out the stored session and is cleared once the server confirms', async () => {
      secureStore.items.set(PENDING_SIGN_OUT_KEY, "1");

      expect(await finishPendingSignOut(client, secureStore)).toBe(true);

      expect(server.presented).toEqual([NO_COOKIE]);
      expect(secureStore.items.has(PENDING_SIGN_OUT_KEY)).toBe(false);
    });
  });

  describe("a corrupt stored queue fails safe (Bill D4)", () => {
    it.each(["[garbage", '[{"marker":42}]', "[null]", "[[]]"])(
      "%s: launch keeps the user signed out, ends the stored session and clears the queue",
      async (corrupt) => {
        secureStore.items.set(PENDING_SIGN_OUT_KEY, corrupt);

        expect(await finishPendingSignOut(client, secureStore)).toBe(true);

        expect(server.presented).toEqual([NO_COOKIE]);
        expect(secureStore.items.has(PENDING_SIGN_OUT_KEY)).toBe(false);
      },
    );

    it("a cut-off JSON queue is wholly unreadable: launch ends the stored session, salvages no entry and clears the queue (HEN-321)", async () => {
      secureStore.items.set("bjjroll_cookie", JSON.stringify({ "better-auth.session_token": { value: "session-stored.signature", expires: null } }));
      storeQueue({ token: "session-old", ageDays: 1 }, { token: "session-older", ageDays: 2 });
      secureStore.items.set(PENDING_SIGN_OUT_KEY, queued().slice(0, queued().indexOf("session-older")));

      expect(await finishPendingSignOut(client, secureStore)).toBe(true);

      expect(server.presented).toEqual(["session-stored"]);
      expect(secureStore.items.get("bjjroll_cookie") ?? "").not.toContain("session-stored");
      expect(secureStore.items.has(PENDING_SIGN_OUT_KEY)).toBe(false);
    });

    it("sign-out still completes: the phone is cleared and the server is told", async () => {
      secureStore.items.set(PENDING_SIGN_OUT_KEY, "[garbage");

      await signOut(client, secureStore);

      expect(server.presented).toContain(NO_COOKIE);
      expect(secureStore.items.has("bjjroll_cookie")).toBe(false);
      expect(secureStore.items.has(PENDING_SIGN_OUT_KEY)).toBe(false);
    });
  });
});
