import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { type BiometricKind, checkBiometric } from "../auth/biometricUnlock";
import { textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { AuthScreenLayout } from "./AuthScreenLayout";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";
import { BIOMETRIC_COPY, BIOMETRIC_SIGN_OUT_NOTE } from "./biometricCopy";

export interface BiometricLockScreenProps {
  readonly kind: BiometricKind;
  readonly onUnlocked: () => void;
  readonly onSignOut: () => void;
}

export function BiometricLockScreen({ kind, onUnlocked, onSignOut }: BiometricLockScreenProps) {
  const copy = BIOMETRIC_COPY[kind];
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unlocked = useRef(onUnlocked);
  unlocked.current = onUnlocked;

  const lockError = (failure: "lockout" | "notSetUp" | "failed") => {
    if (failure === "lockout") {
      return copy.lockoutError;
    }
    return failure === "notSetUp" ? copy.notSetUpError : "Unlock didn't work. Try again.";
  };

  const unlock = async () => {
    setChecking(true);
    setError(null);
    const check = await checkBiometric("Unlock BJJ Roll");
    setChecking(false);
    if (check.ok) {
      unlocked.current();
    } else if (check.failure !== "cancelled") {
      setError(lockError(check.failure));
    }
  };

  useEffect(() => {
    void unlock();
  }, []);

  return (
    <AuthScreenLayout>
      <View style={authStyles.heading}>
        <Text accessibilityRole="header" style={textStyles.display}>
          BJJ Roll is locked
        </Text>
        <Text style={textStyles.body}>{copy.lockLine}</Text>
      </View>
      <StatusText message={error} style={authStyles.fieldError} />
      <View style={authStyles.actions}>
        <AuthButton title="Unlock" loading={checking} loadingTitle="Checking…" onPress={() => void unlock()} />
        <AuthButton title="Sign out" variant="tertiary" disabled={checking} onPress={onSignOut} />
      </View>
      <Text style={textStyles.bodyMuted}>{BIOMETRIC_SIGN_OUT_NOTE}</Text>
    </AuthScreenLayout>
  );
}
