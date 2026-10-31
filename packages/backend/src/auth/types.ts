import type { createAuthMiddleware } from "better-auth/api";

export type AuthMiddlewareContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];
