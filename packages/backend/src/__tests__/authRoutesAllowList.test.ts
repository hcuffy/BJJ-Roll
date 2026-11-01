import type * as BetterAuthModule from "better-auth";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { authRoutesAllowList } from "../auth/authRoutesAllowList.js";
import { createAuth, generateTestAuthSecrets, loadAuthKeyringFromEnvironment } from "../auth/index.js";
import { createDatabase } from "../database/connection.js";
import { FakeEmailSender } from "../email/index.js";
import { InlineEmailQueue } from "./inlineEmailQueue.js";
import { socketEnvironment, testBaseUrl } from "./authTestHelper.js";

interface RouterEndpoint {
  readonly path?: string;
  readonly options?: { readonly method?: string | readonly string[] };
}

interface CapturedBetterAuth {
  readonly api: Record<string, RouterEndpoint>;
  readonly options: { readonly disabledPaths?: readonly string[] };
}

const captured = vi.hoisted(() => ({ instances: [] as unknown[] }));

vi.mock("better-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof BetterAuthModule>();
  return {
    ...actual,
    betterAuth: (options: Parameters<typeof actual.betterAuth>[0]) => {
      const instance = actual.betterAuth(options);
      captured.instances.push(instance);
      return instance;
    },
  };
});

const unavailablePool = {
  connect: () => Promise.reject(new Error("database unavailable")),
  query: () => Promise.reject(new Error("database unavailable")),
  on: () => undefined,
  end: () => Promise.resolve(),
} as unknown as Pool;

const allowList: readonly string[] = authRoutesAllowList;
const batchOneAllowList = [
  "/email-otp/send-verification-otp",
  "/sign-in/email-otp",
  "/sign-in/magic-link",
  "/magic-link/verify",
  "/magic-link/exchange",
  "/sign-in/social",
  "/callback/:id",
  "/get-session",
  "/sign-out",
  "/expo-authorization-proxy",
  "/ok",
  "/error",
];
const closedRoutes = [
  "/email-otp/reset-password",
  "/request-password-reset",
  "/forget-password/email-otp",
  "/email-otp/verify-email",
  "/link-social",
];

const mobileSourceRoot = fileURLToPath(new URL("../../../mobile/src/", import.meta.url));

