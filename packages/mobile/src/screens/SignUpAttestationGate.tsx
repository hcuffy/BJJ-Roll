import { useEffect, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import type { SignUpAttestationResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import {
  ATTESTATION_PROMPT_ACCEPT,
  ATTESTATION_PROMPT_BODY,
  ATTESTATION_PROMPT_TITLE,
  SIGN_UP_ATTESTATION_REFUSAL_MESSAGE,
} from "../auth/signUpAttestation";
import { textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { AuthScreenLayout } from "./AuthScreenLayout";
import { LoadingScreen } from "./LoadingScreen";
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

type GateState = "checking" | "prompt" | "accepted";

/** True only for a status the server confirmed: anything else keeps the prompt (fail closed). */
function isAccepted(result: SignUpAttestationResult): boolean {
  return result.ok && !result.status.required;
}

/**
 * HEN-183: after sign-in, an account with no attestation record or an older text version must accept the current
 * duties before it reaches the app. A failed read or accept keeps the prompt; the only way out is accepting or signing out.
 */
export function SignUpAttestationGate({ onReadStatus, onAccept, onSignOut, children }: SignUpAttestationGateProps) {
  const [state, setState] = useState<GateState>("checking");
  const [ticked, setTicked] = useState(false);
  const [tickError, setTickError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Read once per sign-in: the parent passes a fresh function on every render.
  const readStatus = useRef(onReadStatus);

  useEffect(() => {
    let active = true;
    void readStatus
      .current()
      .catch((): SignUpAttestationResult => ({ ok: false, reason: "unknown", message: FAILURE_MESSAGES.unknown }))
      .then((result) => {
        if (active) {
          setState(isAccepted(result) ? "accepted" : "prompt");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const accept = async () => {
    setFormError(null);
    if (sending) {
      return;
    }
    if (!ticked) {
      setTickError(SIGN_UP_ATTESTATION_REFUSAL_MESSAGE);
      return;
    }
    setSending(true);
    const result = await onAccept().catch((): SignUpAttestationResult => ({ ok: false, reason: "unknown", message: FAILURE_MESSAGES.unknown }));
    setSending(false);
    if (isAccepted(result)) {
      setState("accepted");
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
        }}
      />
      <StatusText message={formError} style={authStyles.fieldError} />
      <View style={authStyles.actions}>
        <AuthButton title={ATTESTATION_PROMPT_ACCEPT} looksDisabled={!ticked} loading={sending} onPress={() => void accept()} />
        <AuthButton title="Sign out" variant="tertiary" disabled={sending} onPress={onSignOut} />
      </View>
    </AuthScreenLayout>
  );
}
