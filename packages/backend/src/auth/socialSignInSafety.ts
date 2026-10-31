import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { APIError } from "better-auth/api";
import { verifyProviderIdToken } from "better-auth/oauth2";
import type { BetterAuthOptions } from "better-auth/types";
import type { Pool } from "pg";
import { currentDate, secondsAfter } from "../dates.js";
import type { AuthMiddlewareContext } from "./types.js";

const MIN_NONCE_LENGTH = 16;
const MAX_NONCE_LENGTH = 256;
const USED_NONCE_RETENTION_SECONDS = 65 * 60;
const USED_NONCE_IDENTIFIER_PREFIX = "apple-id-token-nonce:";

const invalidToken = (): APIError => new APIError("UNAUTHORIZED", { code: "INVALID_TOKEN", message: "Invalid token" });

const socialSignInNotLinked = (): APIError => new APIError("UNAUTHORIZED", { code: "OAUTH_LINK_ERROR", message: "account not linked" });

function isProviderEmailVerified(profile: Record<string, unknown> | undefined): boolean {
  const claim = profile?.email_verified;
  return claim === true || claim === "true";
}

export const refuseUnverifiedProviderEmail: NonNullable<NonNullable<BetterAuthOptions["user"]>["validateUserInfo"]> = ({ source }) =>
  source.method === "oauth" && !isProviderEmailVerified(source.oauth?.profile) ? { error: "account_not_linked" } : undefined;

function decodeClaims(token: string): Record<string, unknown> | null {
  const payload = token.split(".")[1];
  if (!payload) {
    return null;
  }
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof claims === "object" && claims !== null ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function sameText(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export async function claimNonceOnce(pool: Pool, nonceClaim: string): Promise<boolean> {
  const identifier = `${USED_NONCE_IDENTIFIER_PREFIX}${nonceClaim}`;
  const now = currentDate();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE bjj_app");
    await client.query("SELECT set_config('app.verification_identifier', $1, true)", [identifier]);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [identifier]);
    await client.query("DELETE FROM public.verifications WHERE starts_with(identifier, $1) AND expires_at < now()", [USED_NONCE_IDENTIFIER_PREFIX]);
    const used = await client.query("SELECT 1 FROM public.verifications WHERE identifier = $1 LIMIT 1", [identifier]);
    if (used.rowCount === 0) {
      await client.query(
        `INSERT INTO public.verifications (id, identifier, value, expires_at, created_at, updated_at) VALUES ($1, $2, 'used', $3, $4, $4)`,
        [randomUUID(), identifier, secondsAfter(now, USED_NONCE_RETENTION_SECONDS), now],
      );
    }
    await client.query("COMMIT");
    return used.rowCount === 0;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function refuseUnsafeAppleIdToken(middlewareContext: AuthMiddlewareContext, pool: Pool): Promise<void> {
  const body = middlewareContext.body as Record<string, unknown> | undefined;
  if (middlewareContext.path !== "/sign-in/social" || body?.provider !== "apple" || body.idToken === undefined) {
    return;
  }
  const idToken = (typeof body.idToken === "object" && body.idToken !== null ? body.idToken : {}) as Record<string, unknown>;
  const { token, nonce } = idToken;
  if (typeof token !== "string" || typeof nonce !== "string" || nonce.length < MIN_NONCE_LENGTH || nonce.length > MAX_NONCE_LENGTH) {
    throw invalidToken();
  }
  const claims = decodeClaims(token);
  const nonceClaim = claims?.nonce;
  if (typeof nonceClaim !== "string" || !sameText(nonceClaim, createHash("sha256").update(nonce).digest("hex"))) {
    throw invalidToken();
  }
  const providers = middlewareContext.context.socialProviders;
  const apple = providers.find((provider) => provider.id === "apple");
  if (!apple || !(await verifyProviderIdToken(apple, token, nonce, middlewareContext))) {
    throw invalidToken();
  }
  if (!(await claimNonceOnce(pool, nonceClaim))) {
    throw invalidToken();
  }
  if (!isProviderEmailVerified(claims ?? undefined)) {
    throw socialSignInNotLinked();
  }
}

export function neutralizeAccountNotLinkedRedirect(middlewareContext: AuthMiddlewareContext): void {
  const location = middlewareContext.context.responseHeaders?.get("location");
  if (!middlewareContext.path.startsWith("/callback/") || !location) {
    return;
  }
  const queryStart = location.indexOf("?");
  const query = new URLSearchParams(queryStart === -1 ? "" : location.slice(queryStart + 1));
  if (query.get("error") !== "account_not_linked" || !query.has("error_description")) {
    return;
  }
  query.delete("error_description");
  middlewareContext.setHeader("location", `${location.slice(0, queryStart)}?${query.toString()}`);
}
