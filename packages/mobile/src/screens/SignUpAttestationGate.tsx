import { useEffect, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import type { SignUpAttestationResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import {
  ATTESTATION_NEEDED_HINT,
  ATTESTATION_PROMPT_ACCEPT,
  ATTESTATION_PROMPT_BODY,
  ATTESTATION_PROMPT_TITLE,
  ATTESTATION_SAVING,
  SIGN_UP_ATTESTATION_REFUSAL_MESSAGE,
} from "../auth/signUpAttestation";
import { textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { AuthScreenLayout } from "./AuthScreenLayout";
import { LoadingScreen } from "./LoadingScreen";
import { ServerUnreachableNote } from "./ServerUnreachableNote";
import { SignUpAttestationFields } from "./SignUpAttestationFields";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";

export interface SignUpAttestationGateProps {
  readonly onReadStatus: () => Promise<SignUpAttestationResult>;
  readonly onAccept: () => Promise<SignUpAttestationResult>;
  readonly onSignOut: () => void;
  /** The signed-in app, shown only once the account accepted the current text version. */
  readonly children?: ReactNode;
}

/** Shown when the status read fails for a reason other than the network (Vera #74 item 1). */
export const GATE_READ_ERROR = "Couldn't check your account. Try again.";
export const TRY_AGAIN = "Try again";

/** "readFailed": the status is unknown, so neither the app nor the duties are shown; only a retry or sign-out. */
type GateState = "checking" | "readFailed" | "prompt" | "accepted";

const unknownFailure = (): SignUpAttestationResult => ({ ok: false, reason: "unknown", message: FAILURE_MESSAGES.unknown });

/** True only for a status the server confirmed: anything else keeps the gate closed. */
function isAccepted(result: SignUpAttestationResult): boolean {
  return result.ok && !result.status.required;
}

/**
 * HEN-183: after sign-in, an account with no attestation record or an older text version must accept the current
 * duties before it reaches the app. The duties show only when the server says acceptance is needed; a failed read is an
 * error state with a retry. The only ways past are the server's "not required", accepting, or signing out.
 */
export function SignUpAttestationGate({ onReadStatus, onAccept, onSignOut, children }: SignUpAttestationGateProps) {
  const [state, setState] = useState<GateState>("checking");
  const [readOffline, setReadOffline] = useState(false);
  const [ticked, setTicked] = useState(false);
  const [tickError, setTickError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [acceptOffline, setAcceptOffline] = useState(false);
  const [sending, setSending] = useState(false);
  // Each "Try again" bumps this to read again.
  const [attempt, setAttempt] = useState(0);
  // Read once per sign-in (plus explicit retries): the parent passes a fresh function on every render.
  const readStatus = useRef(onReadStatus);

  useEffect(() => {
    let active = true;
    void readStatus
      .current()
      .catch(unknownFailure)
      .then((result) => {
        if (!active) {
          return;
        }
        if (result.ok) {
          setState(result.status.required ? "prompt" : "accepted");
        } else {
          setReadOffline(result.reason === "network");
          setState("readFailed");
        }
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const retryRead = () => {
    setState("checking");
    setAttempt((previous) => previous + 1);
  };

  const accept = async () => {
    setFormError(null);
    setAcceptOffline(false);
    if (sending) {
      return;
    }
    if (!ticked) {
      setTickError(SIGN_UP_ATTESTATION_REFUSAL_MESSAGE);
      return;
    }
    setSending(true);
    const result = await onAccept().catch(unknownFailure);
    setSending(false);
    if (isAccepted(result)) {
      setState("accepted");
    } else if (!result.ok && result.reason === "network") {
      setAcceptOffline(true);
    } else {
      setFormError(result.ok ? FAILURE_MESSAGES.unknown : result.message);
    }
  };

  if (state === "checking") {
    return <LoadingScreen />;
  }
  if (state === "accepted") {
    return children;
  }
  if (state === "readFailed") {
    return (
      <AuthScreenLayout>
        <ServerUnreachableNote visible={readOffline} />
        <StatusText message={readOffline ? null : GATE_READ_ERROR} style={authStyles.fieldError} />
        <View style={authStyles.actions}>
          <AuthButton title={TRY_AGAIN} onPress={retryRead} />
          <AuthButton title="Sign out" variant="tertiary" onPress={onSignOut} />
        </View>
      </AuthScreenLayout>
    );
  }
  return (
    <AuthScreenLayout>
      <View style={authStyles.heading}>
        <Text accessibilityRole="header" style={textStyles.display}>
          {ATTESTATION_PROMPT_TITLE}
        </Text>
        <Text style={textStyles.bodyMuted}>{ATTESTATION_PROMPT_BODY}</Text>
      </View>
      <SignUpAttestationFields
        accepted={ticked}
        error={tickError}
        onPress={() => {
          setTicked(!ticked);
          setTickError(null);
          setFormError(null);
          setAcceptOffline(false);
        }}
      />
      <StatusText message={formError} style={authStyles.fieldError} />
      <ServerUnreachableNote visible={acceptOffline} />
      <View style={authStyles.actions}>
        <AuthButton
          title={ATTESTATION_PROMPT_ACCEPT}
          looksDisabled={!ticked}
          accessibilityHint={ticked ? undefined : ATTESTATION_NEEDED_HINT}
          loading={sending}
          loadingTitle={ATTESTATION_SAVING}
          onPress={() => void accept()}
        />
        <AuthButton title="Sign out" variant="tertiary" disabled={sending} onPress={onSignOut} />
      </View>
    </AuthScreenLayout>
  );
}
