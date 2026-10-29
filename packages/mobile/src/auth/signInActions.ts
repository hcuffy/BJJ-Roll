import { MAGIC_LINK_REASON_PARAM, MAGIC_LINK_REASONS, SIGN_UP_ATTESTATION_REFUSAL_MESSAGE, SIGN_UP_ATTESTATION_TEXT_VERSION } from "@bjj-roll/shared";
import { AGE_GATE_REFUSAL_MESSAGE, isAgeConfirmed, isEmailAddress, isSignUpAttestationAccepted, type EmailEntry } from "./ageConfirmation";
import { DEEP_LINK_SCHEME, SESSION_STORAGE_PREFIX, type MobileAuthClient } from "./authClient";
import {
  addPendingSignOut,
  dropPendingSignOut,
  oldSessionCookieOf,
  PENDING_WITHOUT_SESSION_COOKIE,
  readPendingSignOuts,
  type SessionKeyStore,
} from "./pendingSignOuts";

export const MAGIC_LINK_CALLBACK_URL = `${DEEP_LINK_SCHEME}://auth`;

/** Why an action failed; screens use it to place the message next to the field it is about. */
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

/** Mirrors OTP_EXPIRY_MINUTES in backend/src/auth/authLimits.ts (a test keeps the two in step). */
export const OTP_EXPIRY_MINUTES = 10;

/** Mirrors MAGIC_LINK_EXPIRY_MINUTES in backend/src/auth/authLimits.ts (a test keeps the two in step). */
export const MAGIC_LINK_EXPIRY_MINUTES = 15;

// Plain-language copy (Vera's HEN-78 review, item 8). Raw server messages are never shown.
export const FAILURE_MESSAGES = {
  invalidEmail: "Enter a valid email address.",
  invalidCode: "That code didn't work. Check the email or send a new code.",
  invalidLink: "This sign-in link has expired or was already used. Send a new one.",
  // HEN-239 (Sara): neutral, so the answer never says whether an email has an account.
  accountNotLinked: "We couldn't sign you in this way. Sign in with your email instead.",
  network: "No connection. Check your internet and try again.",
  rateLimited: "Too many tries. Wait a minute and try again.",
  unknown: "Something went wrong. Please try again.",
} as const;
const INVALID_CODE_ERRORS = new Set(["INVALID_OTP", "OTP_EXPIRED", "TOO_MANY_ATTEMPTS"]);
/** The backend's refusal of a social sign-in whose email the provider did not verify (one answer for every email). */
const OAUTH_LINK_ERROR_CODE = "OAUTH_LINK_ERROR";
const HTTP_TOO_MANY_REQUESTS = 429;
/** Error code of the backend's refusal when a new account's latest send had no `age16Confirmed: true` (HEN-77, HEN-263). */
export const AGE_CONFIRMATION_REQUIRED_CODE = "AGE_CONFIRMATION_REQUIRED";
/** Error code of the backend's refusal when a new account's latest send had no current attestation version (HEN-183). */
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
  /** How to read a 4xx that is not the age refusal or a rate limit. */
  readonly clientErrorReason?: ClientErrorReason;
  /** Aborts the request, e.g. when a startup step times out. */
  readonly signal?: AbortSignal;
}

