import { AGE_REQUIRED_MESSAGE, isEmailAddress, type EmailEntry } from "./ageConfirmation";
import { DEEP_LINK_SCHEME, SESSION_STORAGE_PREFIX, type MobileAuthClient } from "./authClient";

export const MAGIC_LINK_CALLBACK_URL = `${DEEP_LINK_SCHEME}://auth`;

export type ActionResult = { readonly ok: true } | { readonly ok: false; readonly message: string | null };

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";
const OTP_PATTERN = /^\d{6}$/u;

function checkEntry(entry: EmailEntry): ActionResult | null {
  if (!entry.ageConfirmed) {
    return { ok: false, message: AGE_REQUIRED_MESSAGE };
  }
  if (!isEmailAddress(entry.email)) {
    return { ok: false, message: "Enter a valid email address." };
  }
  return null;
}

async function postAuth(client: MobileAuthClient, path: string, body: Record<string, unknown>): Promise<ActionResult> {
  const { error } = await client.$fetch(path, { method: "POST", body });
  if (error) {
    return { ok: false, message: error.message ?? GENERIC_ERROR_MESSAGE };
  }
  return { ok: true };
}

/** Emails a 6-digit sign-in code. No request is sent unless the 17+ box is ticked. */
export async function sendEmailCode(client: MobileAuthClient, entry: EmailEntry): Promise<ActionResult> {
  const refused = checkEntry(entry);
  if (refused) {
    return refused;
  }
  return await postAuth(client, "/email-otp/send-verification-otp", { email: entry.email.trim(), type: "sign-in", ageConfirmed: true });
}

/** Emails a magic link that opens the app at bjjroll://auth. No request unless the 17+ box is ticked. */
export async function sendMagicLink(client: MobileAuthClient, entry: EmailEntry): Promise<ActionResult> {
  const refused = checkEntry(entry);
  if (refused) {
    return refused;
  }
  return await postAuth(client, "/sign-in/magic-link", { email: entry.email.trim(), callbackURL: MAGIC_LINK_CALLBACK_URL, ageConfirmed: true });
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
    return { ok: false, message: "Enter the 6-digit code from the email." };
  }
  return await postAuth(client, "/sign-in/email-otp", { email: entry.email.trim(), otp: code, ageConfirmed: true });
}

/** Handles a bjjroll://auth deep link: swaps its one-time code for a session. Other URLs are ignored (message null). */
export async function completeMagicLink(client: MobileAuthClient, url: string): Promise<ActionResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, message: null };
  }
  if (parsed.protocol !== `${DEEP_LINK_SCHEME}:` || parsed.host !== "auth") {
    return { ok: false, message: null };
  }
  if (parsed.searchParams.has("error")) {
    return { ok: false, message: "This sign-in link is invalid or has expired. Request a new one." };
  }
  const code = parsed.searchParams.get("code");
  if (!code) {
    return { ok: false, message: null };
  }
  return await postAuth(client, "/magic-link/exchange", { code });
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
