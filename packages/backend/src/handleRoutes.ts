import { Hono, type Context } from "hono";
import { sql, type Kysely } from "kysely";
import { handleSchema, setHandleRequestSchema } from "@bjj-roll/shared";
import { withUserContext } from "./database/connection.js";
import type { BjjRollDatabase } from "./database/schema.js";
import { currentDate, toIsoString } from "./dates.js";

export type AuthenticatedUserIdResolver = (context: Context) => Promise<string | null> | string | null;

export interface HandleRouteConfig {
  resolveAuthenticatedUserId?: AuthenticatedUserIdResolver;
  takeAvailabilityCheck?: (context: Context) => Promise<"allowed" | "rate_limited">;
}

export interface HandleRoutesOptions extends HandleRouteConfig {
  db: Kysely<BjjRollDatabase>;
}

interface PostgresErrorLike {
  code?: unknown;
  constraint?: unknown;
}

export function isUniqueHandleConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const postgresError = error as PostgresErrorLike;
  return postgresError.code === "23505" && postgresError.constraint === "users_handle_unique_idx";
}

function formatTimestamp(value: Date | string): string {
  return value instanceof Date ? toIsoString(value) : String(value);
}

function resolveOptions(dbOrOptions: Kysely<BjjRollDatabase> | HandleRoutesOptions, config?: HandleRouteConfig): HandleRoutesOptions {
  if ("db" in dbOrOptions) {
    return {
      ...dbOrOptions,
      ...config,
    };
  }
  return {
    db: dbOrOptions,
    ...config,
  };
}

function defaultResolveAuthenticatedUserId(context: Context): string | null {
  const contextVariables = context.var as Record<string, unknown>;
  if (typeof contextVariables.authenticatedUserId === "string" && contextVariables.authenticatedUserId.trim().length > 0) {
    return contextVariables.authenticatedUserId.trim();
  }
  if (typeof contextVariables.userId === "string" && contextVariables.userId.trim().length > 0) {
    return contextVariables.userId.trim();
  }
  const contextUser = contextVariables.user as { id?: unknown } | undefined;
  if (contextUser && typeof contextUser.id === "string" && contextUser.id.trim().length > 0) {
    return contextUser.id.trim();
  }
  const contextSession = contextVariables.session as { userId?: unknown } | undefined;
  if (contextSession && typeof contextSession.userId === "string" && contextSession.userId.trim().length > 0) {
    return contextSession.userId.trim();
  }
  return null;
}

async function queryHandleAvailability(db: Kysely<BjjRollDatabase>, normalizedHandle: string): Promise<boolean> {
  const result = await db.transaction().execute(async (transaction) => {
    await sql`SET LOCAL ROLE bjj_app`.execute(transaction);
    return sql<{ available: boolean }>`SELECT public.handle_available(${normalizedHandle}) AS available`.execute(transaction);
  });
  return result.rows[0]?.available === true;
}

async function handleAvailabilityRequest(context: Context, options: HandleRoutesOptions): Promise<Response> {
  if ((await options.takeAvailabilityCheck?.(context)) === "rate_limited") {
    return context.json({ available: false, error: "Too many requests" }, 429);
  }
  const parsed = handleSchema.safeParse(context.req.query("handle") ?? "");
  if (!parsed.success) {
    return context.json({ available: false, error: "Invalid or reserved handle" }, 400);
  }
  const available = await queryHandleAvailability(options.db, parsed.data);
  return context.json({ available, handle: parsed.data }, 200);
}

async function handleGetUserHandle(context: Context, options: HandleRoutesOptions): Promise<Response> {
  const resolveUserId = options.resolveAuthenticatedUserId ?? defaultResolveAuthenticatedUserId;
  const authenticatedUserId = await resolveUserId(context);
  if (!authenticatedUserId) {
    return context.json({ error: "Authentication required" }, 401);
  }
  const row = await withUserContext(options.db, authenticatedUserId, (transaction) =>
    transaction.selectFrom("users").select(["id", "handle", "createdAt"]).where("id", "=", authenticatedUserId).executeTakeFirst(),
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

async function handleSetUserHandle(context: Context, options: HandleRoutesOptions): Promise<Response> {
  const resolveUserId = options.resolveAuthenticatedUserId ?? defaultResolveAuthenticatedUserId;
  const authenticatedUserId = await resolveUserId(context);
  if (!authenticatedUserId) {
    return context.json({ error: "Authentication required" }, 401);
  }

  const parsedBody = await parseSetHandleBody(context);
  if (!parsedBody) {
    return context.json({ error: "Invalid or reserved handle" }, 400);
  }

  try {
    const outcome = await withUserContext(options.db, authenticatedUserId, async (transaction) => {
      const updatedRow = await transaction
        .updateTable("users")
        .set({
          handle: parsedBody.handle,
          updatedAt: currentDate(),
        })
        .where("id", "=", authenticatedUserId)
        .where("handle", "is", null)
        .returning(["id", "handle", "createdAt"])
        .executeTakeFirst();

      if (updatedRow) {
        return { kind: "updated" as const, row: updatedRow };
      }

      const visibleRow = await transaction.selectFrom("users").select(["id", "handle"]).where("id", "=", authenticatedUserId).executeTakeFirst();

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

export function createHandleRoutes(dbOrOptions: Kysely<BjjRollDatabase> | HandleRoutesOptions, config?: HandleRouteConfig): Hono {
  const options = resolveOptions(dbOrOptions, config);
  const routes = new Hono();

  routes.get("/handles/availability", (context) => handleAvailabilityRequest(context, options));
  routes.get("/handles/me", (context) => handleGetUserHandle(context, options));
  routes.post("/handles", (context) => handleSetUserHandle(context, options));

  return routes;
}

export function mountHandleRoutes(targetApp: Hono, dbOrOptions: Kysely<BjjRollDatabase> | HandleRoutesOptions, config?: HandleRouteConfig): Hono {
  return targetApp.route("/", createHandleRoutes(dbOrOptions, config));
}
