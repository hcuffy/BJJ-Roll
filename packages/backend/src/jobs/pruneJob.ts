import type { Pool } from "pg";
import { RATE_LIMIT_WINDOW_SECONDS } from "../auth/authLimits.js";
import { currentMs } from "../dates.js";

export const AUTH_PRUNE_QUEUE_NAME = "auth_prune";
export const AUTH_PRUNE_CRON = "0 * * * *";

export interface PruneResult {
  readonly table: string;
  readonly deleted: number;
}

export async function pruneExpiredAuthRows(pool: Pool): Promise<PruneResult[]> {
  const cutoffMs = currentMs() - RATE_LIMIT_WINDOW_SECONDS * 1000;
  const result = await pool.query<{ table_name: string; deleted_count: string }>(
    "SELECT table_name, deleted_count FROM public.prune_expired_auth_rows($1)",
    [cutoffMs],
  );
  return result.rows.map((row) => ({ table: row.table_name, deleted: Number(row.deleted_count) }));
}