export async function postAuth(client: MobileAuthClient, { path, body, clientErrorReason, signal }: AuthRequest): Promise<ActionResult> {
  let error: { readonly status: number; readonly code?: unknown } | null;
  try {
    ({ error } = await client.$fetch(path, { method: "POST", body, signal }));
  } catch {
    // fetch rejects when the phone is offline or the backend cannot be reached.
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

/** The sign-up answers every send carries: 16+, the optional 18+, and the attestation text version the user accepted (HEN-183). */
function signUpAnswers(entry: EmailEntry) {
  return { age16Confirmed: true, age18Confirmed: entry.age18Confirmed === true, signUpAttestationTextVersionId: SIGN_UP_ATTESTATION_TEXT_VERSION.id };
}

/** Emails a 6-digit sign-in code. No request is sent unless the 16+ and attestation boxes are ticked. */
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

/** Emails a magic link that opens the app at bjjroll://auth. No request unless the 16+ and attestation boxes are ticked. */
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

/** Signs in with the emailed code; the Expo client stores the session cookie in SecureStore. */
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

/** Apple and Google sign-in return here; the browser session hands that URL to socialSignIn.ts, so the deep-link handler skips it. */
export const SOCIAL_SIGN_IN_CALLBACK_PATH = "/social";

/** Handles a bjjroll://auth deep link: swaps its one-time code for a session. Other URLs are ignored (message null). */
export async function completeMagicLink(client: MobileAuthClient, url: string, signal?: AbortSignal): Promise<ActionResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "ignored", message: null };
  }
  // Android can also deliver the Apple or Google return as a deep link; its one-time code is already being exchanged by socialSignIn.ts.
  if (parsed.protocol !== `${DEEP_LINK_SCHEME}:` || parsed.host !== "auth" || parsed.pathname === SOCIAL_SIGN_IN_CALLBACK_PATH) {
    return { ok: false, reason: "ignored", message: null };
  }
  // A failed link carries a reason code only (HEN-263); the copy is the app's own. Any other code or a legacy
  // `error` param gets the generic message, so nothing from the URL is ever shown.
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

/** User id of the stored session, or null when signed out (also on network errors). */
export async function readSignedInUserId(client: MobileAuthClient, signal?: AbortSignal): Promise<string | null> {
  const { data } = await client.getSession({ fetchOptions: { signal } });
  return data?.user.id ?? null;
}

/** The SecureStore keys the Expo auth client writes; sign-out deletes both. */
export const SESSION_STORAGE_KEYS = [`${SESSION_STORAGE_PREFIX}_cookie`, `${SESSION_STORAGE_PREFIX}_session_data`] as const;

export { PENDING_SIGN_OUT_KEY, type SessionKeyStore } from "./pendingSignOuts";

/** The stored session cookie pair, as the server needs it to end that session. Null when there is none. */
async function readSessionCookie(client: MobileAuthClient): Promise<string | null> {
  try {
    return (await client.getCookie()).split("; ").find((cookie) => cookie.split("=")[0]?.endsWith("session_token")) ?? null;
  } catch {
    return null;
  }
}

/** One server sign-out: the old session cookie to present (null: the stored session), and a signal that aborts it on a startup timeout (HEN-303). */
interface SignOutAttempt {
  readonly oldSessionCookie: string | null;
  readonly signal?: AbortSignal;
}

/**
 * True only when the server confirmed the session is over. With an old cookie it presents that cookie, never the stored one.
 * Without one it falls back to the stored session (markers that hold no cookie).
 */
async function signOutOnServer(client: MobileAuthClient, { oldSessionCookie, signal }: SignOutAttempt): Promise<boolean> {
  try {
    if (oldSessionCookie !== null) {
      return await client.signOutSessionCookie(oldSessionCookie, signal);
    }
    const { error } = await client.signOut({ fetchOptions: { signal } });
    return !error;
  } catch {
    // Offline or the backend cannot be reached.
    return false;
  }
}

/** Ends the session on the server and on the phone; drops its pending entry only when both succeeded. */
async function finishSignOut(client: MobileAuthClient, secureStore: SessionKeyStore, attempt: SignOutAttempt): Promise<void> {
  const serverSignedOut = await signOutOnServer(client, attempt);
  // Timed out: leave keys and marker as they are, so a late answer cannot touch a session made since; the next launch retries (HEN-303).
  if (attempt.signal?.aborted) {
    return;
  }
  const deletes = await Promise.allSettled(SESSION_STORAGE_KEYS.map((key) => secureStore.deleteItemAsync(key)));
  if (serverSignedOut && deletes.every((result) => result.status === "fulfilled")) {
    await dropPendingSignOut(secureStore, attempt.oldSessionCookie ?? PENDING_WITHOUT_SESSION_COOKIE);
  }
}

/**
 * The marker belongs to a session older than the one now stored (a sign-in came after it): end that old session only.
 * Its entry is dropped once the server confirmed; otherwise it stays for the next launch. The stored session is never sent.
 */
