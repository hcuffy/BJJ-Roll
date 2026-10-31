import { type ComponentRef, useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, BackHandler, StyleSheet, Text, View } from "react-native";
import type { AccountCodeResult, AccountDeletionResult, AccountExportResult, SignUpAttestationResult } from "../auth/accountActions";
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
import { useExportDataFirst } from "./ExportDataFirstAction";
import { LoadingScreen } from "./LoadingScreen";
import { ServerUnreachableNote } from "./ServerUnreachableNote";
import { SignUpAttestationFields } from "./SignUpAttestationFields";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";
import { whileFlagged } from "./whileFlagged";

export interface SignUpAttestationGateProps {
  readonly onReadStatus: () => Promise<SignUpAttestationResult>;
  readonly onAccept: () => Promise<SignUpAttestationResult>;
  readonly onSignOut: () => void;
  readonly onRequestDeleteCode: () => Promise<AccountCodeResult>;
  readonly onDeleteAccount: (code: string) => Promise<AccountDeletionResult>;
  readonly onAccountDeleted: () => void;
  readonly onExportData?: () => Promise<AccountExportResult>;
  readonly children?: ReactNode;
}

export const GATE_READ_ERROR = "Couldn't check your account. Try again.";
export const TRY_AGAIN = "Try again";

type GateState = "checking" | "readFailed" | "prompt" | "accepted";
type DeleteStep = "none" | "confirm" | "code";

const styles = StyleSheet.create({ deleteEntry: { marginTop: spacing.small } });

function moveScreenReaderFocus(target: ComponentRef<typeof Text> | ComponentRef<typeof View> | null): void {
  if (target) {
    AccessibilityInfo.sendAccessibilityEvent(target, "focus");
  }
}

const unknownFailure = (): SignUpAttestationResult => ({ ok: false, reason: "unknown", message: FAILURE_MESSAGES.unknown });

function isAccepted(result: SignUpAttestationResult): boolean {
  return result.ok && !result.status.required;
}

export function SignUpAttestationGate(props: SignUpAttestationGateProps) {
  const { onReadStatus, onAccept, onSignOut, onRequestDeleteCode, onDeleteAccount, onAccountDeleted, onExportData, children } = props;
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
  const codeInFlight = useRef(false);
  const exportFirst = useExportDataFirst(codeInFlight, onExportData, { onStart: () => clearConfirmMessages(), setOffline: setDeleteOffline });
  const confirmHeading = useRef<ComponentRef<typeof Text>>(null);
  const deleteEntryButton = useRef<ComponentRef<typeof View>>(null);
  const returnFocusToDeleteEntry = useRef(false);
  const [attempt, setAttempt] = useState(0);
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

  useEffect(() => {
    if (deleteStep === "confirm") {
      moveScreenReaderFocus(confirmHeading.current);
    } else if (deleteStep === "none" && returnFocusToDeleteEntry.current) {
      returnFocusToDeleteEntry.current = false;
      moveScreenReaderFocus(deleteEntryButton.current);
    }
  }, [deleteStep]);

  const clearConfirmMessages = () => {
    setDeleteCodeError(null);
    setDeleteOffline(false);
    exportFirst.clearError();
  };

  const cancelDelete = () => {
    clearConfirmMessages();
    returnFocusToDeleteEntry.current = true;
    setDeleteStep("none");
  };

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
    clearConfirmMessages();
    setSendingCode(true);
    const result = await whileFlagged(codeInFlight, onRequestDeleteCode)().catch(unknownFailure);
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
        exportAction={exportFirst.renderAction(sendingCode)}
        codeRequestError={deleteCodeError}
        offline={deleteOffline}
        sendingCode={sendingCode}
        emailCodeDisabled={exportFirst.exporting}
        cancelDisabled={sendingCode || exportFirst.exporting}
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
