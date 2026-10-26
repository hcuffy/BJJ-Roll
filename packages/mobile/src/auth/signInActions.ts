import { AGE_GATE_REFUSAL_MESSAGE, isAgeConfirmed, isEmailAddress, type EmailEntry } from "./ageConfirmation";
import { DEEP_LINK_SCHEME, SESSION_STORAGE_PREFIX, type MobileAuthClient } from "./authClient";

export const MAGIC_LINK_CALLBACK_URL = `${DEEP_LINK_SCHEME}://auth`;

/** Why an action failed; screens use it to place the message next to the field it is about. */
export type FailureReason = "ageRequired" | "invalidEmail" | "invalidCode" | "invalidLink" | "network" | "rateLimited" | "unknown" | "ignored";

export type ActionResult = { readonly ok: true } | { readonly ok: false; readonly reason: FailureReason; readonly message: string | null };

/** Mirrors OTP_EXPIRY_MINUTES in backend/src/auth/authLimits.ts (a test keeps the two in step). */
export const OTP_EXPIRY_MINUTES = 10;

/** Mirrors MAGIC_LINK_EXPIRY_MINUTES in backend/src/auth/authLimits.ts (a test keeps the two in step). */
export const MAGIC_LINK_EXPIRY_MINUTES = 15;

// Plain-language copy (Vera's HEN-78 review, item 8). Raw server messages are never shown.
export const FAILURE_MESSAGES = {
  invalidEmail: "Enter a valid email address.",
  invalidCode: "That code didn't work. Check the email or send a new code.",
  invalidLink: "This sign-in link is invalid or has expired. Request a new one.",
  network: "No connection. Check your internet and try again.",
  rateLimited: "Too many tries. Wait a minute and try again.",
  unknown: "Something went wrong. Please try again.",
} as const;
const INVALID_CODE_ERRORS = new Set(["INVALID_OTP", "OTP_EXPIRED", "TOO_MANY_ATTEMPTS"]);
const HTTP_TOO_MANY_REQUESTS = 429;
/** Error code of the backend's refusal when a new account's latest send had no `age16Confirmed: true` (HEN-77, HEN-263). */
export const AGE_CONFIRMATION_REQUIRED_CODE = "AGE_CONFIRMATION_REQUIRED";
const OTP_PATTERN = /^\d{6}$/u;

function failure(reason: Exclude<FailureReason, "ageRequired" | "ignored">): ActionResult {
  return { ok: false, reason, message: FAILURE_MESSAGES[reason] };
}

function checkEntry(entry: EmailEntry): ActionResult | null {
  if (!isAgeConfirmed(entry)) {
    return { ok: false, reason: "ageRequired", message: AGE_GATE_REFUSAL_MESSAGE };
  }
  if (!isEmailAddress(entry.email)) {
    return failure("invalidEmail");
  }
  return null;
}

type ClientErrorReason = "invalidCode" | "invalidLink";

interface AuthRequest {
  readonly path: string;
  readonly body: Record<string, unknown>;
  /** How to read a 4xx that is not the age refusal or a rate limit. */
  readonly clientErrorReason?: ClientErrorReason;
}

async function postAuth(client: MobileAuthClient, { path, body, clientErrorReason }: AuthRequest): Promise<ActionResult> {
  let error: { readonly status: number; readonly code?: unknown } | null;
  try {
    ({ error } = await client.$fetch(path, { method: "POST", body }));
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
  if (error.status === HTTP_TOO_MANY_REQUESTS) {
    return failure("rateLimited");
  }
  if (clientErrorReason === "invalidCode" && typeof error.code === "string" && INVALID_CODE_ERRORS.has(error.code)) {
    return failure("invalidCode");
  }
  if (clientErrorReason === "invalidLink" && error.status >= 400 && error.status < 500) {
    return failure("invalidLink");
  }
  return failure("unknown");
}

/** Emails a 6-digit sign-in code. No request is sent unless the 16+ box is ticked. */
export async function sendEmailCode(client: MobileAuthClient, entry: EmailEntry): Promise<ActionResult> {
  const refused = checkEntry(entry);
  if (refused) {
    return refused;
  }
  return await postAuth(client, {
    path: "/email-otp/send-verification-otp",
    body: { email: entry.email.trim(), type: "sign-in", age16Confirmed: true, age18Confirmed: entry.age18Confirmed === true },
  });
}

/** Emails a magic link that opens the app at bjjroll://auth. No request unless the 16+ box is ticked. */
export async function sendMagicLink(client: MobileAuthClient, entry: EmailEntry): Promise<ActionResult> {
  const refused = checkEntry(entry);
  if (refused) {
    return refused;
  }
  return await postAuth(client, {
    path: "/sign-in/magic-link",
    body: { email: entry.email.trim(), callbackURL: MAGIC_LINK_CALLBACK_URL, age16Confirmed: true, age18Confirmed: entry.age18Confirmed === true },
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

/** Handles a bjjroll://auth deep link: swaps its one-time code for a session. Other URLs are ignored (message null). */
export async function completeMagicLink(client: MobileAuthClient, url: string): Promise<ActionResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "ignored", message: null };
  }
  if (parsed.protocol !== `${DEEP_LINK_SCHEME}:` || parsed.host !== "auth") {
    return { ok: false, reason: "ignored", message: null };
  }
  // The backend refuses a new account at link verification when the send had no 16+ tick (HEN-263).
  if (parsed.searchParams.get("error") === AGE_CONFIRMATION_REQUIRED_CODE) {
    return { ok: false, reason: "ageRequired", message: AGE_GATE_REFUSAL_MESSAGE };
  }
  if (parsed.searchParams.has("error")) {
    return failure("invalidLink");
  }
  const code = parsed.searchParams.get("code");
  if (!code) {
    return { ok: false, reason: "ignored", message: null };
  }
  return await postAuth(client, { path: "/magic-link/exchange", body: { code }, clientErrorReason: "invalidLink" });
}

/** User id of the stored session, or null when signed out (also on network errors). */
export async function readSignedInUserId(client: MobileAuthClient): Promise<string | null> {
  const { data } = await client.getSession();
  return data?.user.id ?? null;
}

/** The SecureStore keys the Expo auth client writes; sign-out deletes both. */
export const SESSION_STORAGE_KEYS = [`${SESSION_STORAGE_PREFIX}_cookie`, `${SESSION_STORAGE_PREFIX}_session_data`] as const;

export interface SessionKeyStore {
  readonly deleteItemAsync: (key: string) => Promise<void>;
}

/** Signs out on the server, then deletes the session from SecureStore (also when the server cannot be reached). */
export async function signOut(client: MobileAuthClient, secureStore: SessionKeyStore): Promise<void> {
  try {
    await client.signOut();
  } catch {
    // Offline or server error: the local session is still removed below, so the user is signed out on this phone.
  }
  await Promise.all(SESSION_STORAGE_KEYS.map((key) => secureStore.deleteItemAsync(key)));
}