async function revokeOldSession(
  client: MobileAuthClient,
  secureStore: SessionKeyStore,
  attempt: SignOutAttempt & { readonly oldSessionCookie: string },
): Promise<void> {
  // Failures are ignored silently and never logged, so the cookie never reaches a log.
  const confirmed = await signOutOnServer(client, attempt);
  // Timed out: keep the marker, so a late answer cannot clear a marker written since; the next launch retries (HEN-303).
  if (confirmed && !attempt.signal?.aborted) {
    await dropPendingSignOut(secureStore, attempt.oldSessionCookie);
  }
}

/**
 * Deletes the session from SecureStore, then ends it on the server (also when SecureStore writes fail, HEN-314).
 * `signal` is the caller's deadline; a server sign-out it cuts off is finished on the next launch. Never rejects.
 */
export async function signOut(client: MobileAuthClient, secureStore: SessionKeyStore, signal?: AbortSignal): Promise<void> {
  // Older sessions still waiting to be ended get one more try; those that fail stay queued (HEN-314).
  await endLeftoverSessions(client, secureStore, signal);
  // Queued first, so a sign-out that fails here is finished on the next launch. If it cannot be saved, sign out anyway.
  const sessionCookie = await readSessionCookie(client);
  // Accepted (Sara, HEN-314): if every SecureStore write fails and the server is down, a cold launch comes back signed in.
  await addPendingSignOut(secureStore, sessionCookie ?? PENDING_WITHOUT_SESSION_COOKIE);
  // The phone first, so a server that never answers cannot leave the session in use here.
  await Promise.allSettled(SESSION_STORAGE_KEYS.map((key) => secureStore.deleteItemAsync(key)));
  // Presents the cookie itself: the Expo plugin's own SecureStore writes on sign-out cannot stop the server sign-out.
  await finishSignOut(client, secureStore, { oldSessionCookie: sessionCookie, signal });
}

/**
 * Call when sign-in succeeds: the user signed in on purpose, so a sign-out left to finish must not end the new session.
 * Ends the old session by its own cookie (never the new one, any account). Without a confirmed end the marker stays and the
 * next launch retries it; the new session is not signed out for that. Never rejects and never blocks the sign-in.
 */
export async function cancelPendingSignOut(client: MobileAuthClient, secureStore: SessionKeyStore): Promise<void> {
  await endLeftoverSessions(client, secureStore);
}

/** Ends each queued session unless it is the one now stored; `signal` aborts the server requests. Never rejects. */
async function endLeftoverSessions(client: MobileAuthClient, secureStore: SessionKeyStore, signal?: AbortSignal): Promise<void> {
  const storedSessionCookie = await readSessionCookie(client);
  for (const marker of (await readPendingSignOuts(secureStore)) ?? []) {
    const oldSessionCookie = oldSessionCookieOf(marker);
    if (oldSessionCookie === null || oldSessionCookie === storedSessionCookie) {
      // Nothing to end, or it is the session now in use.
      await dropPendingSignOut(secureStore, marker);
    } else {
      await revokeOldSession(client, secureStore, { oldSessionCookie, signal });
    }
  }
}

/**
 * Run at launch before any session read. Retries an unfinished sign-out; true means one was pending,
 * so the user stays signed out on this launch even if the retry fails again.
 * A marker left by an earlier sign-in (a newer session is stored) only ends the old session; false, the user stays signed in.
 */
export async function finishPendingSignOut(client: MobileAuthClient, secureStore: SessionKeyStore, signal?: AbortSignal): Promise<boolean> {
  const storedSessionCookie = await readSessionCookie(client);
  let signOutPending = false;
  for (const marker of (await readPendingSignOuts(secureStore)) ?? []) {
    const oldSessionCookie = oldSessionCookieOf(marker);
    if (oldSessionCookie !== null && storedSessionCookie !== null && storedSessionCookie !== oldSessionCookie) {
      await revokeOldSession(client, secureStore, { oldSessionCookie, signal });
    } else {
      signOutPending = true;
      await finishSignOut(client, secureStore, { oldSessionCookie, signal });
    }
  }
  return signOutPending;
}
