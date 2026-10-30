import { useState } from "react";
import type { BiometricUnlockSettingState } from "./BiometricUnlockSetting";

/**
 * The signed-in screen's message slots: the red errors, the grey export line (HEN-311) and the two grey offline notes, one
 * under Export my data and in the delete confirm (HEN-305), one under 18+ (HEN-311). `clearMessages` is the one helper every
 * signed-in action calls first, so only one message shows at a time; it clears the biometric toggle's error too (HEN-288).
 */
export function useSignedInMessages(biometric: Pick<BiometricUnlockSettingState, "error" | "onErrorChanged">) {
  const [exportError, setExportError] = useState<string | null>(null);
  // The grey line after an export's share sheet closes (HEN-311).
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [codeRequestError, setCodeRequestError] = useState<string | null>(null);
  // One grey "can't reach the server" note for the export and the code request, like the gate's deleteOffline (HEN-305).
  const [offline, setOffline] = useState(false);
  const [adultError, setAdultError] = useState<string | null>(null);
  // A network failure of the 18+ save: the grey note alone in that slot, not red (Vera, HEN-311).
  const [adultOffline, setAdultOffline] = useState(false);

  // One message at a time (Sara; Bill Q1, Vera fix 1 in HEN-305; Vera, HEN-311 fix 2).
  const clearMessages = () => {
    setExportError(null);
    setExportNotice(null);
    setCodeRequestError(null);
    setAdultError(null);
    setOffline(false);
    setAdultOffline(false);
    biometric.onErrorChanged(null);
  };
  const showsMessage =
    offline || adultOffline || [exportError, exportNotice, codeRequestError, adultError, biometric.error].some((message) => message !== null);

  return {
    exportError,
    setExportError,
    exportNotice,
    setExportNotice,
    codeRequestError,
    setCodeRequestError,
    offline,
    setOffline,
    adultError,
    setAdultError,
    adultOffline,
    setAdultOffline,
    clearMessages,
    showsMessage,
  };
}
