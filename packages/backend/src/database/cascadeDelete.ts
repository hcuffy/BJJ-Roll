import type { Kysely } from "kysely";
import { withUserContext } from "./connection.js";
import type { BjjRollDatabase, UserDataTableName } from "./schema.js";

export interface AccountDeletionCascadeStep {
  table: UserDataTableName;
  mechanism: "foreign_key_cascade" | "before_delete_trigger_and_fk_cascade" | "primary_row";
  description: string;
}

/**
 * Explicit account deletion cascade map aligned with ARCHITECTURE.md §5.
 * Every user-data table in `public` is accounted for when a user deletes their account.
 * `public.rate_limits` is deliberately not in the map: the per-email send counter (key `email:<email_hash>`, hash only) stays
 * until its 15-minute window expires, so deleting the account and signing up again cannot reset the send limit (HEN-65).
 * The DELETE /account try counters (`account-delete:user:<id>`, `account-delete:ip:<ip>`) age out the same way.
 */
export const accountDeletionCascadeMap: readonly AccountDeletionCascadeStep[] = [
  {
    table: "verifications",
    mechanism: "before_delete_trigger_and_fk_cascade",
    description: "Deletes OTP and verification rows linked by user_id or exact email_hash identifier.",
  },
  {
    table: "sessions",
    mechanism: "foreign_key_cascade",
    description: "Deletes active and expired session rows via sessions.user_id ON DELETE CASCADE.",
  },
  {
    table: "accounts",
    mechanism: "foreign_key_cascade",
    description: "Deletes linked provider account rows via accounts.user_id ON DELETE CASCADE.",
  },
  {
    table: "users",
    mechanism: "primary_row",
    description: "Deletes the owner user row in public.users under owner RLS.",
  },
] as const;

export interface CascadeDeleteAccountResult {
  deletedUserCount: number;
  deletedSessionCount: number;
  deletedAccountCount: number;
  deletedVerificationCount: number;
}

export function verificationIdentifiersForEmailHash(emailHash: string): readonly string[] {
  return [emailHash, `email-otp-${emailHash}`, `sign-in-otp-${emailHash}`, `email-verification-otp-${emailHash}`, `forget-password-otp-${emailHash}`];
}

/**
 * Deletes the authenticated user's account inside their RLS context (`app.user_id = userId`)
 * and returns the count of rows removed across `users`, `sessions`, `accounts`, and `verifications`.
 */
export function cascadeDeleteUserAccount(db: Kysely<BjjRollDatabase>, userId: string): Promise<CascadeDeleteAccountResult> {
  return withUserContext(db, userId, async (transaction) => {
    const existingUser = await transaction.selectFrom("users").select(["id", "emailHash"]).where("id", "=", userId).executeTakeFirst();

    if (!existingUser) {
      return {
        deletedUserCount: 0,
        deletedSessionCount: 0,
        deletedAccountCount: 0,
        deletedVerificationCount: 0,
      };
    }

    const expectedIdentifiers = verificationIdentifiersForEmailHash(existingUser.emailHash);

    const sessionsBefore = await transaction
      .selectFrom("sessions")
      .select((expressionBuilder) => expressionBuilder.fn.countAll<string>().as("count"))
      .where("userId", "=", userId)
      .executeTakeFirstOrThrow();

    const accountsBefore = await transaction
      .selectFrom("accounts")
      .select((expressionBuilder) => expressionBuilder.fn.countAll<string>().as("count"))
      .where("userId", "=", userId)
      .executeTakeFirstOrThrow();

    const verificationsBefore = await transaction
      .selectFrom("verifications")
      .select((expressionBuilder) => expressionBuilder.fn.countAll<string>().as("count"))
      .where((expressionBuilder) =>
        expressionBuilder.or([
          expressionBuilder("userId", "=", userId),
          expressionBuilder.and([expressionBuilder("userId", "is", null), expressionBuilder("identifier", "in", expectedIdentifiers)]),
        ]),
      )
      .executeTakeFirstOrThrow();

    const deleteResult = await transaction.deleteFrom("users").where("id", "=", userId).executeTakeFirst();

    return {
      deletedUserCount: Number(deleteResult.numDeletedRows ?? 0n),
      deletedSessionCount: Number(sessionsBefore.count),
      deletedAccountCount: Number(accountsBefore.count),
      deletedVerificationCount: Number(verificationsBefore.count),
    };
  });
}
