import { type ComponentRef, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Share, StyleSheet, Text, View } from "react-native";
import type { AccountCodeResult, AccountDeletionResult, AccountExportResult, AgeConfirmationResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { colours, sizes, spacing, textStyles, typeScale } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { AuthScreenLayout } from "./AuthScreenLayout";
import { DeleteAccountCodeStep } from "./DeleteAccountCodeStep";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";

export interface SignedInScreenProps {
  readonly onSignOut: () => void;
  readonly onExportData: () => Promise<AccountExportResult>;
  /** Emails a fresh code; DELETE /account only succeeds with it (Henry's decision, HEN-65). */
  readonly onRequestDeleteCode: () => Promise<AccountCodeResult>;
  readonly onDeleteAccount: (code: string) => Promise<AccountDeletionResult>;
  /** Called once the backend confirmed the deletion and the local session is gone. */
  readonly onAccountDeleted: () => void;
  /** Reads whether the account confirmed 18+ (HEN-263). */
  readonly onReadAgeConfirmation: () => Promise<AgeConfirmationResult>;
  /** Records a new 18+ confirmation; only deleting the account undoes it. */
  readonly onConfirmAdult: () => Promise<AgeConfirmationResult>;
}

type AccountTask = "export" | "code" | "adult";
type DeleteStep = "none" | "confirm" | "code";

/** The 18+ answer: unknown while the read runs, "failed" when it could not be read (then the button shows anyway). */
type AdultStatus = "checking" | "failed" | boolean;

const styles = StyleSheet.create({
  // 16 margin + the layout's 16 gap = 32 above the section; 8 from the label to its items, 16 between items.
  accountSection: { marginTop: spacing.medium, gap: spacing.small },
  accountItems: { gap: spacing.medium },
  sectionLabel: { ...typeScale.label, color: colours.textSecondary },
  // Lines up with the pills: same 48 height and 24 side padding, so the slot does not jump when the read returns.
  statusRow: { minHeight: sizes.minTapTarget, paddingHorizontal: spacing.large, flexDirection: "row", alignItems: "center", gap: spacing.small },
  adultItem: { gap: spacing.small },
});

function moveScreenReaderFocus(target: ComponentRef<typeof Text> | ComponentRef<typeof View> | null): void {
  if (target) {
    AccessibilityInfo.sendAccessibilityEvent(target, "focus");
  }
}

/** Placeholder home until the real one lands, plus the account actions (HEN-65): export my data and delete account. */
export function SignedInScreen({
  onSignOut,
  onExportData,
  onRequestDeleteCode,
  onDeleteAccount,
  onAccountDeleted,
  onReadAgeConfirmation,
  onConfirmAdult,
}: SignedInScreenProps) {
  const [deleteStep, setDeleteStep] = useState<DeleteStep>("none");
  const [runningTask, setRunningTask] = useState<AccountTask | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [codeRequestError, setCodeRequestError] = useState<string | null>(null);
  const [age18Confirmed, setAge18Confirmed] = useState<AdultStatus>("checking");
  const [adultError, setAdultError] = useState<string | null>(null);
  // A ref, not state: two taps in the same tick both run before a re-render, and only the first may send a request.
  const inFlight = useRef(false);
  const confirmHeading = useRef<ComponentRef<typeof Text>>(null);
  const deleteEntry = useRef<ComponentRef<typeof View>>(null);
  const returnFocusToDeleteEntry = useRef(false);

  // The confirm acts as a dialog: focus moves into it when it opens, and back to Delete account when it is cancelled.
  // The code step moves focus to its own heading.
  useEffect(() => {
    if (deleteStep === "confirm") {
      moveScreenReaderFocus(confirmHeading.current);
    } else if (deleteStep === "none" && returnFocusToDeleteEntry.current) {
      returnFocusToDeleteEntry.current = false;
      moveScreenReaderFocus(deleteEntry.current);
    }
  }, [deleteStep]);

  // Read once per visit to this screen; the parent passes a fresh callback on every render.
  const readAgeConfirmation = useRef(onReadAgeConfirmation);
  useEffect(() => {
    let active = true;
    void readAgeConfirmation.current().then((result) => {
      if (active) {
        // A failed read still offers the button: each confirm adds a new record, so confirming twice is harmless.
        setAge18Confirmed(result.ok ? result.status.age18Confirmed : "failed");
      }
    });
    return () => {
      active = false;
    };
  }, []);

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

  const confirmAdultAge = () =>
    runOnce("adult", async () => {
      setAdultError(null);
      const result = await onConfirmAdult();
      if (result.ok) {
        setAge18Confirmed(result.status.age18Confirmed);
      } else {
        setAdultError(`We could not save that. ${result.message}`);
      }
    });

  const requestCode = () =>
    runOnce("code", async () => {
      setCodeRequestError(null);
      const result = await onRequestDeleteCode();
      if (result.ok) {
        setExportError(null);
        setDeleteStep("code");
      } else {
        setCodeRequestError(`We could not send the code. ${result.message}`);
      }
    });

  const cancelDelete = () => {
    setCodeRequestError(null);
    setExportError(null);
    returnFocusToDeleteEntry.current = true;
    setDeleteStep("none");
  };

  const isBusy = runningTask !== null;
  const exportButtonProps = {
    disabled: isBusy && runningTask !== "export",
    loading: runningTask === "export",
    loadingTitle: "Preparing export…",
    onPress: () => void exportData(),
  };

  if (deleteStep === "code") {
    return (
      <DeleteAccountCodeStep
        onRequestDeleteCode={onRequestDeleteCode}
        onDeleteAccount={onDeleteAccount}
        onAccountDeleted={onAccountDeleted}
        onCancel={cancelDelete}
      />
    );
  }

  if (deleteStep === "confirm") {
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
          <Text style={textStyles.body}>If you sign up again later, you get a new, empty account.</Text>
        </View>
        <View style={authStyles.actions}>
          <AuthButton
            {...exportButtonProps}
            title="Export my data first"
            variant="tertiary"
            accessibilityHint="Opens the share sheet with a copy of your account data. Nothing is deleted."
          />
          <StatusText message={exportError} style={authStyles.fieldError} />
          <StatusText message={codeRequestError} style={authStyles.fieldError} />
          <AuthButton
            title="Email me a code"
            variant="secondary"
            disabled={runningTask === "export"}
            loading={runningTask === "code"}
            loadingTitle="Sending code…"
            accessibilityHint="Emails you a code to confirm. Nothing is deleted yet."
            onPress={() => void requestCode()}
          />
          <AuthButton title="Cancel" variant="tertiary" disabled={isBusy} onPress={cancelDelete} />
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
        <View style={styles.accountItems}>
          <AuthButton
            {...exportButtonProps}
            title="Export my data"
            variant="secondary"
            accessibilityHint="Opens the share sheet with a copy of your account data."
          />
          <StatusText message={exportError} style={authStyles.fieldError} />
          {age18Confirmed === "checking" ? (
            <View style={styles.statusRow}>
              <Text style={textStyles.bodyMuted}>Checking…</Text>
            </View>
          ) : null}
          {age18Confirmed === true ? (
            <View style={styles.statusRow}>
              <Text style={textStyles.bodyMuted} accessibilityElementsHidden importantForAccessibility="no">
                ✓
              </Text>
              <Text style={textStyles.bodyMuted}>18 or older: confirmed</Text>
            </View>
          ) : null}
          {age18Confirmed === false || age18Confirmed === "failed" ? (
            <View style={styles.adultItem}>
              <AuthButton
                title="Confirm I am 18 or older"
                variant="secondary"
                disabled={isBusy && runningTask !== "adult"}
                loading={runningTask === "adult"}
                loadingTitle="Saving…"
                accessibilityHint="Records that you are 18 or older. Needed for buying later."
                onPress={() => void confirmAdultAge()}
              />
              <Text style={textStyles.bodyMuted}>You can&apos;t undo this, except by deleting your account.</Text>
            </View>
          ) : null}
          <StatusText message={adultError} style={authStyles.fieldError} />
          <AuthButton
            ref={deleteEntry}
            title="Delete account"
            variant="dangerText"
            disabled={isBusy}
            accessibilityHint="Asks you to confirm before anything is deleted."
            onPress={() => {
              setExportError(null);
              setDeleteStep("confirm");
            }}
          />
        </View>
      </View>
    </AuthScreenLayout>
  );
}
