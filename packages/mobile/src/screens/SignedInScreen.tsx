import { useRef, useState } from "react";
import { Share, Text, View } from "react-native";
import type { AccountDeletionResult, AccountExportResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { AuthScreenLayout } from "./AuthScreenLayout";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";

export interface SignedInScreenProps {
  readonly onSignOut: () => void;
  readonly onExportData: () => Promise<AccountExportResult>;
  readonly onDeleteAccount: () => Promise<AccountDeletionResult>;
  /** Called once the backend confirmed the deletion and the local session is gone. */
  readonly onAccountDeleted: () => void;
}

type AccountTask = "export" | "delete";

/** Placeholder home until the real one lands, plus the account actions (HEN-65): export my data and delete account. */
export function SignedInScreen({ onSignOut, onExportData, onDeleteAccount, onAccountDeleted }: SignedInScreenProps) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [runningTask, setRunningTask] = useState<AccountTask | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // A ref, not state: two taps in the same tick both run before a re-render, and only the first may send a request.
  const inFlight = useRef(false);

  const runOnce = async (task: AccountTask, work: () => Promise<void>) => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setRunningTask(task);
    try {
      await work();
    } finally {
      inFlight.current = false;
      setRunningTask(null);
    }
  };

  const exportData = () =>
    runOnce("export", async () => {
      setExportError(null);
      const result = await onExportData();
      if (!result.ok) {
        setExportError(`Export failed. ${result.message}`);
        return;
      }
      try {
        await Share.share({ title: "BJJ Roll data export", message: result.json });
      } catch {
        setExportError(`Export failed. ${FAILURE_MESSAGES.unknown}`);
      }
    });

  const deleteAccount = () =>
    runOnce("delete", async () => {
      setDeleteError(null);
      const result = await onDeleteAccount();
      if (result.ok) {
        onAccountDeleted();
      } else {
        setDeleteError(`Your account was not deleted. ${result.message}`);
      }
    });

  const isBusy = runningTask !== null;

  return (
    <AuthScreenLayout>
      <Text accessibilityRole="header" style={textStyles.display}>
        You are signed in
      </Text>
      {isConfirmingDelete ? (
        <View style={authStyles.heading}>
          <Text accessibilityRole="header" style={textStyles.title}>
            Delete your account?
          </Text>
          <Text style={textStyles.body}>This permanently deletes your account, handle and sign-in data now. It can&apos;t be undone.</Text>
          <Text style={textStyles.bodyMuted}>Export your data first if you want a copy.</Text>
          <StatusText message={deleteError} style={authStyles.fieldError} />
          <View style={authStyles.actions}>
            <AuthButton
              title="Delete my account"
              variant="danger"
              loading={runningTask === "delete"}
              loadingTitle="Deleting account…"
              accessibilityHint="Deletes your account now and signs you out."
              onPress={() => void deleteAccount()}
            />
            <AuthButton
              title="Cancel"
              variant="tertiary"
              disabled={isBusy}
              onPress={() => {
                setDeleteError(null);
                setIsConfirmingDelete(false);
              }}
            />
          </View>
        </View>
      ) : (
        <View style={authStyles.actions}>
          <AuthButton
            title="Export my data"
            variant="secondary"
            disabled={isBusy && runningTask !== "export"}
            loading={runningTask === "export"}
            loadingTitle="Preparing export…"
            accessibilityHint="Opens the share sheet with a copy of your account data."
            onPress={() => void exportData()}
          />
          <StatusText message={exportError} style={authStyles.fieldError} />
          <AuthButton
            title="Delete account"
            variant="secondary"
            disabled={isBusy}
            accessibilityHint="Asks you to confirm before anything is deleted."
            onPress={() => {
              setExportError(null);
              setIsConfirmingDelete(true);
            }}
          />
        </View>
      )}
      <AuthButton title="Sign out" variant="secondary" disabled={isBusy} onPress={onSignOut} />
    </AuthScreenLayout>
  );
}
