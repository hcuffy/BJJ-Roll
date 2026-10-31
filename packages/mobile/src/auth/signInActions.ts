import { MAGIC_LINK_REASON_PARAM, MAGIC_LINK_REASONS, SIGN_UP_ATTESTATION_REFUSAL_MESSAGE, SIGN_UP_ATTESTATION_TEXT_VERSION } from "@bjj-roll/shared";
import { AGE_GATE_REFUSAL_MESSAGE, isAgeConfirmed, isEmailAddress, isSignUpAttestationAccepted, type EmailEntry } from "./ageConfirmation";
import { DEEP_LINK_SCHEME, SESSION_GONE_STATUSES, SESSION_STORAGE_PREFIX, type MobileAuthClient } from "./authClient";
import {
  addPendingSignOut,
  dropPendingSignOut,
  oldSessionCookieOf,
  PENDING_WITHOUT_SESSION_COOKIE,
  readPendingSignOuts,
  type SessionKeyStore,
} from "./pendingSignOuts";

export const MAGIC_LINK_CALLBACK_URL = `${DEEP_LINK_SCHEME}://auth`;

export type FailureReason =
  | "ageRequired"
  | "attestationRequired"
  | "invalidEmail"
  | "invalidCode"
  | "invalidLink"
  | "accountNotLinked"
  | "network"
  | "rateLimited"
  | "unknown"
  | "ignored";

export type ActionResult = { readonly ok: true } | { readonly ok: false; readonly reason: FailureReason; readonly message: string | null };

export const OTP_EXPIRY_MINUTES = 10;

export const MAGIC_LINK_EXPIRY_MINUTES = 15;

export const FAILURE_MESSAGES = {
  invalidEmail: "Enter a valid email address.",
  invalidCode: "That code didn't work. Check the email or send a new code.",
  invalidLink: "This sign-in link has expired or was already used. Send a new one.",
  accountNotLinked: "We couldn't sign you in this way. Sign in with your email instead.",
  network: "No connection. Check your internet and try again.",
  rateLimited: "Too many tries. Wait a minute and try again.",
  unknown: "Something went wrong. Please try again.",
} as const;
const INVALID_CODE_ERRORS = new Set(["INVALID_OTP", "OTP_EXPIRED", "TOO_MANY_ATTEMPTS"]);
const OAUTH_LINK_ERROR_CODE = "OAUTH_LINK_ERROR";
const HTTP_TOO_MANY_REQUESTS = 429;
export const AGE_CONFIRMATION_REQUIRED_CODE = "AGE_CONFIRMATION_REQUIRED";
export const SIGN_UP_ATTESTATION_REQUIRED_CODE = "SIGN_UP_ATTESTATION_REQUIRED";
export const ATTESTATION_REQUIRED: ActionResult = { ok: false, reason: "attestationRequired", message: SIGN_UP_ATTESTATION_REFUSAL_MESSAGE };
const OTP_PATTERN = /^\d{6}$/u;

export function failure(reason: Exclude<FailureReason, "ageRequired" | "attestationRequired" | "ignored">): ActionResult {
  return { ok: false, reason, message: FAILURE_MESSAGES[reason] };
}

function checkEntry(entry: EmailEntry): ActionResult | null {
  if (!isAgeConfirmed(entry)) {
    return { ok: false, reason: "ageRequired", message: AGE_GATE_REFUSAL_MESSAGE };
  }
  if (!isSignUpAttestationAccepted(entry)) {
    return ATTESTATION_REQUIRED;
  }
  if (!isEmailAddress(entry.email)) {
    return failure("invalidEmail");
  }
  return null;
}

type ClientErrorReason = "invalidCode" | "invalidLink";

export interface AuthRequest {
  readonly path: string;
  readonly body: Record<string, unknown>;
  readonly clientErrorReason?: ClientErrorReason;
  readonly signal?: AbortSignal;
}

