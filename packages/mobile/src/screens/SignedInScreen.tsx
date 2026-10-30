import { type ComponentRef, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import type { AccountCodeResult, AccountDeletionResult, AccountExportResult, AgeConfirmationResult } from "../auth/accountActions";
import { colours, spacing, textStyles, typeScale } from "../theme/tokens";
import { AdultConfirmStep } from "./AdultConfirmStep";
import { type AdultStatus, AdultStatusItem } from "./AdultStatusItem";
import { AuthButton } from "./AuthButton";
import { AuthScreenLayout } from "./AuthScreenLayout";
import { DeleteAccountCodeStep } from "./DeleteAccountCodeStep";
import { DeleteAccountConfirmStep } from "./DeleteAccountConfirmStep";
import { ExportDataFirstAction, shareAccountExport } from "./ExportDataFirstAction";
import { ServerUnreachableNote } from "./ServerUnreachableNote";
import { type AccountFailureView, accountFailureView } from "./accountFailureView";
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

const styles = StyleSheet.create({
  // 16 margin + the layout's 16 gap = 32 above the section; 8 from the label to its items, 16 between items.
  accountSection: { marginTop: spacing.medium, gap: spacing.small },
  accountItems: { gap: spacing.medium },
  sectionLabel: { ...typeScale.label, color: colours.textSecondary },
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
  // One grey "can't reach the server" note for the export and the code request, like the gate's deleteOffline (HEN-305).
  const [offline, setOffline] = useState(false);
  const [age18Confirmed, setAge18Confirmed] = useState<AdultStatus>("checking");
  const [adultError, setAdultError] = useState<string | null>(null);
  // A ref, not state: two taps in the same tick both run before a re-render, and only the first may send a request.
  const inFlight = useRef(false);
  const confirmHeading = useRef<ComponentRef<typeof Text>>(null);
  const deleteEntry = useRef<ComponentRef<typeof View>>(null);
  const returnFocusToDeleteEntry = useRef(false);
  const [adultDialogOpen, setAdultDialogOpen] = useState(false);
  const adultEntry = useRef<ComponentRef<typeof View>>(null);
  const returnFocusToAdultEntry = useRef(false);
  // Set when this visit's confirm saved; cleared once focus has moved to the confirmed row (Vera round 4 item 3).
  const [adultJustConfirmed, setAdultJustConfirmed] = useState(false);

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

  useEffect(() => {
    if (!adultDialogOpen && returnFocusToAdultEntry.current) {
      returnFocusToAdultEntry.current = false;
      moveScreenReaderFocus(adultEntry.current);
    }
  }, [adultDialogOpen]);

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

  // Every action clears all three message slots and the note first: one message at a time (Sara; Bill Q1, Vera fix 1).
  const clearMessages = () => {
    setExportError(null);
    setCodeRequestError(null);
    setAdultError(null);
    setOffline(false);
  };

  const exportData = () =>
    runOnce("export", async () => {
      clearMessages();
      const failure = await shareAccountExport(onExportData);
      setOffline(failure?.offline ?? false);
      setExportError(failure?.error ?? null);
    });

  const confirmAdultAge = () =>
    runOnce("adult", async () => {
      clearMessages();
      const result = await onConfirmAdult();
      if (result.ok) {
        setAge18Confirmed(result.status.age18Confirmed);
        setAdultJustConfirmed(result.status.age18Confirmed);
      } else {
        setAdultError(`We could not save that. ${result.message}`);
      }
    });

  const showCodeFailure = (view: AccountFailureView) => {
    setOffline(view.offline);
    setCodeRequestError(view.error);
  };

  const requestCode = () =>
    runOnce("code", async () => {
      clearMessages();
      const result = await onRequestDeleteCode();
      if (result.ok) {
        setDeleteStep("code");
      } else {
        showCodeFailure(accountFailureView(result, "We could not send the code."));
      }
    });

  const cancelDelete = () => {
    clearMessages();
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

  if (adultDialogOpen) {
    return (
      <AdultConfirmStep
        // Either way out, focus goes back to the 18+ slot: the button on Cancel, "Saving…" on Yes, then the confirmed row once saved.
        onConfirm={() => {
          setAdultDialogOpen(false);
          void confirmAdultAge();
        }}
        onCancel={() => setAdultDialogOpen(false)}
      />
    );
  }

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
      <DeleteAccountConfirmStep
        headingRef={confirmHeading}
        exportAction={<ExportDataFirstAction {...exportButtonProps} error={exportError} />}
        codeRequestError={codeRequestError}
        offline={offline}
        sendingCode={runningTask === "code"}
        emailCodeDisabled={runningTask === "export"}
        cancelDisabled={isBusy}
        onEmailCode={() => void requestCode()}
        onCancel={cancelDelete}
      />
    );
  }

  return (
    <AuthScreenLayout>
      <Text accessibilityRole="header" style={textStyles.display}>
        You are signed in
      </Text>
      <AuthButton
        title="Sign out"
        variant="secondary"
        disabled={isBusy}
        onPress={() => {
          // Only when shown: an extra render after sign-out would flash this screen again (HEN-314).
          if (offline) {
            setOffline(false);
          }
          onSignOut();
        }}
      />
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
          <ServerUnreachableNote visible={offline} />
          <AdultStatusItem
            status={age18Confirmed}
            buttonRef={adultEntry}
            focusConfirmedRow={adultJustConfirmed}
            onConfirmedRowFocused={() => setAdultJustConfirmed(false)}
            disabled={isBusy && runningTask !== "adult"}
            loading={runningTask === "adult"}
            onConfirmPress={() => {
              clearMessages();
              returnFocusToAdultEntry.current = true;
              setAdultDialogOpen(true);
            }}
          />
          <StatusText message={adultError} style={authStyles.fieldError} />
          <AuthButton
            ref={deleteEntry}
            title="Delete account"
            variant="dangerText"
            disabled={isBusy}
            accessibilityHint="Asks you to confirm before anything is deleted."
            onPress={() => {
              clearMessages();
              setDeleteStep("confirm");
            }}
          />
        </View>
      </View>
    </AuthScreenLayout>
  );
}
