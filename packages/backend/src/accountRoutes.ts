import { accountExportSchema, type AccountDeletionResponse, type AccountExport } from "@bjj-roll/shared";
import { Hono, type Context } from "hono";
import type { Kysely } from "kysely";
import { cascadeDeleteUserAccount } from "./database/cascadeDelete.js";
import { withUserContext } from "./database/connection.js";
import type { BjjRollDatabase } from "./database/schema.js";
import type { AuthenticatedUserIdResolver } from "./handleRoutes.js";

export type AccountEventName = "account_exported" | "account_deleted";

/** One log line per account event. It carries the user id and nothing else: no email, no email hash (HEN-65 AC 6, A5). */
export type AccountEventLogger = (event: AccountEventName, userId: string) => void;

export interface AccountRoutesOptions {
  db: Kysely<BjjRollDatabase>;
  /** The signed-in user from the session; there is no way to name another user (HEN-65 AC 4). */
  resolveAuthenticatedUserId: AuthenticatedUserIdResolver;
  decryptUserEmail: (emailCiphertext: string, keyVersion: number) => string;
  logAccountEvent?: AccountEventLogger;
}

/** One JSON line on stdout, the same channel as the server's other operational output. */
const defaultLogAccountEvent: AccountEventLogger = (event, userId) => {
  process.stdout.write(`${JSON.stringify({ event, userId })}\n`);
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
  (options.logAccountEvent ?? defaultLogAccountEvent)("account_exported", authenticatedUserId);
  context.header("Cache-Control", "no-store");
  return context.json(exported, 200);
}

async function handleDeleteAccount(context: Context, options: AccountRoutesOptions): Promise<Response> {
  const authenticatedUserId = await options.resolveAuthenticatedUserId(context);
  if (!authenticatedUserId) {
    return context.json({ error: "Authentication required" }, 401);
  }
  // Hard delete, now: the user row and every row in the ARCHITECTURE.md §5 map, sessions included, in one transaction.
  const result = await cascadeDeleteUserAccount(options.db, authenticatedUserId);
  if (result.deletedUserCount === 0) {
    return context.json({ error: "User not found" }, 404);
  }
  (options.logAccountEvent ?? defaultLogAccountEvent)("account_deleted", authenticatedUserId);
  const response: AccountDeletionResponse = { deleted: true };
  return context.json(response, 200);
}

/** DELETE /account and GET /account/export for the signed-in user only (HEN-65). */
export function createAccountRoutes(options: AccountRoutesOptions): Hono {
  const routes = new Hono();
  routes.get("/account/export", (context) => handleExportAccount(context, options));
  routes.delete("/account", (context) => handleDeleteAccount(context, options));
  return routes;
}

export function mountAccountRoutes(targetApp: Hono, options: AccountRoutesOptions): Hono {
  return targetApp.route("/", createAccountRoutes(options));
}
