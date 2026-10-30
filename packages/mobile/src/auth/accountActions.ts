import {
  accountDeletionCodeResponseSchema,
  accountDeletionResponseSchema,
  accountExportSchema,
  ageConfirmationStatusSchema,
  SIGN_UP_ATTESTATION_TEXT_VERSION,
  signUpAttestationStatusSchema,
  type AgeConfirmationStatus,
  type SignUpAttestationStatus,
} from "@bjj-roll/shared";
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
  readonly reason: "network" | "unknown" | "invalidCode" | "rateLimited";
  readonly message: string;
}
/** POST /account/delete-code. */
export type AccountCodeResult = { readonly ok: true } | AccountFailure;
export type AccountDeletionResult = { readonly ok: true } | AccountFailure;
export type AccountExportResult = { readonly ok: true; readonly json: string } | AccountFailure;
export type AgeConfirmationResult = { readonly ok: true; readonly status: AgeConfirmationStatus } | AccountFailure;
export type SignUpAttestationResult = { readonly ok: true; readonly status: SignUpAttestationStatus } | AccountFailure;

function failure(reason: AccountFailure["reason"]): AccountFailure {
  return { ok: false, reason, message: FAILURE_MESSAGES[reason] };
}

type AccountResponse = { readonly ok: true; readonly data: unknown } | AccountFailure;

const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;

function failureForStatus(status: number | undefined): AccountFailure {
  // 403 from DELETE /account: the code is wrong, expired, superseded or used up.
  if (status === HTTP_FORBIDDEN) {
    return failure("invalidCode");
  }
  return failure(status === HTTP_TOO_MANY_REQUESTS ? "rateLimited" : "unknown");
}

interface AccountRequest {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  readonly body?: Record<string, string | boolean>;
  /** Aborts the request, e.g. when the startup deadline runs out (HEN-310). */
  readonly signal?: AbortSignal;
}

async function requestAccount(session: AccountSession, { method, path, body, signal }: AccountRequest): Promise<AccountResponse> {
  let response: { readonly data: unknown; readonly error: { readonly status?: number } | null };
  try {
    // The Expo auth client attaches the session cookie from SecureStore to every $fetch.
    // Plain JSON.parse: the auth client's default parser turns ISO timestamps into Date objects, which the shared schemas reject.
    response = await session.client.$fetch(`${session.backendUrl}${path}`, {
      method,
      ...(body ? { body } : {}),
      signal,
      jsonParser: (text: string): unknown => JSON.parse(text),
    });
  } catch {
    // fetch rejects when the phone is offline or the backend cannot be reached.
    return failure("network");
  }
  // Raw server messages are never shown (Vera's HEN-78 review, item 8).
  return response.error ? failureForStatus(response.error.status) : { ok: true, data: response.data };
}

/** GET /account/export: the user's own data, formatted for the share sheet. */
export async function exportAccountData(session: AccountSession): Promise<AccountExportResult> {
  const response = await requestAccount(session, { method: "GET", path: "/account/export" });
  if (!response.ok) {
    return response;
  }
  const parsed = accountExportSchema.safeParse(response.data);
  return parsed.success ? { ok: true, json: JSON.stringify(parsed.data, null, 2) } : failure("unknown");
}

function parseAgeStatus(response: AccountResponse): AgeConfirmationResult {
  if (!response.ok) {
    return response;
  }
  const parsed = ageConfirmationStatusSchema.safeParse(response.data);
  return parsed.success ? { ok: true, status: parsed.data } : failure("unknown");
}

/** GET /account/age-confirmation: whether the account confirmed 16+ and 18+, and so whether it can buy (HEN-263). */
export async function readAgeConfirmation(session: AccountSession): Promise<AgeConfirmationResult> {
  return parseAgeStatus(await requestAccount(session, { method: "GET", path: "/account/age-confirmation" }));
}

/** POST /account/age-confirmation: records a new 18+ confirmation. Only deleting the account undoes it. */
export async function confirmAdult(session: AccountSession): Promise<AgeConfirmationResult> {
  return parseAgeStatus(await requestAccount(session, { method: "POST", path: "/account/age-confirmation", body: { age18Confirmed: true } }));
}

function parseAttestationStatus(response: AccountResponse): SignUpAttestationResult {
  if (!response.ok) {
    return response;
  }
  const parsed = signUpAttestationStatusSchema.safeParse(response.data);
  return parsed.success ? { ok: true, status: parsed.data } : failure("unknown");
}

/** GET /account/signup-attestation: `required` until the account accepted the current text version (HEN-183). */
export async function readSignUpAttestation(session: AccountSession, signal?: AbortSignal): Promise<SignUpAttestationResult> {
  return parseAttestationStatus(await requestAccount(session, { method: "GET", path: "/account/signup-attestation", signal }));
}

/** POST /account/signup-attestation: accepts the text version the app shows; the server takes the current one only. */
export async function acceptSignUpAttestation(session: AccountSession): Promise<SignUpAttestationResult> {
  const body = { textVersionId: SIGN_UP_ATTESTATION_TEXT_VERSION.id };
  return parseAttestationStatus(await requestAccount(session, { method: "POST", path: "/account/signup-attestation", body }));
}

/** POST /account/delete-code: the backend emails a fresh 6-digit code to the signed-in user's own address. */
export async function requestAccountDeletionCode(session: AccountSession): Promise<AccountCodeResult> {
  const response = await requestAccount(session, { method: "POST", path: "/account/delete-code" });
  if (!response.ok) {
    return response;
  }
  return accountDeletionCodeResponseSchema.safeParse(response.data).success ? { ok: true } : failure("unknown");
}

/** DELETE /account with the emailed code, then removes the session from SecureStore. The session stays when the server did not confirm. */
export async function deleteAccount(session: AccountSession, code: string): Promise<AccountDeletionResult> {
  const response = await requestAccount(session, { method: "DELETE", path: "/account", body: { code } });
  if (!response.ok) {
    return response;
  }
  if (!accountDeletionResponseSchema.safeParse(response.data).success) {
    return failure("unknown");
  }
  await Promise.all(SESSION_STORAGE_KEYS.map((key) => session.secureStore.deleteItemAsync(key)));
  return { ok: true };
}
