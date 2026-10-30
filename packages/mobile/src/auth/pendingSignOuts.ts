import { SESSION_STORAGE_PREFIX } from "./authClient";

export interface SessionKeyStore {
  readonly deleteItemAsync: (key: string) => Promise<void>;
  readonly getItemAsync: (key: string) => Promise<string | null>;
  readonly setItemAsync: (key: string, value: string) => Promise<void>;
}

/**
 * Every sign-out the server has not confirmed yet, oldest first; a new one never replaces an older one (HEN-314).
 * Each holds that session's cookie (`<name>=<token>.<signature>`), so it can be ended on the server by presenting the cookie
 * itself, at the launch retry or at the next sign-in, for any account (HEN-299). Each is removed only on its own confirmed end,
 * or once it is older than any session can live on the server (HEN-315). Stored as a JSON list of `{ marker, queuedAt }`.
 */
export const PENDING_SIGN_OUT_KEY = `${SESSION_STORAGE_PREFIX}_pending_sign_out`;
/** Entry when the old session cookie is unknown (no session cookie, or a marker written before HEN-299). */
export const PENDING_WITHOUT_SESSION_COOKIE = "1";

/** Mirrors SESSION_ABSOLUTE_MAX_LIFETIME_DAYS in backend/src/auth/authLimits.ts (a test keeps the two in step). */
export const SESSION_MAX_LIFETIME_DAYS = 90;
const SESSION_MAX_LIFETIME_MS = SESSION_MAX_LIFETIME_DAYS * 24 * 60 * 60 * 1000;

interface PendingSignOut {
  readonly marker: string;
  /** When it was queued (ms since epoch). */
  readonly queuedAt: number;
}

/** The old session cookie an entry holds; null for an entry without one. */
export function oldSessionCookieOf(marker: string): string | null {
  return marker.includes("=") ? marker : null;
}

/**
 * One stored entry. One written before HEN-315 (a bare string) has no queue time, so it counts from now and is never dropped
 * early. Anything unreadable fails safe as a sign-out of the stored session (HEN-315, Bill D4).
 */
function entryOf(stored: unknown, now: number): PendingSignOut {
  if (typeof stored === "string") {
    return { marker: oldSessionCookieOf(stored) ?? PENDING_WITHOUT_SESSION_COOKIE, queuedAt: now };
  }
  if (typeof stored === "object" && stored !== null && "marker" in stored && "queuedAt" in stored) {
    const { marker, queuedAt } = stored;
    if (typeof marker === "string" && typeof queuedAt === "number" && Number.isFinite(queuedAt)) {
      return { marker: oldSessionCookieOf(marker) ?? PENDING_WITHOUT_SESSION_COOKIE, queuedAt };
    }
  }
  return { marker: PENDING_WITHOUT_SESSION_COOKIE, queuedAt: now };
}

function parseEntries(value: string): unknown[] {
  // A single-value marker (before HEN-314) is a list of one.
  if (!value.startsWith("[")) {
    return [value];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [null];
  } catch {
    return [null];
  }
}

/** The entries still worth retrying, oldest first: one past the server's maximum session lifetime has already ended there. */
async function readEntries(secureStore: SessionKeyStore): Promise<PendingSignOut[] | null> {
  let value: string | null;
  try {
    value = await secureStore.getItemAsync(PENDING_SIGN_OUT_KEY);
  } catch {
    return null;
  }
  const now = Date.now();
  const entries: PendingSignOut[] = [];
  for (const entry of value === null ? [] : parseEntries(value).map((stored) => entryOf(stored, now))) {
    if (now - entry.queuedAt < SESSION_MAX_LIFETIME_MS && !entries.some(({ marker }) => marker === entry.marker)) {
      entries.push(entry);
    }
  }
  return entries;
}

/** The pending entries, oldest first. Null when SecureStore cannot be read. */
export async function readPendingSignOuts(secureStore: SessionKeyStore): Promise<readonly string[] | null> {
  return (await readEntries(secureStore))?.map(({ marker }) => marker) ?? null;
}

async function writeEntries(secureStore: SessionKeyStore, entries: readonly PendingSignOut[]): Promise<void> {
  const write =
    entries.length === 0
      ? secureStore.deleteItemAsync(PENDING_SIGN_OUT_KEY)
      : secureStore.setItemAsync(PENDING_SIGN_OUT_KEY, JSON.stringify(entries));
  await write.catch(() => undefined);
}

/** The last queued change per store; each change waits for it, so two read-modify-writes never overlap (HEN-315). */
const lastChanges = new WeakMap<SessionKeyStore, Promise<void>>();

function changeQueue(secureStore: SessionKeyStore, change: (entries: readonly PendingSignOut[]) => PendingSignOut[] | null): Promise<void> {
  const changed = (lastChanges.get(secureStore) ?? Promise.resolve()).then(async () => {
    const entries = await readEntries(secureStore);
    const next = entries === null ? null : change(entries);
    if (next !== null) {
      await writeEntries(secureStore, next);
    }
  });
  lastChanges.set(secureStore, changed);
  return changed;
}

/** Queues a sign-out after the ones already waiting. Not written when the queue cannot be read, so none is lost. Never rejects. */
export async function addPendingSignOut(secureStore: SessionKeyStore, marker: string): Promise<void> {
  await changeQueue(secureStore, (entries) =>
    entries.some((entry) => entry.marker === marker) ? null : [...entries, { marker, queuedAt: Date.now() }],
  );
}

/** Removes one entry; the others stay queued. Never rejects. */
export async function dropPendingSignOut(secureStore: SessionKeyStore, marker: string): Promise<void> {
  await changeQueue(secureStore, (entries) =>
    entries.some((entry) => entry.marker === marker) ? entries.filter((entry) => entry.marker !== marker) : null,
  );
}
