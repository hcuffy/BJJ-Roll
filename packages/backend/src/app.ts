import { Hono } from "hono";
import { createAuth, mountAuthRoutes, type AuthInstance, type CreateAuthOptions } from "./auth/createAuth.js";

export interface CreateAppOptions {
  readonly auth?: Pick<AuthInstance, "handler"> | CreateAuthOptions;
}

export function createApp(options?: CreateAppOptions): Hono {
  const honoApp = new Hono();

  honoApp.get("/health", (context) => context.json({ status: "ok" }));

  if (options?.auth) {
    const authInstance = "handler" in options.auth ? options.auth : createAuth(options.auth);
    mountAuthRoutes(honoApp, authInstance);
  }

  return honoApp;
}

export const app = createApp();
