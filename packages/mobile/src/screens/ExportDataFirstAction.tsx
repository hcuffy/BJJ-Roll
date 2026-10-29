import { useState } from "react";
import { Share, StyleSheet, View } from "react-native";
import type { AccountExportResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { spacing } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";
import { whileFlagged } from "./whileFlagged";

/** Runs the export and opens the share sheet; resolves to the error to show, or null. Both delete paths use it (HEN-308). */
export async function shareAccountExport(onExportData: () => Promise<AccountExportResult>): Promise<string | null> {
  const result = await onExportData();
  if (!result.ok) {
    return `Export failed. ${result.message}`;
  }
  try {
    await Share.share({ title: "BJJ Roll data export", message: result.json });
    return null;
  } catch {
    return `Export failed. ${FAILURE_MESSAGES.unknown}`;
  }
}

// The actions' 16 gap + 8 = 24 between the export and the delete buttons below it (Vera, HEN-308); 16 to its own error.
const styles = StyleSheet.create({ exportFirst: { gap: spacing.medium, marginBottom: spacing.small } });

export interface ExportDataFirstActionProps {
  readonly error: string | null;
  readonly loading: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}

/** "Export my data first" and its error, inside the delete confirm of the signed-in screen and the attestation gate. */
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
    </View>
  );
}

/** How the gate shows an export's start and a network failure: its code-send messages clear, and its grey offline note shows. */
export interface ExportDataFirstGateHooks {
  readonly onStart: () => void;
  readonly setOffline: (offline: boolean) => void;
}

/**
 * The gate's export-first state (HEN-308). `inFlight` is the gate's request flag: only one export or code request runs at a time,
 * and Android back waits for it. Without `onExportData` there is no action to render.
 */
export function useExportDataFirst(
  inFlight: { current: boolean },
  onExportData: (() => Promise<AccountExportResult>) | undefined,
  hooks: ExportDataFirstGateHooks,
) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Never accepts the attestation: it only reads GET /account/export.
  const run = async (exportData: () => Promise<AccountExportResult>) => {
    if (inFlight.current) {
      return;
    }
    setError(null);
    hooks.onStart();
    setExporting(true);
    // A network failure gets the calm grey note, not red "Export failed" (Vera, HEN-308).
    let offline = false;
    const watched = async () => {
      const result = await exportData();
      offline = !result.ok && result.reason === "network";
      return result;
    };
    const exportError = await whileFlagged(inFlight, shareAccountExport)(watched).catch(() => `Export failed. ${FAILURE_MESSAGES.unknown}`);
    setExporting(false);
    if (offline) {
      hooks.setOffline(true);
    } else {
      setError(exportError);
    }
  };

  const renderAction = (disabled: boolean) =>
    onExportData && <ExportDataFirstAction error={error} loading={exporting} disabled={disabled} onPress={() => void run(onExportData)} />;

  return { exporting, clearError: () => setError(null), renderAction };
}
