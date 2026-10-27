import {
  AGE_CONFIRMATION_TEXT_VERSION_ID,
  accountExportSchema,
  adultConfirmationRequestSchema,
  socialProviderNames,
  type AccountExport,
  type AgeConfirmationStatus,
  type SocialProviderName,
} from "@bjj-roll/shared";
import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import type { Kysely } from "kysely";
import { handleDeleteAccount, handleSendAccountDeletionCode } from "./accountDeletion.js";
import type { AccountDeletionAttempts } from "./auth/accountDeletionAttempts.js";
import type { AccountDeletionCodes } from "./auth/accountDeletionCodes.js";
import { withUserContext } from "./database/connection.js";
import type { BjjRollDatabase } from "./database/schema.js";
import type { EmailQueue } from "./email/index.js";
import type { AuthenticatedUserIdResolver } from "./handleRoutes.js";

export type AccountEventName = "account_exported" | "account_deleted" | "account_deletion_email_failed" | "account_apple_revoke_failed";

/** One log line per account event: the user id and, for failures, a reason. Never the email or its hash (HEN-65 AC 6, A5). */
export type AccountEventLogger = (event: AccountEventName, userId: string, details?: { readonly reason: string }) => void;

export interface AccountRoutesOptions {
  db: Kysely<BjjRollDatabase>;
  /** The signed-in user from the session; there is no way to name another user (HEN-65 AC 4). */
  resolveAuthenticatedUserId: AuthenticatedUserIdResolver;
  decryptUserEmail: (emailCiphertext: string, keyVersion: number) => string;
  accountDeletionCodes: AccountDeletionCodes;
  /** Counted before every code check, so parallel guesses cannot outrun the attempt limit. */
  accountDeletionAttempts: AccountDeletionAttempts;
  resolveClientIp: (context: Context) => string;
  /** The deleted notice is queued (HEN-284); a failure to queue it is logged and the deletion still succeeds. */
  emailQueue: Pick<EmailQueue, "enqueue">;
  logAccountEvent: AccountEventLogger;
  /** Revokes a stored Apple refresh token before the account is deleted (HEN-239). Absent when Apple is not wired in. */
  revokeAppleRefreshToken?: (sealedRefreshToken: string) => Promise<void>;
}

export type AccountRoutesInput = Omit<AccountRoutesOptions, "logAccountEvent"> & { logAccountEvent?: AccountEventLogger };

/** One JSON line on stdout, the same channel as the server's other operational output. */
const defaultLogAccountEvent: AccountEventLogger = (event, userId, details) => {
  process.stdout.write(`${JSON.stringify({ event, userId, ...details })}\n`);
};

function isSocialProviderName(providerId: string): providerId is SocialProviderName {
  return (socialProviderNames as readonly string[]).includes(providerId);
}

function formatTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function handleExportAccount(context: Context, options: AccountRoutesOptions): Promise<Response> {
  const authenticatedUserId = await options.resolveAuthenticatedUserId(context);
  if (!authenticatedUserId) {
    return context.json({ error: "Authentication required" }, 401);
  }
  const { row, consentRecords } = await withUserContext(options.db, authenticatedUserId, async (transaction) => ({
    row: await transaction
      .selectFrom("users")
      .select(["id", "emailCiphertext", "keyVersion", "handle", "createdAt"])
      .where("id", "=", authenticatedUserId)
      .executeTakeFirst(),
    consentRecords: await selectAgeConfirmationRecords(transaction, authenticatedUserId),
  }));
  if (!row) {
    return context.json({ error: "User not found" }, 404);
  }
  // HEN-239: linked sign-in providers by name only; no provider ids, tokens or profile data.
  const providerRows = await withUserContext(options.db, authenticatedUserId, (transaction) =>
    transaction.selectFrom("accounts").select(["providerId"]).where("userId", "=", authenticatedUserId).execute(),
  );
  const linkedProviders = [...new Set(providerRows.map((providerRow) => providerRow.providerId))].filter(isSocialProviderName).sort();
  // Parsing with the strict schema keeps the export to the listed M2 fields.
  const exported: AccountExport = accountExportSchema.parse({
    exportedAt: new Date().toISOString(),
    user: {
      id: row.id,
      email: options.decryptUserEmail(row.emailCiphertext, row.keyVersion),
      handle: row.handle,
      createdAt: formatTimestamp(row.createdAt),
      linkedProviders,
    },
    consentRecords: consentRecords.map((record) => ({
      ...record,
      acceptedAt: formatTimestamp(record.acceptedAt),
      withdrawnAt: record.withdrawnAt === null ? null : formatTimestamp(record.withdrawnAt),
    })),
  });
  options.logAccountEvent("account_exported", authenticatedUserId);
  context.header("Cache-Control", "no-store");
  return context.json(exported, 200);
}

