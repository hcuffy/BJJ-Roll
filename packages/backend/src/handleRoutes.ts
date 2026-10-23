import { handleSchema, setHandleRequestSchema } from "../../shared/dist/index.js";
import { Hono, type Context } from "hono";
import { sql, type Kysely } from "kysely";
import { withUserContext } from "./database/connection.js";
import type { BjjRollDatabase } from "./database/schema.js";

export type AuthenticatedUserIdResolver = (context: Context) => Promise<string | null> | string | null;

export interface HandleRoutesOptions {
  db: Kysely<BjjRollDatabase>;
  resolveAuthenticatedUserId?: AuthenticatedUserIdResolver;
}

interface PostgresErrorLike {
  code?: unknown;
  constraint?: unknown;
}

function isUniqueHandleConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const postgresError = error as PostgresErrorLike;
  return postgresError.code === "23505" || postgresError.constraint === "users_handle_unique_idx";
}

function formatTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function resolveOptions(dbOrOptions: Kysely<BjjRollDatabase> | HandleRoutesOptions): HandleRoutesOptions {
  if ("db" in dbOrOptions) {
    return dbOrOptions;
  }
  return { db: dbOrOptions };
}

function defaultResolveAuthenticatedUserId(context: Context): string | null {
  const contextVariables = context.var as Record<string, unknown>;
  if (typeof contextVariables.userId === "string" && contextVariables.userId.trim().length > 0) {
    return contextVariables.userId.trim();
  }
  const contextUser = contextVariables.user as { id?: unknown } | undefined;
  if (contextUser && typeof contextUser.id === "string" && contextUser.id.trim().length > 0) {
    return contextUser.id.trim();
  }
  if (process.env.NODE_ENV !== "production") {
    const headerUserId = context.req.header("x-authenticated-user-id")?.trim();
    if (headerUserId && headerUserId.length > 0) {
      return headerUserId;
    }
  }
  return null;
}

async function queryHandleAvailability(db: Kysely<BjjRollDatabase>, normalizedHandle: string): Promise<boolean> {
  const existingRow = await db.transaction().execute(async (transaction) => {
    await sql`SET LOCAL ROLE bjj_auth_lookup`.execute(transaction);
    return transaction.selectFrom("users").select(["id"]).where("handle", "=", normalizedHandle).executeTakeFirst();
  });
  return !existingRow;
}

async function handleAvailabilityRequest(context: Context, db: Kysely<BjjRollDatabase>, rawCandidate: string | undefined): Promise<Response> {
  const parsed = handleSchema.safeParse(rawCandidate ?? "");
  if (!parsed.success) {
    return context.json({ available: false, error: "Invalid or reserved handle" }, 400);
  }
  const available = await queryHandleAvailability(db, parsed.data);
  return context.json({ available, handle: parsed.data }, 200);
}

async function handleGetUserHandle(context: Context, options: HandleRoutesOptions, targetUserIdOverride?: string): Promise<Response> {
  const resolveUserId = options.resolveAuthenticatedUserId ?? defaultResolveAuthenticatedUserId;
  const authenticatedUserId = await resolveUserId(context);
  if (!authenticatedUserId) {
    return context.json({ error: "Authentication required" }, 401);
  }
  const targetUserId = targetUserIdOverride ?? authenticatedUserId;
  const row = await withUserContext(options.db, authenticatedUserId, (transaction) =>
    transaction.selectFrom("users").select(["id", "handle", "createdAt"]).where("id", "=", targetUserId).executeTakeFirst(),
  );
  if (!row) {
    return context.json({ error: "User not found" }, 404);
  }
  return context.json(
    {
      id: row.id,
      handle: row.handle,
      createdAt: formatTimestamp(row.createdAt),
    },
    200,
  );
}

async function parseSetHandleBody(context: Context): Promise<{ handle: string } | null> {
  try {
    const rawBody: unknown = await context.req.json();
    const parsed = setHandleRequestSchema.safeParse(rawBody);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function handleSetUserHandle(context: Context, options: HandleRoutesOptions, targetUserIdOverride?: string): Promise<Response> {
  const resolveUserId = options.resolveAuthenticatedUserId ?? defaultResolveAuthenticatedUserId;
  const authenticatedUserId = await resolveUserId(context);
  if (!authenticatedUserId) {
    return context.json({ error: "Authentication required" }, 401);
  }

  const parsedBody = await parseSetHandleBody(context);
  if (!parsedBody) {
    return context.json({ error: "Invalid or reserved handle" }, 400);
  }

  const targetUserId = targetUserIdOverride ?? authenticatedUserId;

  try {
    const outcome = await withUserContext(options.db, authenticatedUserId, async (transaction) => {
      const updatedRow = await transaction
        .updateTable("users")
        .set({
          handle: parsedBody.handle,
          updatedAt: new Date(),
        })
        .where("id", "=", targetUserId)
        .where("handle", "is", null)
        .returning(["id", "handle", "createdAt"])
        .executeTakeFirst();

      if (updatedRow) {
        return { kind: "updated" as const, row: updatedRow };
      }

      const visibleRow = await transaction.selectFrom("users").select(["id", "handle"]).where("id", "=", targetUserId).executeTakeFirst();

      if (!visibleRow) {
        return { kind: "not_found" as const };
      }
      return { kind: "already_set" as const };
    });

    if (outcome.kind === "not_found") {
      return context.json({ error: "User not found" }, 404);
    }
    if (outcome.kind === "already_set") {
      return context.json({ error: "Handle is already taken" }, 409);
    }
    return context.json(
      {
        id: outcome.row.id,
        handle: outcome.row.handle,
        createdAt: formatTimestamp(outcome.row.createdAt),
      },
      200,
    );
  } catch (error) {
    if (isUniqueHandleConflict(error)) {
      return context.json({ error: "Handle is already taken" }, 409);
    }
    throw error;
  }
}

export function createHandleRoutes(dbOrOptions: Kysely<BjjRollDatabase> | HandleRoutesOptions): Hono {
  const options = resolveOptions(dbOrOptions);
  const routes = new Hono();

  routes.get("/handles/availability", (context) => handleAvailabilityRequest(context, options.db, context.req.query("handle")));
  routes.get("/handles/me", (context) => handleGetUserHandle(context, options));
  routes.get("/handles/:handle/availability", (context) => handleAvailabilityRequest(context, options.db, context.req.param("handle")));

  routes.post("/handles", (context) => handleSetUserHandle(context, options));
  routes.put("/handles", (context) => handleSetUserHandle(context, options));
  routes.patch("/handles", (context) => handleSetUserHandle(context, options));

  routes.get("/users/:userId/handle", (context) => handleGetUserHandle(context, options, context.req.param("userId")));
  routes.post("/users/:userId/handle", (context) => handleSetUserHandle(context, options, context.req.param("userId")));
  routes.put("/users/:userId/handle", (context) => handleSetUserHandle(context, options, context.req.param("userId")));
  routes.patch("/users/:userId/handle", (context) => handleSetUserHandle(context, options, context.req.param("userId")));

  return routes;
}

export function mountHandleRoutes(targetApp: Hono, dbOrOptions: Kysely<BjjRollDatabase> | HandleRoutesOptions): Hono {
  return targetApp.route("/", createHandleRoutes(dbOrOptions));
}
