import type { Kysely } from "kysely";
import { withUserContext } from "./connection.js";
import type { BjjRollDatabase, UserDataTableName } from "./schema.js";

export interface AccountDeletionCascadeStep {
  table: UserDataTableName;
  mechanism: "foreign_key_cascade" | "before_delete_trigger_and_fk_cascade" | "primary_row";
  description: string;
}

export const accountDeletionCascadeMap: readonly AccountDeletionCascadeStep[] = [
  {
    table: "verifications",
    mechanism: "before_delete_trigger_and_fk_cascade",
    description:
      "Deletes OTP, magic-link, device-verifier, exchange and pending sign-up rows linked by user_id, email_hash or exact email_hash identifier.",
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
    table: "consent_records",
    mechanism: "foreign_key_cascade",
    description:
      "Deletes the age confirmation and sign-up attestation consent records via consent_records.user_id ON DELETE CASCADE (HEN-263, HEN-183).",
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
          expressionBuilder("emailHash", "=", existingUser.emailHash),
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