function selectAgeConfirmationRecords(transaction: Kysely<BjjRollDatabase>, userId: string) {
  return transaction
    .selectFrom("consentRecords")
    .select(["id", "userId", "consentType", "textVersionId", "age16Confirmed", "age18Confirmed", "acceptedAt", "withdrawnAt"])
    .where("userId", "=", userId)
    .where("consentType", "=", "age_confirmation")
    .orderBy("acceptedAt")
    .orderBy("id")
    .execute();
}

/** HEN-263: the latest age record decides; no record (or a sign-up without the 18+ tick) means no purchases. */
async function readAgeConfirmationStatus(transaction: Kysely<BjjRollDatabase>, userId: string): Promise<AgeConfirmationStatus> {
  const records = await selectAgeConfirmationRecords(transaction, userId);
  const latest = records.at(-1);
  const age18Confirmed = latest?.age18Confirmed === true && latest.withdrawnAt === null;
  return { age16Confirmed: latest?.age16Confirmed === true, age18Confirmed, canPurchase: age18Confirmed };
}

async function handleReadAgeConfirmation(context: Context, options: AccountRoutesOptions): Promise<Response> {
  const authenticatedUserId = await options.resolveAuthenticatedUserId(context);
  if (!authenticatedUserId) {
    return context.json({ error: "Authentication required" }, 401);
  }
  const status = await withUserContext(options.db, authenticatedUserId, (transaction) => readAgeConfirmationStatus(transaction, authenticatedUserId));
  context.header("Cache-Control", "no-store");
  return context.json(status, 200);
}

/** A later "I am 18 or older" is a new record with its own timestamp; records are never updated, so it cannot be undone. */
async function handleConfirmAdult(context: Context, options: AccountRoutesOptions): Promise<Response> {
  const authenticatedUserId = await options.resolveAuthenticatedUserId(context);
  if (!authenticatedUserId) {
    return context.json({ error: "Authentication required" }, 401);
  }
  const body: unknown = await context.req.json().catch(() => undefined);
  if (!adultConfirmationRequestSchema.safeParse(body).success) {
    return context.json({ error: "Invalid request" }, 400);
  }
  const status = await withUserContext(options.db, authenticatedUserId, async (transaction) => {
    await transaction
      .insertInto("consentRecords")
      .values({
        id: randomUUID(),
        userId: authenticatedUserId,
        consentType: "age_confirmation",
        textVersionId: AGE_CONFIRMATION_TEXT_VERSION_ID,
        age16Confirmed: true,
        age18Confirmed: true,
      })
      .execute();
    return readAgeConfirmationStatus(transaction, authenticatedUserId);
  });
  context.header("Cache-Control", "no-store");
  return context.json(status, 200);
}

/** GET /account/export, GET/POST /account/age-confirmation, POST /account/delete-code and DELETE /account, for the signed-in user only (HEN-65). */
export function createAccountRoutes(input: AccountRoutesInput): Hono {
  const options: AccountRoutesOptions = { ...input, logAccountEvent: input.logAccountEvent ?? defaultLogAccountEvent };
  const routes = new Hono();
  routes.get("/account/export", (context) => handleExportAccount(context, options));
  routes.get("/account/age-confirmation", (context) => handleReadAgeConfirmation(context, options));
  routes.post("/account/age-confirmation", (context) => handleConfirmAdult(context, options));
  routes.post("/account/delete-code", (context) => handleSendAccountDeletionCode(context, options));
  routes.delete("/account", (context) => handleDeleteAccount(context, options));
  return routes;
}

export function mountAccountRoutes(targetApp: Hono, options: AccountRoutesInput): Hono {
  return targetApp.route("/", createAccountRoutes(options));
}
