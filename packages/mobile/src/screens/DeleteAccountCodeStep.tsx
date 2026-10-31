import { type ComponentRef, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Text, View } from "react-native";
import type { AccountCodeResult, AccountDeletionResult } from "../auth/accountActions";
import { textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { AuthScreenLayout } from "./AuthScreenLayout";
import { type AccountFailureView, accountFailureView } from "./accountFailureView";
import { ServerUnreachableNote } from "./ServerUnreachableNote";
import { StatusText } from "./StatusText";
import { TextField } from "./TextField";
import { authStyles } from "./authStyles";

const CODE_LENGTH = 6;

export interface DeleteAccountCodeStepProps {
  readonly onRequestDeleteCode: () => Promise<AccountCodeResult>;
  readonly onDeleteAccount: (code: string) => Promise<AccountDeletionResult>;
  readonly onAccountDeleted: () => void;
  readonly onCancel: () => void;
}

type Task = "delete" | "resend";

export function DeleteAccountCodeStep({ onRequestDeleteCode, onDeleteAccount, onAccountDeleted, onCancel }: DeleteAccountCodeStepProps) {
  const [code, setCode] = useState("");
  const [runningTask, setRunningTask] = useState<Task | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef(false);
  const heading = useRef<ComponentRef<typeof Text>>(null);

  useEffect(() => {
    if (heading.current) {
      AccessibilityInfo.sendAccessibilityEvent(heading.current, "focus");
    }
  }, []);

  const runOnce = async (task: Task, work: () => Promise<void>) => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setRunningTask(task);
    setCodeError(null);
    setFormError(null);
    setOffline(false);
    setNotice(null);
    try {
      await work();
    } finally {
      inFlight.current = false;
      setRunningTask(null);
    }
  };

  const showFailure = (view: AccountFailureView) => {
    setOffline(view.offline);
    setFormError(view.error);
  };

  const deleteAccount = () =>
    runOnce("delete", async () => {
      const result = await onDeleteAccount(code);
      if (result.ok) {
        onAccountDeleted();
      } else if (result.reason === "invalidCode") {
        setCodeError(result.message);
      } else {
        showFailure(accountFailureView(result, "Your account was not deleted."));
      }
    });

  const resend = () =>
    runOnce("resend", async () => {
      const result = await onRequestDeleteCode();
      if (result.ok) {
        setNotice("We sent a new code to your email.");
      } else {
        showFailure(accountFailureView(result, "We could not send the code."));
      }
    });

  const isBusy = runningTask !== null;

  return (
    <AuthScreenLayout>
      <Text accessibilityRole="header" style={textStyles.display}>
        You are signed in
      </Text>
      <View style={authStyles.heading}>
        <Text ref={heading} accessibilityRole="header" style={textStyles.title}>
          Enter the code we emailed you
        </Text>
        <Text style={textStyles.body}>We sent a 6-digit code to your email. It deletes your account at once, with no undo.</Text>
        <StatusText message={notice} style={textStyles.bodyMuted} />
      </View>
      <TextField
        label="6-digit code"
        error={codeError}
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        inputMode="numeric"
        keyboardType="number-pad"
        maxLength={CODE_LENGTH}
        value={code}
        onChangeText={(text) => {
          setCode(text);
          setCodeError(null);
        }}
      />
      <StatusText message={formError} style={authStyles.fieldError} />
      <ServerUnreachableNote visible={offline} />
      <View style={authStyles.actions}>
        <AuthButton
          title="Delete my account"
          variant="danger"
          disabled={code.trim().length !== CODE_LENGTH || runningTask === "resend"}
          loading={runningTask === "delete"}
          loadingTitle="Deleting account…"
          accessibilityHint="Deletes your account now and signs you out."
          onPress={() => void deleteAccount()}
        />
        <AuthButton
          title="Send a new code"
          variant="tertiary"
          disabled={isBusy && runningTask !== "resend"}
          loading={runningTask === "resend"}
          loadingTitle="Sending code…"
          onPress={() => void resend()}
        />
        <AuthButton title="Cancel" variant="tertiary" disabled={isBusy} onPress={onCancel} />
      </View>
    </AuthScreenLayout>
  );
}
