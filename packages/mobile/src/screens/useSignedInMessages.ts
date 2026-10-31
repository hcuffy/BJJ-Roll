import { useState } from "react";
import type { BiometricUnlockSettingState } from "./BiometricUnlockSetting";

export function useSignedInMessages(biometric: Pick<BiometricUnlockSettingState, "error" | "onErrorChanged">) {
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [codeRequestError, setCodeRequestError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [adultError, setAdultError] = useState<string | null>(null);
  const [adultOffline, setAdultOffline] = useState(false);

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
