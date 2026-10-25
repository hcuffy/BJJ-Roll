import type { ColumnType, Generated } from "kysely";

export type TimestampColumn = ColumnType<Date, Date | string | undefined, Date | string>;
export type RequiredTimestampColumn = ColumnType<Date, Date | string, Date | string>;

export interface UsersTable {
  id: string;
  emailCiphertext: string;
  emailHash: string;
  keyVersion: ColumnType<number, number | undefined, number>;
  emailVerified: ColumnType<boolean, boolean | undefined, boolean>;
  handle: string | null;
  createdAt: TimestampColumn;
  updatedAt: TimestampColumn;
}

export interface SessionsTable {
  id: string;
  userId: string;
  token: string;
  expiresAt: RequiredTimestampColumn;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: TimestampColumn;
  updatedAt: TimestampColumn;
}

export interface AccountsTable {
  id: string;
  userId: string;
  accountId: string;
  providerId: string;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  accessTokenExpiresAt: RequiredTimestampColumn | null;
  refreshTokenExpiresAt: RequiredTimestampColumn | null;
  scope: string | null;
  password: string | null;
  createdAt: TimestampColumn;
  updatedAt: TimestampColumn;
}

export interface VerificationsTable {
  id: string;
  userId: string | null;
  identifier: string;
  value: string;
  expiresAt: RequiredTimestampColumn;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

/** Better Auth counters (migration 002). Per-email rows use the key `email:<users.email_hash>`; per-IP rows hold no user data. */
export interface RateLimitsTable {
  id: string;
  key: string;
  count: number;
  lastRequest: ColumnType<string, number | string, number | string>;
}

export interface BjjRollDatabase {
  users: UsersTable;
  sessions: SessionsTable;
  accounts: AccountsTable;
  verifications: VerificationsTable;
  rateLimits: RateLimitsTable;
}

export type DatabaseSchema = BjjRollDatabase;

/** Physical table names in `public` that hold rows for a user; every one is in the account deletion cascade map. */
export const userDataTables = ["users", "sessions", "accounts", "verifications", "rate_limits"] as const;
export type UserDataTableName = (typeof userDataTables)[number];
