import { accountDeletionRequestSchema, type AccountDeletionCodeResponse, type AccountDeletionResponse } from "@bjj-roll/shared";
import type { Context } from "hono";
import type { AccountRoutesOptions } from "./accountRoutes.js";
import { cascadeDeleteUserAccount } from "./database/cascadeDelete.js";
import { withUserContext } from "./database/connection.js";
import { EmailSendError } from "./email/index.js";

/** The signed-in user's decrypted address, read inside their RLS context. Null when the row is gone. */
async function readOwnEmail(options: AccountRoutesOptions, userId: string): Promise<string | null> {
  const row = await withUserContext(options.db, userId, (transaction) =>
    transaction.selectFrom("users").select(["emailCiphertext", "keyVersion"]).where("id", "=", userId).executeTakeFirst(),
  );
  return row ? options.decryptUserEmail(row.emailCiphertext, row.keyVersion) : null;
}

async function readJsonBody(context: Context): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    return undefined;
  }
}

/** POST /account/delete-code: email a fresh deletion code to the signed-in user's own address (never one from the request). */
export async function handleSendAccountDeletionCode(context: Context, options: AccountRoutesOptions): Promise<Response> {
  const userId = await options.resolveAuthenticatedUserId(context);
  if (!userId) {
    return context.json({ error: "Authentication required" }, 401);
  }
  const email = await readOwnEmail(options, userId);
  if (email === null) {
    return context.json({ error: "User not found" }, 404);
  }
  try {
    if ((await options.accountDeletionCodes.send(email)) === "rate_limited") {
      return context.json({ error: "Too many codes requested. Try again later." }, 429);
    }
  } catch (error) {
    if (error instanceof EmailSendError) {
      return context.json({ error: "Could not send the code. Try again." }, 502);
    }
    throw error;
  }
  await options.accountDeletionAttempts.resetForNewCode(userId);
  const response: AccountDeletionCodeResponse = { sent: true };
  return context.json(response, 200);
}

/**
 * HEN-239: before the purge, revoke the stored Apple refresh token (App Store rule 5.1.1(v)). A failed revoke never blocks the
 * delete: it is logged with the user id only, never the token or email.
 */
async function revokeAppleSignIn(options: AccountRoutesOptions, userId: string): Promise<void> {
  const rows = await withUserContext(options.db, userId, (transaction) =>
    transaction.selectFrom("accounts").select(["refreshToken"]).where("userId", "=", userId).where("providerId", "=", "apple").execute(),
  );
  for (const row of rows) {
    try {
      if (!row.refreshToken || !options.revokeAppleRefreshToken) {
        throw new Error("No Apple refresh token to revoke");
      }
      await options.revokeAppleRefreshToken(row.refreshToken);
    } catch {
      options.logAccountEvent("account_apple_revoke_failed", userId);
    }
  }
}

/**
 * DELETE /account with body { code }: hard delete, now, only with a valid fresh code (Henry, 25 Oct).
 * The address is captured before the purge; the deleted notice goes out after the delete commits, so it is never sent
 * for a delete that did not happen. A failed send does not undo or fail the delete: it is logged with the user id and reason only.
 */
export async function handleDeleteAccount(context: Context, options: AccountRoutesOptions): Promise<Response> {
  const userId = await options.resolveAuthenticatedUserId(context);
  if (!userId) {
    return context.json({ error: "Authentication required" }, 401);
  }
  const parsed = accountDeletionRequestSchema.safeParse(await readJsonBody(context));
  if (!parsed.success) {
    return context.json({ error: "A 6-digit code is required" }, 400);
  }
  if ((await options.accountDeletionAttempts.take(userId, options.resolveClientIp(context))) === "rate_limited") {
    return context.json({ error: "Too many tries. Ask for a new code, or try again later." }, 429);
  }
  const capturedEmail = await readOwnEmail(options, userId);
  if (capturedEmail === null) {
    return context.json({ error: "User not found" }, 404);
  }
  if ((await options.accountDeletionCodes.check(capturedEmail, parsed.data.code)) !== "valid") {
    return context.json({ error: "Invalid or expired code" }, 403);
  }
  await revokeAppleSignIn(options, userId);
  // The user row and every row in the ARCHITECTURE.md §5 map, sessions and this code included, in one transaction.
  const result = await cascadeDeleteUserAccount(options.db, userId);
  if (result.deletedUserCount === 0) {
    return context.json({ error: "User not found" }, 404);
  }
  options.logAccountEvent("account_deleted", userId);
  try {
    await options.emailSender.sendAccountDeletedNotice({ to: capturedEmail });
  } catch (error) {
    options.logAccountEvent("account_deletion_email_failed", userId, { reason: error instanceof EmailSendError ? error.reason : "unknown" });
  }
  const response: AccountDeletionResponse = { deleted: true };
  return context.json(response, 200);
}
