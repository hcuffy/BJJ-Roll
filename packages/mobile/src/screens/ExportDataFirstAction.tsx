import { useState } from "react";
import { Share } from "react-native";
import type { AccountExportResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
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

export interface ExportDataFirstActionProps {
  readonly error: string | null;
  readonly loading: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}

/** "Export my data first" and its error, inside the delete confirm of the signed-in screen and the attestation gate. */
export function ExportDataFirstAction(props: ExportDataFirstActionProps) {
  return (
    <>
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
    </>
  );
}

/**
 * The gate's export-first state (HEN-308). `inFlight` is the gate's request flag: only one export or code request runs at a time,
 * and Android back waits for it. Without `onExportData` there is no action to render.
 */
export function useExportDataFirst(inFlight: { current: boolean }, onExportData?: () => Promise<AccountExportResult>) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Never accepts the attestation: it only reads GET /account/export.
  const run = async (exportData: () => Promise<AccountExportResult>) => {
    if (inFlight.current) {
      return;
    }
    setError(null);
    setExporting(true);
    const exportError = await whileFlagged(inFlight, shareAccountExport)(exportData).catch(() => `Export failed. ${FAILURE_MESSAGES.unknown}`);
    setExporting(false);
    setError(exportError);
  };

  const renderAction = (disabled: boolean) =>
    onExportData && <ExportDataFirstAction error={error} loading={exporting} disabled={disabled} onPress={() => void run(onExportData)} />;

  return { exporting, clearError: () => setError(null), renderAction };
}
