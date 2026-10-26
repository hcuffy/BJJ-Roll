import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { APIError, type createAuthMiddleware } from "better-auth/api";
import { verifyProviderIdToken } from "better-auth/oauth2";
import type { BetterAuthOptions } from "better-auth/types";
import type { Pool } from "pg";

type AuthMiddlewareContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

const MIN_NONCE_LENGTH = 16;
const MAX_NONCE_LENGTH = 256;
/** Apple identity tokens are accepted for at most an hour (Better Auth's maxTokenAge); a used nonce is remembered a little longer. */
const USED_NONCE_RETENTION_SECONDS = 65 * 60;
const USED_NONCE_IDENTIFIER_PREFIX = "apple-id-token-nonce:";

const invalidToken = (): APIError => new APIError("UNAUTHORIZED", { code: "INVALID_TOKEN", message: "Invalid token" });

/**
 * The same response Better Auth gives when a provider email matches an account it may not link to. Unverified emails get it whether
 * or not an account exists, so the answer never tells anyone which emails have a BJJ Roll account.
 */
export const socialSignInNotLinked = (): APIError => new APIError("UNAUTHORIZED", { code: "OAUTH_LINK_ERROR", message: "account not linked" });

/** True only for a provider's explicit "verified" claim (Google sends a boolean, Apple a boolean or "true"). Missing means unverified. */
export function isProviderEmailVerified(profile: Record<string, unknown> | undefined): boolean {
  const claim = profile?.email_verified;
  return claim === true || claim === "true";
}

/**
 * `user.validateUserInfo` gate (HEN-239): an Apple or Google email counts only with an explicit verified claim. Runs on sign-up, link
 * and returning sign-in, and refuses with the same code Better Auth uses when an account exists, so no answer reveals one.
 */
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

/** Records a nonce claim as used; false when it was already used. One row per claim, under the verifications exact-key RLS policy. */
export async function claimNonceOnce(pool: Pool, nonceClaim: string): Promise<boolean> {
  const identifier = `${USED_NONCE_IDENTIFIER_PREFIX}${nonceClaim}`;
  const now = new Date();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE bjj_app");
    await client.query("SELECT set_config('app.verification_identifier', $1, true)", [identifier]);
    // Serialises two requests carrying the same token, so exactly one of them can claim it.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [identifier]);
    // No cleanup job: each new claim also removes expired used-nonce rows (migration 003 lets bjj_app reach only those).
    await client.query("DELETE FROM public.verifications WHERE starts_with(identifier, $1) AND expires_at < now()", [USED_NONCE_IDENTIFIER_PREFIX]);
    const used = await client.query("SELECT 1 FROM public.verifications WHERE identifier = $1 LIMIT 1", [identifier]);
    if (used.rowCount === 0) {
      await client.query(
        `INSERT INTO public.verifications (id, identifier, value, expires_at, created_at, updated_at) VALUES ($1, $2, 'used', $3, $4, $4)`,
        [randomUUID(), identifier, new Date(now.getTime() + USED_NONCE_RETENTION_SECONDS * 1000), now],
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

/**
 * Before-hook for native Apple sign-in (POST /sign-in/social with an idToken). The app sends Apple SHA-256(raw nonce) and sends the
 * backend the raw nonce. Refused unless: the raw nonce is present; the token's nonce claim is exactly its SHA-256 (Better Auth alone
 * would also accept the claim itself, which anyone holding the token can read); the token verifies (Apple's key, aud, iss, exp); the
 * nonce has not been used before; and Apple says the email is verified.
 */
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

/**
 * After-hook for the browser callback. Better Auth refuses an existing account's unverified email with `?error=account_not_linked`,
 * while the validateUserInfo gate (new accounts) adds an error_description. Dropping it makes both refusals the same redirect.
 */
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
