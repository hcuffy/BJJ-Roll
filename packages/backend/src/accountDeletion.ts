import { accountDeletionRequestSchema, type AccountDeletionCodeResponse, type AccountDeletionResponse } from "@bjj-roll/shared";
import type { Context } from "hono";
import type { AccountRoutesOptions } from "./accountRoutes.js";
import { cascadeDeleteUserAccount } from "./database/cascadeDelete.js";
import { withUserContext } from "./database/connection.js";
import { EmailSendError } from "./email/index.js";

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

async function queueAppleRevokeRetry(options: AccountRoutesOptions, userId: string, sealedRefreshToken: string): Promise<void> {
  try {
    if (!options.appleRevokeRetries) {
      throw new Error("No Apple revoke retry queue");
    }
    await options.appleRevokeRetries.enqueue(sealedRefreshToken);
    options.logAccountEvent("account_apple_revoke_queued", userId);
  } catch {
    options.logAccountEvent("account_apple_revoke_not_queued", userId);
  }
}

async function revokeAppleSignIn(options: AccountRoutesOptions, userId: string): Promise<void> {
  const rows = await withUserContext(options.db, userId, (transaction) =>
    transaction.selectFrom("accounts").select(["refreshToken"]).where("userId", "=", userId).where("providerId", "=", "apple").execute(),
  );
  for (const { refreshToken } of rows) {
    if (!refreshToken) {
      options.logAccountEvent("account_apple_revoke_skipped", userId, { reason: "no_refresh_token" });
      continue;
    }
    try {
      if (!options.revokeAppleRefreshToken) {
        throw new Error("Apple sign-in is not configured");
      }
      await options.revokeAppleRefreshToken(refreshToken);
    } catch {
      options.logAccountEvent("account_apple_revoke_failed", userId);
      await queueAppleRevokeRetry(options, userId, refreshToken);
    }
  }
}

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
  const result = await cascadeDeleteUserAccount(options.db, userId);
  if (result.deletedUserCount === 0) {
    return context.json({ error: "User not found" }, 404);
  }
  options.logAccountEvent("account_deleted", userId);
  try {
    await options.emailQueue.enqueue(
      { kind: "account_deleted_notice", input: { to: capturedEmail } },
      { idempotencyKey: `account-deleted:${userId}` },
    );
  } catch (error) {
    options.logAccountEvent("account_deletion_email_failed", userId, { reason: error instanceof EmailSendError ? error.reason : "unknown" });
  }
  const response: AccountDeletionResponse = { deleted: true };
  return context.json(response, 200);
}
