import type { AgeConfirmationRecord, SignUpAttestationRecord } from "@bjj-roll/shared";
import type { ColumnType, Generated } from "kysely";

type TimestampColumn = ColumnType<Date, Date | string | undefined, Date | string>;
type RequiredTimestampColumn = ColumnType<Date, Date | string, Date | string>;

interface UsersTable {
  id: string;
  emailCiphertext: string;
  emailHash: string;
  keyVersion: ColumnType<number, number | undefined, number>;
  emailVerified: ColumnType<boolean, boolean | undefined, boolean>;
  handle: string | null;
  createdAt: TimestampColumn;
  updatedAt: TimestampColumn;
}

interface SessionsTable {
  id: string;
  userId: string;
  token: string;
  expiresAt: RequiredTimestampColumn;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: TimestampColumn;
  updatedAt: TimestampColumn;
}

interface AccountsTable {
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

interface VerificationsTable {
  id: string;
  userId: string | null;
  identifier: string;
  value: string;
  emailHash: string | null;
  expiresAt: RequiredTimestampColumn;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

interface ConsentRecordsTable {
  id: string;
  userId: string;
  consentType: (AgeConfirmationRecord | SignUpAttestationRecord)["consentType"];
  textVersionId: string;
  age16Confirmed: boolean | null;
  age18Confirmed: boolean | null;
  acceptedAt: TimestampColumn;
  withdrawnAt: TimestampColumn | null;
}

export interface BjjRollDatabase {
  users: UsersTable;
  sessions: SessionsTable;
  accounts: AccountsTable;
  verifications: VerificationsTable;
  consentRecords: ConsentRecordsTable;
}

export const userDataTables = ["users", "sessions", "accounts", "verifications", "consent_records"] as const;
export type UserDataTableName = (typeof userDataTables)[number];
