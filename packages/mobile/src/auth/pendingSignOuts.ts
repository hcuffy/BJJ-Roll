import { SESSION_STORAGE_PREFIX } from "./authClient";

export interface SessionKeyStore {
  readonly deleteItemAsync: (key: string) => Promise<void>;
  readonly getItemAsync: (key: string) => Promise<string | null>;
  readonly setItemAsync: (key: string, value: string) => Promise<void>;
}

/**
 * Every sign-out the server has not confirmed yet, oldest first; a new one never replaces an older one (HEN-314).
 * Each holds that session's cookie (`<name>=<token>.<signature>`), so it can be ended on the server by presenting the cookie
 * itself, at the launch retry or at the next sign-in, for any account (HEN-299). Each is removed only on its own confirmed end.
 * One entry is stored as the bare value, as before HEN-314; more as a JSON list.
 */
export const PENDING_SIGN_OUT_KEY = `${SESSION_STORAGE_PREFIX}_pending_sign_out`;
/** Entry when the old session cookie is unknown (no session cookie, or a marker written before HEN-299). */
export const PENDING_WITHOUT_SESSION_COOKIE = "1";

/** The old session cookie an entry holds; null for an entry without one. */
export function oldSessionCookieOf(marker: string): string | null {
  return marker.includes("=") ? marker : null;
}

/** The pending entries; a single-value marker (before HEN-314) is a list of one. Null when SecureStore cannot be read. */
export async function readPendingSignOuts(secureStore: SessionKeyStore): Promise<readonly string[] | null> {
  let value: string | null;
  try {
    value = await secureStore.getItemAsync(PENDING_SIGN_OUT_KEY);
  } catch {
    return null;
  }
  if (value === null) {
    return [];
  }
  if (!value.startsWith("[")) {
    return [value];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [value];
  } catch {
    return [value];
  }
}

async function writePendingSignOuts(secureStore: SessionKeyStore, markers: readonly string[]): Promise<void> {
  const [only, ...rest] = markers;
  const write =
    only === undefined
      ? secureStore.deleteItemAsync(PENDING_SIGN_OUT_KEY)
      : secureStore.setItemAsync(PENDING_SIGN_OUT_KEY, rest.length === 0 ? only : JSON.stringify(markers));
  await write.catch(() => undefined);
}

/** Queues a sign-out after the ones already waiting. Not written when the queue cannot be read, so none is lost. Never rejects. */
export async function addPendingSignOut(secureStore: SessionKeyStore, marker: string): Promise<void> {
  const markers = await readPendingSignOuts(secureStore);
  if (markers !== null && !markers.includes(marker)) {
    await writePendingSignOuts(secureStore, [...markers, marker]);
  }
}

/** Removes one entry; the others stay queued. Never rejects. */
export async function dropPendingSignOut(secureStore: SessionKeyStore, marker: string): Promise<void> {
  const markers = await readPendingSignOuts(secureStore);
  if (markers?.includes(marker)) {
    await writePendingSignOuts(
      secureStore,
      markers.filter((entry) => entry !== marker),
    );
  }
}
