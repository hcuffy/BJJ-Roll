import { useState } from "react";
import { Platform, Share, StyleSheet, View } from "react-native";
import type { AccountExportResult } from "../auth/accountActions";
import { failureMessages } from "../auth/signInActions";
import { spacing } from "../theme/tokens";
import { type AccountFailureView, accountFailureView } from "./accountFailureView";
import { AuthButton } from "./AuthButton";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";
import { whileFlagged } from "./whileFlagged";

export const EXPORT_SHARED_NOTICE = "Your data export was shared.";
export const EXPORT_CREATED_NOTICE = "Your data export was created. Check that you saved a copy.";

const EXPORT_FAILED = "Export failed.";
const exportFailedUnknown: AccountFailureView = { offline: false, error: `${EXPORT_FAILED} ${failureMessages.unknown}` };

export async function shareAccountExport(
  onExportData: () => Promise<AccountExportResult>,
  onShared: (notice: string) => void = () => undefined,
): Promise<AccountFailureView | null> {
  const result = await onExportData();
  if (!result.ok) {
    return accountFailureView(result, EXPORT_FAILED);
  }
  try {
    const shared = await Share.share({ title: "BJJ Roll data export", message: result.json });
    if (Platform.OS === "ios" && shared.action === Share.sharedAction) {
      onShared(EXPORT_SHARED_NOTICE);
    } else if (Platform.OS === "android") {
      onShared(EXPORT_CREATED_NOTICE);
    }
    return null;
  } catch {
    return exportFailedUnknown;
  }
}

const styles = StyleSheet.create({ exportFirst: { gap: spacing.medium, marginBottom: spacing.small } });

export interface ExportDataFirstActionProps {
  readonly error: string | null;
  readonly notice?: string | null;
  readonly loading: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}

export function ExportDataFirstAction(props: ExportDataFirstActionProps) {
  return (
    <View style={styles.exportFirst}>
      <AuthButton
        title="Export my data first"
        variant="tertiary"
        disabled={props.disabled}
        loading={props.loading}
        loadingTitle="Preparing export…"
        accessibilityHint="Opens the share sheet with a copy of your account data. Nothing is deleted."
        onPress={props.onPress}
      />
      <StatusText message={props.error} style={authStyles.fieldError} />
      <StatusText message={props.notice ?? null} style={authStyles.fieldNote} announce="polite" />
    </View>
  );
}

export interface ExportDataFirstGateHooks {
  readonly onStart: () => void;
  readonly setOffline: (offline: boolean) => void;
}

export function useExportDataFirst(
  inFlight: { current: boolean },
  onExportData: (() => Promise<AccountExportResult>) | undefined,
  hooks: ExportDataFirstGateHooks,
) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (exportData: () => Promise<AccountExportResult>) => {
    if (inFlight.current) {
      return;
    }
    setError(null);
    hooks.onStart();
    setExporting(true);
    const failure = await whileFlagged(inFlight, shareAccountExport)(exportData, setNotice).catch(() => exportFailedUnknown);
    setExporting(false);
    if (failure?.offline) {
      hooks.setOffline(true);
    } else {
      setError(failure?.error ?? null);
    }
  };

  const renderAction = (disabled: boolean) =>
    onExportData && (
      <ExportDataFirstAction error={error} notice={notice} loading={exporting} disabled={disabled} onPress={() => void run(onExportData)} />
    );

  return {
    exporting,
    clearError: () => {
      setError(null);
      setNotice(null);
    },
    renderAction,
  };
}
