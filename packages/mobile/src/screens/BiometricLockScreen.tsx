import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { checkBiometric } from "../auth/biometricUnlock";
import { textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { AuthScreenLayout } from "./AuthScreenLayout";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";

export interface BiometricLockScreenProps {
  readonly onUnlocked: () => void;
  readonly onSignOut: () => void;
}

/** Launch with biometric unlock on (HEN-288): nothing signed-in shows until the check succeeds; Sign out is always there. */
export function BiometricLockScreen({ onUnlocked, onSignOut }: BiometricLockScreenProps) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The parent passes a fresh callback on every render; the check on open runs once.
  const unlocked = useRef(onUnlocked);
  unlocked.current = onUnlocked;

  const unlock = async () => {
    setChecking(true);
    setError(null);
    const check = await checkBiometric("Unlock BJJ Roll");
    setChecking(false);
    if (check.ok) {
      unlocked.current();
    } else if (!check.cancelled) {
      setError("Unlock didn't work. Try again.");
    }
  };

  useEffect(() => {
    void unlock();
    // Only on open; Unlock retries.
  }, []);

  return (
    <AuthScreenLayout>
      <View style={authStyles.heading}>
        <Text accessibilityRole="header" style={textStyles.display}>
          BJJ Roll is locked
        </Text>
        <Text style={textStyles.body}>Unlock with your fingerprint, face or phone PIN.</Text>
      </View>
      <StatusText message={error} style={authStyles.fieldError} />
      <View style={authStyles.actions}>
        <AuthButton title="Unlock" loading={checking} loadingTitle="Checking…" onPress={() => void unlock()} />
        <AuthButton title="Sign out" variant="tertiary" disabled={checking} onPress={onSignOut} />
      </View>
    </AuthScreenLayout>
  );
}
