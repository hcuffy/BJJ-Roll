import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { betterAuthTelemetryDisabledConfig, runDatabaseMigrations, userDataTables } from "../database/index.js";
import { isPostgresTestEnvironmentAvailable, startMigratedTestDatabase, type MigratedTestDatabase } from "./databaseTestHarness.js";

const canRunPostgresTests = isPostgresTestEnvironmentAvailable();

describe.skipIf(!canRunPostgresTests)("database schema, roles and RLS catalogue (HEN-58 AC 1, 4, 7, 8)", () => {
  let harness: MigratedTestDatabase | undefined;

  beforeAll(async () => {
    harness = await startMigratedTestDatabase();
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  }, 60_000);

  function requireHarness(): MigratedTestDatabase {
    if (!harness) {
      throw new Error("Test database harness was not initialized");
    }
    return harness;
  }

  it("AC 8: runs Kysely SQL migrations from an empty database and is idempotent on re-run", async () => {
    const { db, pool } = requireHarness();
    const secondRunResults = await runDatabaseMigrations(db);
    expect(secondRunResults).toEqual([]);

    const migrationRows = await pool.query<{ name: string }>("SELECT name FROM public.kysely_migration ORDER BY name");
    expect(migrationRows.rows).toEqual([
      { name: "001_users_sessions_handles_rls" },
      { name: "002_auth_rate_limits_and_rls" },
      { name: "003_age_confirmation_consent_records" },
      { name: "004_apple_nonce_cleanup" },
    ]);
    expect(betterAuthTelemetryDisabledConfig).toEqual({ enabled: false });
  });

  it("AC 1: has no plaintext email, phone, or real-name column on any table in information_schema.columns", async () => {
    const { pool } = requireHarness();

    const forbiddenColumns = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name NOT IN ('kysely_migration', 'kysely_migration_lock')
         AND (
           column_name IN ('email', 'user_email', 'plain_email', 'raw_email', 'name', 'real_name', 'full_name')
           OR column_name LIKE '%phone%'
           OR column_name LIKE '%mobile%'
         )
       ORDER BY table_name, column_name`,
    );
    expect(forbiddenColumns.rows).toEqual([]);

    const emailRelatedColumns = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name LIKE '%email%'
       ORDER BY table_name, column_name`,
    );
    expect(emailRelatedColumns.rows).toEqual([
      { table_name: "users", column_name: "email_ciphertext" },
      { table_name: "users", column_name: "email_hash" },
      { table_name: "users", column_name: "email_verified" },
    ]);
  });

  it("AC 4: bjj_app does not own the tables, has no BYPASSRLS, cannot UPDATE email_hash/id, and FORCE RLS is on", async () => {
    const { pool } = requireHarness();

    const roleResult = await pool.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolname, rolsuper, rolbypassrls
       FROM pg_roles
       WHERE rolname IN ('bjj_owner', 'bjj_app', 'bjj_job_runner', 'bjj_auth_lookup')
       ORDER BY rolname`,
    );
    expect(roleResult.rows).toEqual([
      { rolname: "bjj_app", rolsuper: false, rolbypassrls: false },
      { rolname: "bjj_auth_lookup", rolsuper: false, rolbypassrls: false },
      { rolname: "bjj_job_runner", rolsuper: false, rolbypassrls: false },
      { rolname: "bjj_owner", rolsuper: false, rolbypassrls: false },
    ]);

    const tableSecurityResult = await pool.query<{
      table_name: string;
      owner_name: string;
      rls_enabled: boolean;
      rls_forced: boolean;
    }>(
      `SELECT c.relname AS table_name, pg_get_userbyid(c.relowner) AS owner_name,
              c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
       FROM pg_class AS c
       JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
       ORDER BY c.relname`,
      [[...userDataTables]],
    );

    expect(tableSecurityResult.rows).toEqual([
      { table_name: "accounts", owner_name: "bjj_owner", rls_enabled: true, rls_forced: true },
      { table_name: "consent_records", owner_name: "bjj_owner", rls_enabled: true, rls_forced: true },
      { table_name: "sessions", owner_name: "bjj_owner", rls_enabled: true, rls_forced: true },
      { table_name: "users", owner_name: "bjj_owner", rls_enabled: true, rls_forced: true },
      { table_name: "verifications", owner_name: "bjj_owner", rls_enabled: true, rls_forced: true },
    ]);

    const columnUpdatePrivileges = await pool.query<{
      can_update_id: boolean;
      can_update_email_hash: boolean;
      can_update_created_at: boolean;
      can_update_handle: boolean;
      can_update_email_ciphertext: boolean;
    }>(
      `SELECT
         has_column_privilege('bjj_app', 'public.users', 'id', 'UPDATE') AS can_update_id,
         has_column_privilege('bjj_app', 'public.users', 'email_hash', 'UPDATE') AS can_update_email_hash,
         has_column_privilege('bjj_app', 'public.users', 'created_at', 'UPDATE') AS can_update_created_at,
         has_column_privilege('bjj_app', 'public.users', 'handle', 'UPDATE') AS can_update_handle,
         has_column_privilege('bjj_app', 'public.users', 'email_ciphertext', 'UPDATE') AS can_update_email_ciphertext`,
    );
    expect(columnUpdatePrivileges.rows).toEqual([
      {
        can_update_id: false,
        can_update_email_hash: false,
        can_update_created_at: false,
        can_update_handle: true,
        can_update_email_ciphertext: true,
      },
    ]);
  });

  it("AC 7.1 & 7.6: bjj_auth_lookup is NOLOGIN, NOBYPASSRLS, and not a member of any role with BYPASSRLS", async () => {
    const { pool } = requireHarness();

    const lookupRole = await pool.query<{ rolname: string; rolcanlogin: boolean; rolbypassrls: boolean; rolsuper: boolean }>(
      "SELECT rolname, rolcanlogin, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'bjj_auth_lookup'",
    );
    expect(lookupRole.rows).toEqual([{ rolname: "bjj_auth_lookup", rolcanlogin: false, rolbypassrls: false, rolsuper: false }]);

    const memberships = await pool.query<{ parent_role: string; parent_bypassrls: boolean }>(
      `SELECT parent.rolname AS parent_role, parent.rolbypassrls AS parent_bypassrls
       FROM pg_auth_members AS m
       JOIN pg_roles AS member ON member.oid = m.member
       JOIN pg_roles AS parent ON parent.oid = m.roleid
       WHERE member.rolname IN ('bjj_auth_lookup', 'bjj_app')`,
    );
    expect(memberships.rows).toEqual([]);
  });

  it("AC 7.2: users has only one FOR SELECT policy for bjj_auth_lookup and SELECT-only grants", async () => {
    const { pool } = requireHarness();

    const lookupPolicies = await pool.query<{ tablename: string; policyname: string; cmd: string; roles: string[] }>(
      `SELECT tablename, policyname, cmd, roles::text[] AS roles
       FROM pg_policies
       WHERE schemaname = 'public' AND ('bjj_auth_lookup' = ANY(roles) OR 'public' = ANY(roles))
       ORDER BY tablename, policyname`,
    );
    expect(lookupPolicies.rows).toEqual([{ tablename: "users", policyname: "users_auth_lookup_select", cmd: "SELECT", roles: ["bjj_auth_lookup"] }]);

    const tableGrants = await pool.query<{ table_name: string; privilege_type: string }>(
      `SELECT table_name, privilege_type
       FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND grantee = 'bjj_auth_lookup'
       ORDER BY table_name, privilege_type`,
    );
    expect(tableGrants.rows).toEqual([{ table_name: "users", privilege_type: "SELECT" }]);

    const writePrivileges = await pool.query<{
      table_name: string;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
    }>(
      `SELECT c.relname AS table_name,
              has_table_privilege('bjj_auth_lookup', c.oid, 'INSERT') AS can_insert,
              has_table_privilege('bjj_auth_lookup', c.oid, 'UPDATE') AS can_update,
              has_table_privilege('bjj_auth_lookup', c.oid, 'DELETE') AS can_delete
       FROM pg_class AS c
       JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
       ORDER BY c.relname`,
    );
    for (const row of writePrivileges.rows) {
      expect(row).toEqual({ table_name: row.table_name, can_insert: false, can_update: false, can_delete: false });
    }
  });

  it("AC 7.3 & 7.5: app_user_id_by_email_hmac is SECURITY DEFINER with pinned search_path and EXECUTE to bjj_app only", async () => {
    const { pool } = requireHarness();

    const functionCatalogue = await pool.query<{
      proname: string;
      owner_name: string;
      owner_bypassrls: boolean;
      security_definer: boolean;
      arg_names: string[];
      proconfig: string[];
      public_can_execute: boolean;
      app_can_execute: boolean;
      runner_can_execute: boolean;
      lookup_can_execute: boolean;
    }>(
      `SELECT p.proname, r.rolname AS owner_name, r.rolbypassrls AS owner_bypassrls,
              p.prosecdef AS security_definer, p.proargnames AS arg_names, p.proconfig,
              has_function_privilege('public', p.oid, 'EXECUTE') AS public_can_execute,
              has_function_privilege('bjj_app', p.oid, 'EXECUTE') AS app_can_execute,
              has_function_privilege('bjj_job_runner', p.oid, 'EXECUTE') AS runner_can_execute,
              has_function_privilege('bjj_auth_lookup', p.oid, 'EXECUTE') AS lookup_can_execute
       FROM pg_proc AS p
       JOIN pg_namespace AS n ON n.oid = p.pronamespace
       JOIN pg_roles AS r ON r.oid = p.proowner
       WHERE n.nspname = 'public' AND p.proname = 'app_user_id_by_email_hmac'`,
    );

    expect(functionCatalogue.rows).toEqual([
      {
        proname: "app_user_id_by_email_hmac",
        owner_name: "bjj_auth_lookup",
        owner_bypassrls: false,
        security_definer: true,
        arg_names: ["email_hmac"],
        proconfig: ["search_path=pg_catalog, public"],
        public_can_execute: false,
        app_can_execute: true,
        runner_can_execute: false,
        lookup_can_execute: false,
      },
    ]);

    const routineGrants = await pool.query<{ grantee: string; privilege_type: string }>(
      `SELECT grantee, privilege_type
       FROM information_schema.routine_privileges
       WHERE specific_schema = 'public' AND routine_name = 'app_user_id_by_email_hmac'
       ORDER BY grantee`,
    );
    expect(routineGrants.rows).toEqual([{ grantee: "bjj_app", privilege_type: "EXECUTE" }]);
  });
});
