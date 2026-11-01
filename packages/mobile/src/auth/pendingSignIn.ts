import * as Crypto from "expo-crypto";
import { SESSION_STORAGE_PREFIX, type MobileAuthClient } from "./authClient";
import { addPendingSignOut, readSessionCookie, type SessionKeyStore } from "./pendingSignOuts";
import type { ActionResult } from "./signInActions";
import { currentMs } from "../dates";

export const MAGIC_LINK_EXPIRY_MINUTES = 15;
const PENDING_SIGN_IN_KEY = `${SESSION_STORAGE_PREFIX}_pending_sign_in`;
const PENDING_SIGN_IN_LIFETIME_MS = MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000;
const VERIFIER_BYTES = 32;
const verifierPattern = /^[\da-f]{64}$/u;

interface PendingSignIn {
  readonly verifier: string;
  readonly startedAt: number;
}

function parsePendingSignIn(value: string | null): PendingSignIn | null {
  try {
    const parsed: unknown = JSON.parse(value ?? "null");
    if (typeof parsed === "object" && parsed !== null && "verifier" in parsed && "startedAt" in parsed) {
      const { verifier, startedAt } = parsed;
      if (typeof verifier === "string" && verifierPattern.test(verifier) && typeof startedAt === "number" && Number.isFinite(startedAt)) {
        return { verifier, startedAt };
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function readPendingVerifier(secureStore: SessionKeyStore): Promise<string | null> {
  const pending = parsePendingSignIn(await secureStore.getItemAsync(PENDING_SIGN_IN_KEY).catch(() => null));
  const age = pending ? currentMs() - pending.startedAt : Number.POSITIVE_INFINITY;
  return pending && age >= 0 && age < PENDING_SIGN_IN_LIFETIME_MS ? pending.verifier : null;
}

export async function beginPendingSignIn(secureStore: SessionKeyStore): Promise<string> {
  const verifier =
    (await readPendingVerifier(secureStore)) ??
    Array.from(Crypto.getRandomBytes(VERIFIER_BYTES), (byte) => byte.toString(16).padStart(2, "0")).join("");
  await secureStore.setItemAsync(PENDING_SIGN_IN_KEY, JSON.stringify({ verifier, startedAt: currentMs() }));
  return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier);
}

export async function exchangeForPendingSignIn(
  client: MobileAuthClient,
  secureStore: SessionKeyStore,
  exchange: (verifier: string) => Promise<ActionResult>,
): Promise<ActionResult> {
  const verifier = await readPendingVerifier(secureStore);
  if (verifier === null) {
    return { ok: false, reason: "ignored", message: null };
  }
  const replacedSessionCookie = await readSessionCookie(client);
  const result = await exchange(verifier);
  if (result.ok) {
    await secureStore.deleteItemAsync(PENDING_SIGN_IN_KEY).catch(() => undefined);
    if (replacedSessionCookie !== null && replacedSessionCookie !== (await readSessionCookie(client))) {
      await addPendingSignOut(secureStore, replacedSessionCookie).catch(() => undefined);
    }
  }
  return result;
}
