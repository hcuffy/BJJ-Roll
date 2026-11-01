import type { BetterAuthOptions } from "better-auth";
import { getEndpoints } from "better-auth/api";
import { AUTH_BASE_PATH } from "./authRequestGuards.js";

export const authRoutesAllowList = [
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
] as const;

const allowedRoutePaths = new Set<string>(authRoutesAllowList);
const allowedRoutePatterns = authRoutesAllowList.map((routePath) => new RegExp(`^${routePath.replaceAll(/:[^/]+/gu, "[^/]+")}$`, "u"));
const routerContextNeverAwaited = new Promise<never>(() => undefined);

export function withAuthRoutesAllowList<const Options extends BetterAuthOptions>(options: Options): Options {
  const routerPaths = Object.values(getEndpoints(routerContextNeverAwaited, options).api).map((endpoint) => endpoint.path);
  const disabledPaths = routerPaths.filter((routePath): routePath is string => routePath !== undefined && !allowedRoutePaths.has(routePath));
  return { ...options, disabledPaths };
}

export function isAllowListedAuthPath(pathname: string): boolean {
  if (!pathname.startsWith(`${AUTH_BASE_PATH}/`)) {
    return false;
  }
  const routePath = pathname.slice(AUTH_BASE_PATH.length);
  return allowedRoutePatterns.some((pattern) => pattern.test(routePath));
}
