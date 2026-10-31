import { Hono } from "hono";
import type { Kysely } from "kysely";
import { cascadeDeleteUserAccount } from "./cascadeDelete.js";
import { withUserContext } from "./connection.js";
import type { BjjRollDatabase } from "./schema.js";

function parseHandleUpdatePayload(rawBody: unknown): { valid: true; handle: string | null } | { valid: false } {
  if (typeof rawBody !== "object" || rawBody === null || !("handle" in rawBody)) {
    return { valid: false };
  }
  const candidate: unknown = rawBody.handle;
  if (candidate === null) {
    return { valid: true, handle: null };
  }
  if (typeof candidate === "string" && candidate.trim().length > 0 && candidate.length <= 40) {
    return { valid: true, handle: candidate };
  }
  return { valid: false };
}

export function createUserAccountRoutes(db: Kysely<BjjRollDatabase>): Hono {
  if (process.env.NODE_ENV === "production") {
    throw new Error("createUserAccountRoutes is a test-only RLS harness and must not be mounted in production; use HEN-71 session auth middleware.");
  }

  const router = new Hono();

  router.get("/users/:userId", async (context) => {
    const authenticatedUserId = context.req.header("x-authenticated-user-id") ?? "";
    const targetUserId = context.req.param("userId");

    const row = await withUserContext(db, authenticatedUserId, (transaction) =>
      transaction
        .selectFrom("users")
        .select(["id", "handle", "emailVerified", "keyVersion", "createdAt", "updatedAt"])
        .where("id", "=", targetUserId)
        .executeTakeFirst(),
    );

    if (!row) {
      return context.json({ error: "User not found" }, 404);
    }

    return context.json(row, 200);
  });

  router.patch("/users/:userId", async (context) => {
    const authenticatedUserId = context.req.header("x-authenticated-user-id") ?? "";
    const targetUserId = context.req.param("userId");
    const rawBody: unknown = await context.req.json().catch(() => null);
    const parsedBody = parseHandleUpdatePayload(rawBody);
    if (!parsedBody.valid) {
      return context.json({ error: "Invalid handle payload" }, 400);
    }

    const updated = await withUserContext(db, authenticatedUserId, (transaction) =>
      transaction
        .updateTable("users")
        .set({
          handle: parsedBody.handle,
          updatedAt: new Date(),
        })
        .where("id", "=", targetUserId)
        .returning(["id", "handle", "updatedAt"])
        .executeTakeFirst(),
    );

    if (!updated) {
      return context.json({ error: "User not found" }, 404);
    }

    return context.json(updated, 200);
  });

  router.delete("/users/:userId", async (context) => {
    const authenticatedUserId = context.req.header("x-authenticated-user-id") ?? "";
    const targetUserId = context.req.param("userId");

    const deleted = await withUserContext(db, authenticatedUserId, (transaction) =>
      transaction.deleteFrom("users").where("id", "=", targetUserId).executeTakeFirst(),
    );

    if (Number(deleted.numDeletedRows ?? 0n) === 0) {
      return context.json({ error: "User not found" }, 404);
    }

    return context.json({ deleted: true }, 200);
  });

  router.delete("/account", async (context) => {
    const authenticatedUserId = context.req.header("x-authenticated-user-id") ?? "";
    if (!authenticatedUserId) {
      return context.json({ error: "Authentication required" }, 401);
    }

    const result = await cascadeDeleteUserAccount(db, authenticatedUserId);
    if (result.deletedUserCount === 0) {
      return context.json({ error: "User not found" }, 404);
    }

    return context.json(result, 200);
  });

  return router;
}
