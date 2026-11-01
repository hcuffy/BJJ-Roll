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

export async function completeMagicLink(client: MobileAuthClient, url: string, { verifier, signal }: LinkProof): Promise<ActionResult> {
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
  if (reason === magicLinkReasons.ageRefused) {
    return { ok: false, reason: "ageRequired", message: AGE_GATE_REFUSAL_MESSAGE };
  }
  if (reason === magicLinkReasons.attestationRefused) {
    return attestationRequired;
  }
  if (reason === magicLinkReasons.linkInvalid) {
    return failure("invalidLink");
  }
  if (reason !== null || parsed.searchParams.has("error")) {
    return failure("unknown");
  }
  const code = parsed.searchParams.get("code");
  if (!code) {
    return { ok: false, reason: "ignored", message: null };
  }
  return await postAuth(client, { path: "/magic-link/exchange", body: { code, verifier }, clientErrorReason: "invalidLink", signal });
}

interface MagicLinkOpened {
  readonly url: string;
  readonly signal: AbortSignal;
  readonly signedOut: AbortSignal;
}

export async function exchangeMagicLink(client: MobileAuthClient, secureStore: SessionKeyStore, link: MagicLinkOpened): Promise<ActionResult> {
  const stop = new AbortController();
  for (const reason of [link.signal, link.signedOut]) {
    reason.addEventListener("abort", () => stop.abort());
  }
  const ignored: ActionResult = { ok: false, reason: "ignored", message: null };
  try {
    const result = await exchangeForPendingSignIn(client, secureStore, (verifier) =>
      completeMagicLink(client, link.url, { verifier, signal: stop.signal }),
    );
    return link.signedOut.aborted ? ignored : result;
  } catch (error) {
    if (link.signedOut.aborted) {
      return ignored;
    }
    throw error;
  }
}
