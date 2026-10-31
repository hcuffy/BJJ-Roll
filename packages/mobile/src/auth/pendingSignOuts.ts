import { SESSION_STORAGE_PREFIX } from "./authClient";
import { currentMs } from "../dates";

export interface SessionKeyStore {
  readonly deleteItemAsync: (key: string) => Promise<void>;
  readonly getItemAsync: (key: string) => Promise<string | null>;
  readonly setItemAsync: (key: string, value: string) => Promise<void>;
}

export const PENDING_SIGN_OUT_KEY = `${SESSION_STORAGE_PREFIX}_pending_sign_out`;
export const PENDING_WITHOUT_SESSION_COOKIE = "1";

export const SESSION_MAX_LIFETIME_DAYS = 90;
const SESSION_MAX_LIFETIME_MS = SESSION_MAX_LIFETIME_DAYS * 24 * 60 * 60 * 1000;

interface PendingSignOut {
  readonly marker: string;
  readonly queuedAt: number;
}

export function oldSessionCookieOf(marker: string): string | null {
  return marker.includes("=") ? marker : null;
}

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

interface StoredQueue {
  readonly entries: PendingSignOut[];
  readonly pruned: boolean;
}

async function readEntries(secureStore: SessionKeyStore): Promise<StoredQueue | null> {
  let value: string | null;
  try {
    value = await secureStore.getItemAsync(PENDING_SIGN_OUT_KEY);
  } catch {
    return null;
  }
  const now = currentMs();
  const entries: PendingSignOut[] = [];
  const stored = value === null ? [] : parseEntries(value).map((item) => entryOf(item, now));
  for (const entry of stored) {
    if (now - entry.queuedAt < SESSION_MAX_LIFETIME_MS && !entries.some(({ marker }) => marker === entry.marker)) {
      entries.push(entry);
    }
  }
  return { entries, pruned: entries.length < stored.length };
}

export async function readPendingSignOuts(secureStore: SessionKeyStore): Promise<readonly string[] | null> {
  const queue = await readEntries(secureStore);
  if (queue?.pruned) {
    await changeQueue(secureStore, () => null).catch(() => undefined);
  }
  return queue?.entries.map(({ marker }) => marker) ?? null;
}

async function writeEntries(secureStore: SessionKeyStore, entries: readonly PendingSignOut[]): Promise<void> {
  await (entries.length === 0
    ? secureStore.deleteItemAsync(PENDING_SIGN_OUT_KEY)
    : secureStore.setItemAsync(PENDING_SIGN_OUT_KEY, JSON.stringify(entries)));
}

const lastChanges = new WeakMap<SessionKeyStore, Promise<void>>();

function changeQueue(secureStore: SessionKeyStore, change: (entries: readonly PendingSignOut[]) => PendingSignOut[] | null): Promise<void> {
  const changed = (lastChanges.get(secureStore) ?? Promise.resolve()).then(async () => {
    const queue = await readEntries(secureStore);
    const next = queue === null ? null : (change(queue.entries) ?? (queue.pruned ? queue.entries : null));
    if (next !== null) {
      await writeEntries(secureStore, next);
    }
  });
  lastChanges.set(
    secureStore,
    changed.catch(() => undefined),
  );
  return changed;
}

export async function addPendingSignOut(secureStore: SessionKeyStore, marker: string): Promise<void> {
  await changeQueue(secureStore, (entries) =>
    entries.some((entry) => entry.marker === marker) ? null : [...entries, { marker, queuedAt: currentMs() }],
  );
}

export async function dropPendingSignOut(secureStore: SessionKeyStore, marker: string): Promise<void> {
  await changeQueue(secureStore, (entries) =>
    entries.some((entry) => entry.marker === marker) ? entries.filter((entry) => entry.marker !== marker) : null,
  );
}
