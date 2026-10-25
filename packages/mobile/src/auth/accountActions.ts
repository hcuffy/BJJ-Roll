import { accountDeletionResponseSchema, accountExportSchema } from "@bjj-roll/shared";
import type { MobileAuthClient } from "./authClient";
import { FAILURE_MESSAGES, SESSION_STORAGE_KEYS, type SessionKeyStore } from "./signInActions";

/** The signed-in session the account requests run under. The routes sit outside /api/auth, so they need the backend URL. */
export interface AccountSession {
  readonly client: MobileAuthClient;
  readonly secureStore: SessionKeyStore;
  readonly backendUrl: string;
}

interface AccountFailure {
  readonly ok: false;
  readonly reason: "network" | "unknown";
  readonly message: string;
}
export type AccountDeletionResult = { readonly ok: true } | AccountFailure;
export type AccountExportResult = { readonly ok: true; readonly json: string } | AccountFailure;

function failure(reason: AccountFailure["reason"]): AccountFailure {
  return { ok: false, reason, message: FAILURE_MESSAGES[reason] };
}

type AccountResponse = { readonly ok: true; readonly data: unknown } | AccountFailure;

async function requestAccount(session: AccountSession, method: "GET" | "DELETE", path: string): Promise<AccountResponse> {
  let response: { readonly data: unknown; readonly error: unknown };
  try {
    // The Expo auth client attaches the session cookie from SecureStore to every $fetch.
    // Plain JSON.parse: the auth client's default parser turns ISO timestamps into Date objects, which the shared schemas reject.
    response = await session.client.$fetch(`${session.backendUrl}${path}`, { method, jsonParser: (text: string): unknown => JSON.parse(text) });
  } catch {
    // fetch rejects when the phone is offline or the backend cannot be reached.
    return failure("network");
  }
  // Raw server messages are never shown (Vera's HEN-78 review, item 8).
  return response.error ? failure("unknown") : { ok: true, data: response.data };
}

/** GET /account/export: the user's own data, formatted for the share sheet. */
export async function exportAccountData(session: AccountSession): Promise<AccountExportResult> {
  const response = await requestAccount(session, "GET", "/account/export");
  if (!response.ok) {
    return response;
  }
  const parsed = accountExportSchema.safeParse(response.data);
  return parsed.success ? { ok: true, json: JSON.stringify(parsed.data, null, 2) } : failure("unknown");
}

/** DELETE /account, then removes the session from SecureStore. The session stays when the server did not confirm. */
export async function deleteAccount(session: AccountSession): Promise<AccountDeletionResult> {
  const response = await requestAccount(session, "DELETE", "/account");
  if (!response.ok) {
    return response;
  }
  if (!accountDeletionResponseSchema.safeParse(response.data).success) {
    return failure("unknown");
  }
  await Promise.all(SESSION_STORAGE_KEYS.map((key) => session.secureStore.deleteItemAsync(key)));
  return { ok: true };
}
