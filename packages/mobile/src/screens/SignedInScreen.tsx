import { type ComponentRef, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Share, StyleSheet, Text, View } from "react-native";
import type { AccountDeletionResult, AccountExportResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { colours, spacing, textStyles, typeScale } from "../theme/tokens";
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

const styles = StyleSheet.create({
  // 16 margin + the layout's 16 gap = 32 above the section.
  accountSection: { marginTop: spacing.medium, gap: spacing.medium },
  sectionLabel: { ...typeScale.label, color: colours.textSecondary },
});

function moveScreenReaderFocus(target: ComponentRef<typeof Text> | ComponentRef<typeof View> | null): void {
  if (target) {
    AccessibilityInfo.sendAccessibilityEvent(target, "focus");
  }
}

/** Placeholder home until the real one lands, plus the account actions (HEN-65): export my data and delete account. */
export function SignedInScreen({ onSignOut, onExportData, onDeleteAccount, onAccountDeleted }: SignedInScreenProps) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [runningTask, setRunningTask] = useState<AccountTask | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // A ref, not state: two taps in the same tick both run before a re-render, and only the first may send a request.
  const inFlight = useRef(false);
  const confirmHeading = useRef<ComponentRef<typeof Text>>(null);
  const deleteEntry = useRef<ComponentRef<typeof View>>(null);
  const returnFocusToDeleteEntry = useRef(false);

  // The confirm acts as a dialog: focus moves into it when it opens, and back to Delete account when it is cancelled.
  useEffect(() => {
    if (isConfirmingDelete) {
      moveScreenReaderFocus(confirmHeading.current);
    } else if (returnFocusToDeleteEntry.current) {
      returnFocusToDeleteEntry.current = false;
      moveScreenReaderFocus(deleteEntry.current);
    }
  }, [isConfirmingDelete]);

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
  const exportButtonProps = {
    disabled: isBusy && runningTask !== "export",
    loading: runningTask === "export",
    loadingTitle: "Preparing export…",
    onPress: () => void exportData(),
  };

  if (isConfirmingDelete) {
    return (
      <AuthScreenLayout>
        <Text accessibilityRole="header" style={textStyles.display}>
          You are signed in
        </Text>
        <View style={authStyles.heading}>
          <Text ref={confirmHeading} accessibilityRole="header" style={textStyles.title}>
            Delete your account?
          </Text>
          <Text style={textStyles.body}>This permanently deletes your account, handle and sign-in data now. It can&apos;t be undone.</Text>
        </View>
        <View style={authStyles.actions}>
          <AuthButton
            {...exportButtonProps}
            title="Export my data first"
            variant="tertiary"
            accessibilityHint="Opens the share sheet with a copy of your account data. Nothing is deleted."
          />
          <StatusText message={exportError} style={authStyles.fieldError} />
          <StatusText message={deleteError} style={authStyles.fieldError} />
          <AuthButton
            title="Delete my account"
            variant="danger"
            disabled={runningTask === "export"}
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
              setExportError(null);
              returnFocusToDeleteEntry.current = true;
              setIsConfirmingDelete(false);
            }}
          />
        </View>
      </AuthScreenLayout>
    );
  }

  return (
    <AuthScreenLayout>
      <Text accessibilityRole="header" style={textStyles.display}>
        You are signed in
      </Text>
      <AuthButton title="Sign out" variant="secondary" disabled={isBusy} onPress={onSignOut} />
      <View style={styles.accountSection}>
        <Text accessibilityRole="header" style={styles.sectionLabel}>
          Account
        </Text>
        <AuthButton
          {...exportButtonProps}
          title="Export my data"
          variant="secondary"
          accessibilityHint="Opens the share sheet with a copy of your account data."
        />
        <StatusText message={exportError} style={authStyles.fieldError} />
        <AuthButton
          ref={deleteEntry}
          title="Delete account"
          variant="dangerText"
          disabled={isBusy}
          accessibilityHint="Asks you to confirm before anything is deleted."
          onPress={() => {
            setExportError(null);
            setIsConfirmingDelete(true);
          }}
        />
      </View>
    </AuthScreenLayout>
  );
}
