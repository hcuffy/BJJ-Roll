export {
  accountDeletionCascadeMap,
  cascadeDeleteUserAccount,
  emailRateLimitKey,
  verificationIdentifiersForEmailHash,
  type AccountDeletionCascadeStep,
  type CascadeDeleteAccountResult,
} from "./cascadeDelete.js";
export { createDatabase, lookupUserIdByEmailHmac, lookupUserIdByEmailHmacFromPool, withAppRoleUnscoped, withUserContext } from "./connection.js";
export {
  betterAuthTelemetryDisabledConfig,
  createEmailHashAdapter,
  type EmailHashAdapterConfig,
  type EmailPrivacyCodec,
} from "./emailHashAdapter.js";
export { runDatabaseMigrations, SqlFileMigrationProvider } from "./migrator.js";
export {
  userDataTables,
  type AccountsTable,
  type BjjRollDatabase,
  type DatabaseSchema,
  type RateLimitsTable,
  type SessionsTable,
  type UserDataTableName,
  type UsersTable,
  type VerificationsTable,
} from "./schema.js";
export { createUserAccountRoutes } from "./userAccountRoutes.js";
