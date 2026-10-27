import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { AUTH_BASE_PATH } from "./authRequestGuards.js";
import type { AuthInstance } from "./createAuth.js";

export function readSocketAddress(context: Context): string | undefined {
  try {
    return getConnInfo(context).remote.address;
  } catch {
    return undefined;
  }
}

// 32 KiB covers an email, a one-time code, and a short deep link, and still rejects oversized auth bodies.
export const AUTH_REQUEST_BODY_LIMIT_BYTES = 32 * 1024;

export function mountAuthRoutes(app: Hono, auth: Pick<AuthInstance, "handler">): void {
  app.use(
    `${AUTH_BASE_PATH}/*`,
    bodyLimit({
      maxSize: AUTH_REQUEST_BODY_LIMIT_BYTES,
      onError: (context) => context.text("Payload Too Large", 413),
    }),
  );
  app.on(["GET", "POST"], `${AUTH_BASE_PATH}/*`, async (context) => {
    return await auth.handler(context.req.raw, { remoteAddress: readSocketAddress(context) });
  });
}
