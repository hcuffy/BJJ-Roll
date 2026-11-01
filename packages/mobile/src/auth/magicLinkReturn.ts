import { MAGIC_LINK_REASON_PARAM, magicLinkReasons } from "@bjj-roll/shared";
import { AGE_GATE_REFUSAL_MESSAGE } from "./ageConfirmation";
import { DEEP_LINK_SCHEME, type MobileAuthClient } from "./authClient";
import { exchangeForPendingSignIn } from "./pendingSignIn";
import type { SessionKeyStore } from "./pendingSignOuts";
import { attestationRequired, failure, postAuth, SOCIAL_SIGN_IN_CALLBACK_PATH, type ActionResult } from "./signInActions";

interface LinkProof {
  readonly verifier: string;
  readonly signal?: AbortSignal;
}

type MagicLink =
  { readonly kind: "ignored" } | { readonly kind: "refused"; readonly result: ActionResult } | { readonly kind: "code"; readonly code: string };

const ignored: ActionResult = { ok: false, reason: "ignored", message: null };

function readMagicLink(url: string): MagicLink {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: "ignored" };
  }
  if (parsed.protocol !== `${DEEP_LINK_SCHEME}:` || parsed.host !== "auth" || parsed.pathname === SOCIAL_SIGN_IN_CALLBACK_PATH) {
    return { kind: "ignored" };
  }
  const reason = parsed.searchParams.get(MAGIC_LINK_REASON_PARAM);
  if (reason === magicLinkReasons.ageRefused) {
    return { kind: "refused", result: { ok: false, reason: "ageRequired", message: AGE_GATE_REFUSAL_MESSAGE } };
  }
  if (reason === magicLinkReasons.attestationRefused) {
    return { kind: "refused", result: attestationRequired };
  }
  if (reason === magicLinkReasons.linkInvalid) {
    return { kind: "refused", result: failure("invalidLink") };
  }
  if (reason !== null || parsed.searchParams.has("error")) {
    return { kind: "refused", result: failure("unknown") };
  }
  const code = parsed.searchParams.get("code");
  return code ? { kind: "code", code } : { kind: "ignored" };
}

async function exchangeCode(client: MobileAuthClient, code: string, { verifier, signal }: LinkProof): Promise<ActionResult> {
  return await postAuth(client, { path: "/magic-link/exchange", body: { code, verifier }, clientErrorReason: "invalidLink", signal });
}

export async function completeMagicLink(client: MobileAuthClient, url: string, proof: LinkProof): Promise<ActionResult> {
  const link = readMagicLink(url);
  if (link.kind === "code") {
    return await exchangeCode(client, link.code, proof);
  }
  return link.kind === "refused" ? link.result : ignored;
}

interface MagicLinkOpened {
  readonly url: string;
  readonly signal: AbortSignal;
  readonly signedOut: AbortSignal;
}

interface LinkSignIns {
  running: number;
  succeeded: boolean;
}

const linkSignInsBySignOut = new WeakMap<AbortSignal, LinkSignIns>();

function linkSignInsUntil(signedOut: AbortSignal): LinkSignIns {
  const existing = linkSignInsBySignOut.get(signedOut);
  if (existing) {
    return existing;
  }
  const created: LinkSignIns = { running: 0, succeeded: false };
  linkSignInsBySignOut.set(signedOut, created);
  return created;
}

async function exchangePendingCode(
  client: MobileAuthClient,
  secureStore: SessionKeyStore,
  { code, link }: { readonly code: string; readonly link: MagicLinkOpened },
) {
  const stop = new AbortController();
  for (const reason of [link.signal, link.signedOut]) {
    reason.addEventListener("abort", () => stop.abort());
  }
  let started = false;
  const result = await exchangeForPendingSignIn(client, secureStore, (verifier) => {
    started = true;
    return exchangeCode(client, code, { verifier, signal: stop.signal });
  });
  return started ? result : failure("linkNotStartedHere");
}

export async function exchangeMagicLink(client: MobileAuthClient, secureStore: SessionKeyStore, link: MagicLinkOpened): Promise<ActionResult> {
  const opened = readMagicLink(link.url);
  const signIns = linkSignInsUntil(link.signedOut);
  if (opened.kind !== "code") {
    return opened.kind === "refused" && signIns.running === 0 && !signIns.succeeded ? opened.result : ignored;
  }
  signIns.running += 1;
  try {
    const result = await exchangePendingCode(client, secureStore, { code: opened.code, link });
    signIns.succeeded ||= result.ok && !link.signedOut.aborted;
    return link.signedOut.aborted ? ignored : result;
  } catch (error) {
    if (link.signedOut.aborted) {
      return ignored;
    }
    throw error;
  } finally {
    signIns.running -= 1;
  }
}