function mobileAuthPaths(): string[] {
  const sources = readdirSync(mobileSourceRoot, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/u.test(file) && !file.startsWith("__tests__"))
    .map((file) => readFileSync(join(mobileSourceRoot, file), "utf8"))
    .join("\n");
  const literalPaths = [...sources.matchAll(/(?:path: |\$fetch(?:<[^>]*>)?\()"(\/[^"]+)"/gu)].map((match) => match[1] ?? "");
  const authUrlPaths = [...sources.matchAll(/\/api\/auth(\/[a-z/-]+)/gu)].map((match) => match[1] ?? "");
  const clientMethodPaths = [...sources.matchAll(/client\.(getSession|signOut)\(/gu)].map((match) =>
    (match[1] ?? "").replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`),
  );
  const paths = [...literalPaths, ...authUrlPaths, ...clientMethodPaths.map((name) => `/${name}`)];
  return [...new Set(paths.filter((routePath) => !routePath.startsWith("/account")))].sort();
}

function concretePath(routePath: string): string {
  return routePath.replaceAll(/:[^/]+/gu, "sample-value");
}

function methodsOf(endpoint: RouterEndpoint): string[] {
  const method = endpoint.options?.method ?? "GET";
  return (typeof method === "string" ? [method] : [...method]).map((name) => (name === "*" ? "GET" : name));
}

describe("B1 auth route allow-list", () => {
  const emailSender = new FakeEmailSender();
  const auth = createAuth({
    pool: unavailablePool,
    emailSender,
    emailQueue: new InlineEmailQueue(emailSender),
    keyring: loadAuthKeyringFromEnvironment(generateTestAuthSecrets()),
    baseURL: testBaseUrl,
  });
  const app = createApp({ auth, database: createDatabase(unavailablePool) });
  let router: CapturedBetterAuth;
  let routerEndpoints: RouterEndpoint[];

  beforeAll(() => {
    router = captured.instances.at(-1) as CapturedBetterAuth;
    routerEndpoints = Object.values(router.api).filter((endpoint) => typeof endpoint.path === "string");
  });

  const send = (method: string, routePath: string) =>
    app.request(
      `${testBaseUrl}/api/auth${routePath}`,
      { method, headers: method === "GET" ? {} : { "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" },
      socketEnvironment("198.51.100.240"),
    );

  it("the allow-list and the served router paths are exactly the 12 Batch 1 paths", () => {
    const disabledPaths = router.options.disabledPaths ?? [];
    const servedPaths = routerEndpoints.map((endpoint) => endpoint.path ?? "").filter((routePath) => !disabledPaths.includes(routePath));
    expect([...allowList].sort()).toEqual([...batchOneAllowList].sort());
    expect([...new Set(servedPaths)].sort()).toEqual([...batchOneAllowList].sort());
  });

  it("every Better Auth router path is either allow-listed or disabled", () => {
    const routerPaths = routerEndpoints.map((endpoint) => endpoint.path ?? "");
    const disabledPaths = router.options.disabledPaths ?? [];
    expect(allowList.filter((routePath) => !routerPaths.includes(routePath))).toEqual([]);
    expect(disabledPaths.filter((routePath) => allowList.includes(routePath))).toEqual([]);
    expect(routerPaths.filter((routePath) => !allowList.includes(routePath) && !disabledPaths.includes(routePath))).toEqual([]);
  });

  it("every router route that is not allow-listed returns 404, pattern routes included", async () => {
    const closed = routerEndpoints.filter((endpoint) => !allowList.includes(endpoint.path ?? ""));
    expect(closed.some((endpoint) => endpoint.path?.includes(":"))).toBe(true);
    for (const endpoint of closed) {
      for (const method of methodsOf(endpoint)) {
        const response = await send(method, concretePath(endpoint.path ?? ""));
        expect({ method, path: endpoint.path, status: response.status }).toEqual({ method, path: endpoint.path, status: 404 });
      }
    }
  });

  it.each(closedRoutes)("POST /api/auth%s returns 404", async (routePath) => {
    expect((await send("POST", routePath)).status).toBe(404);
  });

  it("allow-listed routes are still served", async () => {
    const open = routerEndpoints.filter((endpoint) => allowList.includes(endpoint.path ?? ""));
    expect(open).toHaveLength(allowList.length);
    for (const endpoint of open) {
      const method = methodsOf(endpoint).at(0) ?? "GET";
      const response = await send(method, concretePath(endpoint.path ?? ""));
      expect({ path: endpoint.path, served: response.status !== 404 }).toEqual({ path: endpoint.path, served: true });
    }
  });

  it("every auth path the mobile app calls is allow-listed and served, never 404, sign-out included", async () => {
    const appPaths = mobileAuthPaths();
    expect(appPaths).toEqual([
      "/email-otp/send-verification-otp",
      "/expo-authorization-proxy",
      "/get-session",
      "/magic-link/exchange",
      "/sign-in/email-otp",
      "/sign-in/magic-link",
      "/sign-in/social",
      "/sign-out",
    ]);
    for (const routePath of appPaths) {
      const endpoint = routerEndpoints.find((candidate) => candidate.path === routePath);
      const method = endpoint ? (methodsOf(endpoint).at(0) ?? "GET") : "POST";
      const response = await send(method, routePath);
      expect({ routePath, allowListed: allowList.includes(routePath), served: response.status !== 404 }).toEqual({
        routePath,
        allowListed: true,
        served: true,
      });
    }
  });

  it("unknown auth paths return 404", async () => {
    expect((await send("GET", "/not-a-route")).status).toBe(404);
  });
});
