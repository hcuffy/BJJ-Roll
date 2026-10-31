import {
  accountDeletionCodeResponseSchema,
  accountDeletionResponseSchema,
  accountExportSchema,
  ageConfirmationStatusSchema,
  signUpAttestationVersion,
  signUpAttestationStatusSchema,
  type AgeConfirmationStatus,
  type SignUpAttestationStatus,
} from "@bjj-roll/shared";
import type { MobileAuthClient } from "./authClient";
import { failureMessages, sessionStorageKeys, type SessionKeyStore } from "./signInActions";

export interface AccountSession {
  readonly client: MobileAuthClient;
  readonly secureStore: SessionKeyStore;
  readonly backendUrl: string;
}

interface AccountFailure {
  readonly ok: false;
  readonly reason: "network" | "unknown" | "invalidCode" | "rateLimited" | "signedOut";
  readonly message: string;
}
export type AccountCodeResult = { readonly ok: true } | AccountFailure;
export type AccountDeletionResult = { readonly ok: true; readonly sessionLeft?: true } | AccountFailure;
export type AccountDeletionExit = "deleted" | "sessionLeft" | "signedOut";
export type AccountExportResult = { readonly ok: true; readonly json: string } | AccountFailure;
export type AgeConfirmationResult = { readonly ok: true; readonly status: AgeConfirmationStatus } | AccountFailure;
export type SignUpAttestationResult = { readonly ok: true; readonly status: SignUpAttestationStatus } | AccountFailure;

function failure(reason: Exclude<AccountFailure["reason"], "signedOut">): AccountFailure {
  return { ok: false, reason, message: failureMessages[reason] };
}

type AccountResponse = { readonly ok: true; readonly data: unknown } | AccountFailure;

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;

function failureForStatus(status: number | undefined): AccountFailure {
  if (status === HTTP_UNAUTHORIZED) {
    return { ok: false, reason: "signedOut", message: failureMessages.unknown };
  }
  if (status === HTTP_FORBIDDEN) {
    return failure("invalidCode");
  }
  return failure(status === HTTP_TOO_MANY_REQUESTS ? "rateLimited" : "unknown");
}

interface AccountRequest {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  readonly body?: Record<string, string | boolean>;
  readonly signal?: AbortSignal;
}

async function requestAccount(session: AccountSession, { method, path, body, signal }: AccountRequest): Promise<AccountResponse> {
  let response: { readonly data: unknown; readonly error: { readonly status?: number } | null };
  try {
    response = await session.client.$fetch(`${session.backendUrl}${path}`, {
      method,
      ...(body ? { body } : {}),
      signal,
      jsonParser: (text: string): unknown => JSON.parse(text),
    });
  } catch {
    return failure("network");
  }
  return response.error ? failureForStatus(response.error.status) : { ok: true, data: response.data };
}

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

export async function readAgeConfirmation(session: AccountSession): Promise<AgeConfirmationResult> {
  return parseAgeStatus(await requestAccount(session, { method: "GET", path: "/account/age-confirmation" }));
}

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

export async function readSignUpAttestation(session: AccountSession, signal?: AbortSignal): Promise<SignUpAttestationResult> {
  return parseAttestationStatus(await requestAccount(session, { method: "GET", path: "/account/signup-attestation", signal }));
}

export async function acceptSignUpAttestation(session: AccountSession): Promise<SignUpAttestationResult> {
  const body = { textVersionId: signUpAttestationVersion.id };
  return parseAttestationStatus(await requestAccount(session, { method: "POST", path: "/account/signup-attestation", body }));
}

export async function requestAccountDeletionCode(session: AccountSession): Promise<AccountCodeResult> {
  const response = await requestAccount(session, { method: "POST", path: "/account/delete-code" });
  if (!response.ok) {
    return response;
  }
  return accountDeletionCodeResponseSchema.safeParse(response.data).success ? { ok: true } : failure("unknown");
}

export async function deleteAccount(session: AccountSession, code: string): Promise<AccountDeletionResult> {
  const response = await requestAccount(session, { method: "DELETE", path: "/account", body: { code } });
  if (!response.ok) {
    return response;
  }
  if (!accountDeletionResponseSchema.safeParse(response.data).success) {
    return failure("unknown");
  }
  const cleared = await Promise.all(sessionStorageKeys.map((key) => session.secureStore.deleteItemAsync(key))).then(
    () => true,
    () => false,
  );
  return cleared ? { ok: true } : { ok: true, sessionLeft: true };
}
