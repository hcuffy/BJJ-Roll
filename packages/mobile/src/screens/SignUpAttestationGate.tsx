import { type ComponentRef, useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, BackHandler, StyleSheet, Text, View } from "react-native";
import type { AccountCodeResult, AccountDeletionResult, SignUpAttestationResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import {
  ATTESTATION_NEEDED_HINT,
  ATTESTATION_PROMPT_ACCEPT,
  ATTESTATION_PROMPT_BODY,
  ATTESTATION_PROMPT_TITLE,
  ATTESTATION_SAVING,
  SIGN_UP_ATTESTATION_REFUSAL_MESSAGE,
} from "../auth/signUpAttestation";
import { spacing, textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { AuthScreenLayout } from "./AuthScreenLayout";
import { DeleteAccountCodeStep } from "./DeleteAccountCodeStep";
import { DeleteAccountConfirmStep } from "./DeleteAccountConfirmStep";
import { LoadingScreen } from "./LoadingScreen";
import { ServerUnreachableNote } from "./ServerUnreachableNote";
import { SignUpAttestationFields } from "./SignUpAttestationFields";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";

export interface SignUpAttestationGateProps {
  readonly onReadStatus: () => Promise<SignUpAttestationResult>;
  readonly onAccept: () => Promise<SignUpAttestationResult>;
  readonly onSignOut: () => void;
  /** Delete account stays reachable while gated (Apple 5.1.1(v), Play): the same confirm and code steps as the signed-in screen. */
  readonly onRequestDeleteCode: () => Promise<AccountCodeResult>;
  readonly onDeleteAccount: (code: string) => Promise<AccountDeletionResult>;
  readonly onAccountDeleted: () => void;
  /** The signed-in app, shown only once the account accepted the current text version. */
  readonly children?: ReactNode;
}

/** Shown when the status read fails for a reason other than the network (Vera #74 item 1). */
export const GATE_READ_ERROR = "Couldn't check your account. Try again.";
export const TRY_AGAIN = "Try again";

/** "readFailed": the status is unknown, so neither the app nor the duties are shown; only a retry or sign-out. */
type GateState = "checking" | "readFailed" | "prompt" | "accepted";
type DeleteStep = "none" | "confirm" | "code";

// The actions' 16 gap + 8 = 24 between Sign out and the destructive Delete account (Vera #74 round 4).
const styles = StyleSheet.create({ deleteEntry: { marginTop: spacing.small } });

function moveScreenReaderFocus(target: ComponentRef<typeof Text> | ComponentRef<typeof View> | null): void {
  if (target) {
    AccessibilityInfo.sendAccessibilityEvent(target, "focus");
  }
}

/** Sets `flag` while the request runs, so Android back is ignored like the code step's disabled Cancel (Vera #74 round 5). */
function whileFlagged<Inputs extends unknown[], Result>(flag: { current: boolean }, request: (...inputs: Inputs) => Promise<Result>) {
  return (...inputs: Inputs): Promise<Result> => {
    flag.current = true;
    return request(...inputs).finally(() => (flag.current = false));
  };
}

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
export function SignUpAttestationGate(props: SignUpAttestationGateProps) {
  const { onReadStatus, onAccept, onSignOut, onRequestDeleteCode, onDeleteAccount, onAccountDeleted, children } = props;
  const [state, setState] = useState<GateState>("checking");
  const [readOffline, setReadOffline] = useState(false);
  const [ticked, setTicked] = useState(false);
  const [tickError, setTickError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [acceptOffline, setAcceptOffline] = useState(false);
  const [sending, setSending] = useState(false);
  const [deleteStep, setDeleteStep] = useState<DeleteStep>("none");
  const [sendingCode, setSendingCode] = useState(false);
  const [deleteCodeError, setDeleteCodeError] = useState<string | null>(null);
  const [deleteOffline, setDeleteOffline] = useState(false);
  // A ref, not state: two taps in the same tick both run before a re-render, and only the first may send a code.
  // The code step's DELETE and "Send a new code" set it too, so Android back is ignored while they run.
  const codeInFlight = useRef(false);
  const confirmHeading = useRef<ComponentRef<typeof Text>>(null);
  const deleteEntryButton = useRef<ComponentRef<typeof View>>(null);
  const returnFocusToDeleteEntry = useRef(false);
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

  // Like the signed-in screen: focus moves into the confirm, and back to Delete account when the delete is cancelled.
  useEffect(() => {
    if (deleteStep === "confirm") {
      moveScreenReaderFocus(confirmHeading.current);
    } else if (deleteStep === "none" && returnFocusToDeleteEntry.current) {
      returnFocusToDeleteEntry.current = false;
      moveScreenReaderFocus(deleteEntryButton.current);
    }
  }, [deleteStep]);

  const cancelDelete = () => {
    setDeleteCodeError(null);
    setDeleteOffline(false);
    returnFocusToDeleteEntry.current = true;
    setDeleteStep("none");
  };

  // Android back on a delete step acts like its Cancel (Vera #74 round 4 item 4); ignored while a request is in flight.
  useEffect(() => {
    if (deleteStep === "none") {
      return undefined;
    }
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!codeInFlight.current) {
        cancelDelete();
      }
      return true;
    });
    return () => subscription.remove();
  }, [deleteStep]);

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

  const requestDeleteCode = async () => {
    if (codeInFlight.current) {
      return;
    }
    codeInFlight.current = true;
    setDeleteCodeError(null);
    setDeleteOffline(false);
    setSendingCode(true);
    const result = await onRequestDeleteCode().catch(unknownFailure);
    codeInFlight.current = false;
    setSendingCode(false);
    if (result.ok) {
      setDeleteStep("code");
    } else if (result.reason === "network") {
      setDeleteOffline(true);
    } else {
      setDeleteCodeError(`We could not send the code. ${result.message}`);
    }
  };

  const deleteEntry = (
    <View style={styles.deleteEntry}>
      <AuthButton
        ref={deleteEntryButton}
        title="Delete account"
        variant="dangerText"
        disabled={sending}
        accessibilityHint="Asks you to confirm before anything is deleted."
        onPress={() => setDeleteStep("confirm")}
      />
    </View>
  );

  if (deleteStep === "confirm") {
    return (
      <DeleteAccountConfirmStep
        headingRef={confirmHeading}
        codeRequestError={deleteCodeError}
        offline={deleteOffline}
        sendingCode={sendingCode}
        cancelDisabled={sendingCode}
        onEmailCode={() => void requestDeleteCode()}
        onCancel={cancelDelete}
      />
    );
  }
  if (deleteStep === "code") {
    return (
      <DeleteAccountCodeStep
        onRequestDeleteCode={whileFlagged(codeInFlight, onRequestDeleteCode)}
        onDeleteAccount={whileFlagged(codeInFlight, onDeleteAccount)}
        onAccountDeleted={onAccountDeleted}
        onCancel={cancelDelete}
      />
    );
  }
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
          {deleteEntry}
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
        {deleteEntry}
      </View>
    </AuthScreenLayout>
  );
}