export async function postAuth(client: MobileAuthClient, { path, body, clientErrorReason, signal }: AuthRequest): Promise<ActionResult> {
  let error: { readonly status: number; readonly code?: unknown } | null;
  try {
    ({ error } = await client.$fetch(path, { method: "POST", body, signal }));
  } catch {
    return failure("network");
  }
  if (!error) {
    return { ok: true };
  }
  if (error.code === AGE_CONFIRMATION_REQUIRED_CODE) {
    return { ok: false, reason: "ageRequired", message: AGE_GATE_REFUSAL_MESSAGE };
  }
  if (error.code === SIGN_UP_ATTESTATION_REQUIRED_CODE) {
    return ATTESTATION_REQUIRED;
  }
  if (error.status === HTTP_TOO_MANY_REQUESTS) {
    return failure("rateLimited");
  }
  if (error.code === OAUTH_LINK_ERROR_CODE) {
    return failure("accountNotLinked");
  }
  if (clientErrorReason === "invalidCode" && typeof error.code === "string" && INVALID_CODE_ERRORS.has(error.code)) {
    return failure("invalidCode");
  }
  if (clientErrorReason === "invalidLink" && error.status >= 400 && error.status < 500) {
    return failure("invalidLink");
  }
  return failure("unknown");
}

function signUpAnswers(entry: EmailEntry) {
  return { age16Confirmed: true, age18Confirmed: entry.age18Confirmed === true, signUpAttestationTextVersionId: SIGN_UP_ATTESTATION_TEXT_VERSION.id };
}

export async function sendEmailCode(client: MobileAuthClient, entry: EmailEntry): Promise<ActionResult> {
  const refused = checkEntry(entry);
  if (refused) {
    return refused;
  }
  return await postAuth(client, {
    path: "/email-otp/send-verification-otp",
    body: { email: entry.email.trim(), type: "sign-in", ...signUpAnswers(entry) },
  });
}

export async function sendMagicLink(client: MobileAuthClient, entry: EmailEntry): Promise<ActionResult> {
  const refused = checkEntry(entry);
  if (refused) {
    return refused;
  }
  return await postAuth(client, {
    path: "/sign-in/magic-link",
    body: { email: entry.email.trim(), callbackURL: MAGIC_LINK_CALLBACK_URL, ...signUpAnswers(entry) },
  });
}

export interface CodeEntry extends EmailEntry {
  readonly code: string;
}

export async function verifyEmailCode(client: MobileAuthClient, entry: CodeEntry): Promise<ActionResult> {
  const refused = checkEntry(entry);
  if (refused) {
    return refused;
  }
  const code = entry.code.trim();
  if (!OTP_PATTERN.test(code)) {
    return { ok: false, reason: "invalidCode", message: "Enter the 6-digit code from the email." };
  }
  return await postAuth(client, {
    path: "/sign-in/email-otp",
    body: { email: entry.email.trim(), otp: code, age16Confirmed: true },
    clientErrorReason: "invalidCode",
  });
}

export const SOCIAL_SIGN_IN_CALLBACK_PATH = "/social";

export async function completeMagicLink(client: MobileAuthClient, url: string, signal?: AbortSignal): Promise<ActionResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "ignored", message: null };
  }
  if (parsed.protocol !== `${DEEP_LINK_SCHEME}:` || parsed.host !== "auth" || parsed.pathname === SOCIAL_SIGN_IN_CALLBACK_PATH) {
    return { ok: false, reason: "ignored", message: null };
  }
  const reason = parsed.searchParams.get(MAGIC_LINK_REASON_PARAM);
  if (reason === MAGIC_LINK_REASONS.ageRefused) {
    return { ok: false, reason: "ageRequired", message: AGE_GATE_REFUSAL_MESSAGE };
  }
  if (reason === MAGIC_LINK_REASONS.attestationRefused) {
    return ATTESTATION_REQUIRED;
  }
  if (reason === MAGIC_LINK_REASONS.linkInvalid) {
    return failure("invalidLink");
  }
  if (reason !== null || parsed.searchParams.has("error")) {
    return failure("unknown");
  }
  const code = parsed.searchParams.get("code");
  if (!code) {
    return { ok: false, reason: "ignored", message: null };
  }
  return await postAuth(client, { path: "/magic-link/exchange", body: { code }, clientErrorReason: "invalidLink", signal });
}

export async function readSignedInUserId(client: MobileAuthClient, signal?: AbortSignal): Promise<string | null> {
  const { data } = await client.getSession({ fetchOptions: { signal } });
  return data?.user.id ?? null;
}

export const SESSION_STORAGE_KEYS = [`${SESSION_STORAGE_PREFIX}_cookie`, `${SESSION_STORAGE_PREFIX}_session_data`] as const;

export { PENDING_SIGN_OUT_KEY, type SessionKeyStore } from "./pendingSignOuts";

