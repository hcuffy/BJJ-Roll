import { accountExportSchema, type AccountExport } from "@bjj-roll/shared";
import { Hono, type Context } from "hono";
import type { Kysely } from "kysely";
import { handleDeleteAccount, handleSendAccountDeletionCode } from "./accountDeletion.js";
import type { AccountDeletionAttempts } from "./auth/accountDeletionAttempts.js";
import type { AccountDeletionCodes } from "./auth/accountDeletionCodes.js";
import { withUserContext } from "./database/connection.js";
import type { BjjRollDatabase } from "./database/schema.js";
import type { EmailSender } from "./email/index.js";
import type { AuthenticatedUserIdResolver } from "./handleRoutes.js";

export type AccountEventName = "account_exported" | "account_deleted" | "account_deletion_email_failed";

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
  emailSender: Pick<EmailSender, "sendAccountDeletedNotice">;
  logAccountEvent: AccountEventLogger;
}

export type AccountRoutesInput = Omit<AccountRoutesOptions, "logAccountEvent"> & { logAccountEvent?: AccountEventLogger };

/** One JSON line on stdout, the same channel as the server's other operational output. */
const defaultLogAccountEvent: AccountEventLogger = (event, userId, details) => {
  process.stdout.write(`${JSON.stringify({ event, userId, ...details })}\n`);
};

function formatTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function handleExportAccount(context: Context, options: AccountRoutesOptions): Promise<Response> {
  const authenticatedUserId = await options.resolveAuthenticatedUserId(context);
  if (!authenticatedUserId) {
    return context.json({ error: "Authentication required" }, 401);
  }
  const row = await withUserContext(options.db, authenticatedUserId, (transaction) =>
    transaction
      .selectFrom("users")
      .select(["id", "emailCiphertext", "keyVersion", "handle", "createdAt"])
      .where("id", "=", authenticatedUserId)
      .executeTakeFirst(),
  );
  if (!row) {
    return context.json({ error: "User not found" }, 404);
  }
  // Parsing with the strict schema keeps the export to the listed M2 fields.
  const exported: AccountExport = accountExportSchema.parse({
    exportedAt: new Date().toISOString(),
    user: {
      id: row.id,
      email: options.decryptUserEmail(row.emailCiphertext, row.keyVersion),
      handle: row.handle,
      createdAt: formatTimestamp(row.createdAt),
    },
  });
  options.logAccountEvent("account_exported", authenticatedUserId);
  context.header("Cache-Control", "no-store");
  return context.json(exported, 200);
}

/** GET /account/export, POST /account/delete-code and DELETE /account, for the signed-in user only (HEN-65). */
export function createAccountRoutes(input: AccountRoutesInput): Hono {
  const options: AccountRoutesOptions = { ...input, logAccountEvent: input.logAccountEvent ?? defaultLogAccountEvent };
  const routes = new Hono();
  routes.get("/account/export", (context) => handleExportAccount(context, options));
  routes.post("/account/delete-code", (context) => handleSendAccountDeletionCode(context, options));
  routes.delete("/account", (context) => handleDeleteAccount(context, options));
  return routes;
}

export function mountAccountRoutes(targetApp: Hono, options: AccountRoutesInput): Hono {
  return targetApp.route("/", createAccountRoutes(options));
}
