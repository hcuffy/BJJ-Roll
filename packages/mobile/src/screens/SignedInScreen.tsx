import { type ComponentRef, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { AccountCodeResult, AccountDeletionResult, AccountExportResult, AgeConfirmationResult } from "../auth/accountActions";
import { colours, spacing, textStyles, typeScale } from "../theme/tokens";
import { AdultConfirmStep } from "./AdultConfirmStep";
import { type AdultStatus, AdultStatusItem } from "./AdultStatusItem";
import { AuthButton } from "./AuthButton";
import { AuthScreenLayout } from "./AuthScreenLayout";
import { BiometricUnlockSetting, type BiometricUnlockSettingProps, useBiometricUnlockSetting } from "./BiometricUnlockSetting";
import { DeleteAccountCodeStep, type DeleteAccountCodeStepProps } from "./DeleteAccountCodeStep";
import { DeleteAccountConfirmStep } from "./DeleteAccountConfirmStep";
import { ExportDataFirstAction, shareAccountExport } from "./ExportDataFirstAction";
import { ServerUnreachableNote } from "./ServerUnreachableNote";
import { type AccountFailureView, accountFailureView } from "./accountFailureView";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";
import { useSignedInMessages } from "./useSignedInMessages";
import { moveScreenReaderFocus } from "./moveScreenReaderFocus";
import type { DeleteStep } from "./types";

export interface SignedInScreenProps extends BiometricUnlockSettingProps {
  readonly onSignOut: () => void;
  readonly onExportData: () => Promise<AccountExportResult>;
  readonly onRequestDeleteCode: () => Promise<AccountCodeResult>;
  readonly onDeleteAccount: (code: string) => Promise<AccountDeletionResult>;
  readonly onAccountDeleted: DeleteAccountCodeStepProps["onAccountDeleted"];
  readonly onReadAgeConfirmation: () => Promise<AgeConfirmationResult>;
  readonly onConfirmAdult: () => Promise<AgeConfirmationResult>;
}

type AccountTask = "export" | "code" | "adult";
const styles = StyleSheet.create({
  accountSection: { marginTop: spacing.medium, gap: spacing.small },
  accountItems: { gap: spacing.medium },
  sectionLabel: { ...typeScale.label, color: colours.textSecondary },
});

export function SignedInScreen({
  onSignOut,
  onExportData,
  onRequestDeleteCode,
  onDeleteAccount,
  onAccountDeleted,
  onReadAgeConfirmation,
  onConfirmAdult,
  ...biometricCallbacks
}: SignedInScreenProps) {
  const biometricSetting = useBiometricUnlockSetting(biometricCallbacks);
  const messages = useSignedInMessages(biometricSetting);
  const [deleteStep, setDeleteStep] = useState<DeleteStep>("none");
  const [runningTask, setRunningTask] = useState<AccountTask | null>(null);
  const [age18Confirmed, setAge18Confirmed] = useState<AdultStatus>("checking");
  const inFlight = useRef(false);
  const confirmHeading = useRef<ComponentRef<typeof Text>>(null);
  const deleteEntry = useRef<ComponentRef<typeof View>>(null);
  const returnFocusToDeleteEntry = useRef(false);
  const [adultDialogOpen, setAdultDialogOpen] = useState(false);
  const adultEntry = useRef<ComponentRef<typeof View>>(null);
  const returnFocusToAdultEntry = useRef(false);
  const [adultJustConfirmed, setAdultJustConfirmed] = useState(false);

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

  const readAgeConfirmation = useRef(onReadAgeConfirmation);
  useEffect(() => {
    let active = true;
    void readAgeConfirmation.current().then((result) => {
      if (active) {
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
      messages.clearMessages();
      const failure = await shareAccountExport(onExportData, messages.setExportNotice);
      messages.setOffline(failure?.offline ?? false);
      messages.setExportError(failure?.error ?? null);
    });

  const confirmAdultAge = () =>
    runOnce("adult", async () => {
      messages.clearMessages();
      const result = await onConfirmAdult();
      if (result.ok) {
        setAge18Confirmed(result.status.age18Confirmed);
        setAdultJustConfirmed(result.status.age18Confirmed);
      } else if (result.reason === "network") {
        messages.setAdultOffline(true);
      } else {
        messages.setAdultError(`We could not save that. ${result.message}`);
      }
    });

  const showCodeFailure = (view: AccountFailureView) => {
    messages.setOffline(view.offline);
    messages.setCodeRequestError(view.error);
  };

  const requestCode = () =>
    runOnce("code", async () => {
      messages.clearMessages();
      const result = await onRequestDeleteCode();
      if (result.ok) {
        setDeleteStep("code");
      } else {
        showCodeFailure(accountFailureView(result, "We could not send the code."));
      }
    });

  const cancelDelete = () => {
    messages.clearMessages();
    returnFocusToDeleteEntry.current = true;
    setDeleteStep("none");
  };

  const isBusy = runningTask !== null || biometricSetting.saving;
  const exportButtonProps = {
    disabled: isBusy && runningTask !== "export",
    loading: runningTask === "export",
    loadingTitle: "Preparing export…",
    onPress: () => void exportData(),
  };

  if (adultDialogOpen) {
    return (
      <AdultConfirmStep
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
        exportAction={<ExportDataFirstAction {...exportButtonProps} error={messages.exportError} notice={messages.exportNotice} />}
        codeRequestError={messages.codeRequestError}
        offline={messages.offline}
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
          if (messages.showsMessage) {
            messages.clearMessages();
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
          <StatusText message={messages.exportError} style={authStyles.fieldError} />
          <StatusText message={messages.exportNotice} style={authStyles.fieldNote} announce="polite" />
          <ServerUnreachableNote visible={messages.offline} />
          <AdultStatusItem
            status={age18Confirmed}
            buttonRef={adultEntry}
            focusConfirmedRow={adultJustConfirmed}
            onConfirmedRowFocused={() => setAdultJustConfirmed(false)}
            disabled={isBusy && runningTask !== "adult"}
            loading={runningTask === "adult"}
            onConfirmPress={() => {
              messages.clearMessages();
              returnFocusToAdultEntry.current = true;
              setAdultDialogOpen(true);
            }}
          />
          <StatusText message={messages.adultError} style={authStyles.fieldError} />
          <ServerUnreachableNote visible={messages.adultOffline} />
          <BiometricUnlockSetting {...biometricSetting} onChangeStarted={messages.clearMessages} otherActionRunning={isBusy} />
          <AuthButton
            ref={deleteEntry}
            title="Delete account"
            variant="dangerText"
            disabled={isBusy}
            accessibilityHint="Asks you to confirm before anything is deleted."
            onPress={() => {
              messages.clearMessages();
              setDeleteStep("confirm");
            }}
          />
        </View>
      </View>
    </AuthScreenLayout>
  );
}