async function readSessionCookie(client: MobileAuthClient): Promise<string | null> {
  try {
    return (await client.getCookie()).split("; ").find((cookie) => cookie.split("=")[0]?.endsWith("session_token")) ?? null;
  } catch {
    return null;
  }
}

interface SignOutAttempt {
  readonly oldSessionCookie: string | null;
  readonly signal?: AbortSignal;
}

async function signOutOnServer(client: MobileAuthClient, { oldSessionCookie, signal }: SignOutAttempt): Promise<boolean> {
  try {
    if (oldSessionCookie !== null) {
      return await client.signOutSessionCookie(oldSessionCookie, signal);
    }
    const { error } = await client.signOut({ fetchOptions: { signal } });
    return !error || SESSION_GONE_STATUSES.has(error.status);
  } catch {
    return false;
  }
}

async function finishSignOut(client: MobileAuthClient, secureStore: SessionKeyStore, attempt: SignOutAttempt): Promise<void> {
  const serverSignedOut = await signOutOnServer(client, attempt);
  if (attempt.signal?.aborted) {
    return;
  }
  const deletes = await Promise.allSettled(SESSION_STORAGE_KEYS.map((key) => secureStore.deleteItemAsync(key)));
  if (serverSignedOut && deletes.every((result) => result.status === "fulfilled")) {
    await dropPendingSignOut(secureStore, attempt.oldSessionCookie ?? PENDING_WITHOUT_SESSION_COOKIE);
  }
}

async function revokeOldSession(
  client: MobileAuthClient,
  secureStore: SessionKeyStore,
  attempt: SignOutAttempt & { readonly oldSessionCookie: string },
): Promise<void> {
  const confirmed = await signOutOnServer(client, attempt);
  if (confirmed && !attempt.signal?.aborted) {
    await dropPendingSignOut(secureStore, attempt.oldSessionCookie);
  }
}

export async function signOut(client: MobileAuthClient, secureStore: SessionKeyStore, signal?: AbortSignal): Promise<void> {
  await endLeftoverSessions(client, secureStore, signal);
  const sessionCookie = await readSessionCookie(client);
  await addPendingSignOut(secureStore, sessionCookie ?? PENDING_WITHOUT_SESSION_COOKIE);
  await Promise.allSettled(SESSION_STORAGE_KEYS.map((key) => secureStore.deleteItemAsync(key)));
  await finishSignOut(client, secureStore, { oldSessionCookie: sessionCookie, signal });
}

export async function cancelPendingSignOut(client: MobileAuthClient, secureStore: SessionKeyStore, signal?: AbortSignal): Promise<void> {
  await endLeftoverSessions(client, secureStore, signal);
}

async function endLeftoverSessions(client: MobileAuthClient, secureStore: SessionKeyStore, signal?: AbortSignal): Promise<void> {
  const storedSessionCookie = await readSessionCookie(client);
  for (const marker of (await readPendingSignOuts(secureStore)) ?? []) {
    const oldSessionCookie = oldSessionCookieOf(marker);
    if (oldSessionCookie === null || oldSessionCookie === storedSessionCookie) {
      await dropPendingSignOut(secureStore, marker);
    } else {
      await revokeOldSession(client, secureStore, { oldSessionCookie, signal });
    }
  }
}

export async function finishPendingSignOut(client: MobileAuthClient, secureStore: SessionKeyStore, signal?: AbortSignal): Promise<boolean> {
  const storedSessionCookie = await readSessionCookie(client);
  const oldSessionCookies = ((await readPendingSignOuts(secureStore)) ?? []).map((marker) => oldSessionCookieOf(marker));
  const isOldSession = (cookie: string | null): cookie is string => cookie !== null && storedSessionCookie !== null && storedSessionCookie !== cookie;
  const signOutPending = !oldSessionCookies.every(isOldSession);
  let olderSessionsEnded = Promise.resolve();
  for (const oldSessionCookie of signOutPending ? oldSessionCookies : []) {
    if (isOldSession(oldSessionCookie)) {
      olderSessionsEnded = olderSessionsEnded.then(async () => await revokeOldSession(client, secureStore, { oldSessionCookie, signal }));
    } else {
      await olderSessionsEnded;
      await finishSignOut(client, secureStore, { oldSessionCookie, signal });
    }
  }
  return signOutPending;
}
