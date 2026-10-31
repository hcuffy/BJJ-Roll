import { beforeEach, describe, expect, it } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import { addPendingSignOut, PENDING_SIGN_OUT_KEY } from "../auth/pendingSignOuts";
import { cancelPendingSignOut } from "../auth/signInActions";
import { createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";

const cookieOf = (token: string) => `better-auth.session_token=${token}.signature`;
const SESSION_PATTERN = /better-auth\.session_token=([^.;]+)\./u;

describe("cancelPendingSignOut with two arguments", () => {
  let secureStore: ReturnType<typeof createMemorySecureStore>;
  let presented: string[];
  let client: ReturnType<typeof createMobileAuthClient>;

  beforeEach(() => {
    secureStore = createMemorySecureStore();
    presented = [];
    const fetchImplementation = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const request = new Request(input, init);
      if (!new URL(request.url).pathname.endsWith("/sign-out")) {
        return Promise.resolve(Response.json({}));
      }
      const session = SESSION_PATTERN.exec(request.headers.get("cookie") ?? "")?.[1] ?? "no-cookie";
      presented.push(session);
      return Promise.resolve(session === "refused" ? Response.json({ message: "down" }, { status: 503 }) : Response.json({ success: true }));
    };
    client = createMobileAuthClient({ backendUrl: TEST_BACKEND_URL, storage: secureStore, fetchImplementation });
  });

  it("ends each queued old session and keeps the one the server did not confirm", async () => {
    await addPendingSignOut(secureStore, cookieOf("ended"));
    await addPendingSignOut(secureStore, cookieOf("refused"));

    await cancelPendingSignOut(client, secureStore);

    expect(presented).toEqual(["ended", "refused"]);
    const stored = secureStore.items.get(PENDING_SIGN_OUT_KEY) ?? "";
    expect(stored).toContain(cookieOf("refused"));
    expect(stored).not.toContain(cookieOf("ended"));
  });
});
