import { useState } from "react";
import { Text, View } from "react-native";
import { type BiometricCheck } from "../auth/biometricUnlock";
import { textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { AuthScreenLayout } from "./AuthScreenLayout";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";

export interface BiometricOfferScreenProps {
  /** Runs the check and saves "on" only when it succeeds. */
  readonly onTurnOn: () => Promise<BiometricCheck>;
  /** Called after a successful Turn on, and on Not now. */
  readonly onDone: () => void;
}

export const BIOMETRIC_CHECK_FAILED = "That didn't work. Try again, or choose Not now.";

/** Shown once after the first sign-in on a phone with biometrics (HEN-288). Opt-in: Not now changes nothing. */
export function BiometricOfferScreen({ onTurnOn, onDone }: BiometricOfferScreenProps) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const turnOn = async () => {
    setChecking(true);
    setError(null);
    const check = await onTurnOn().catch((): BiometricCheck => ({ ok: false, cancelled: false }));
    setChecking(false);
    if (check.ok) {
      onDone();
    } else if (!check.cancelled) {
      setError(BIOMETRIC_CHECK_FAILED);
    }
  };

  return (
    <AuthScreenLayout>
      <View style={authStyles.heading}>
        <Text accessibilityRole="header" style={textStyles.display}>
          Unlock with fingerprint or face?
        </Text>
        <Text style={textStyles.body}>BJJ Roll will ask for your fingerprint, face or phone PIN each time it opens.</Text>
        <Text style={textStyles.bodyMuted}>You can change this later under Account.</Text>
      </View>
      <StatusText message={error} style={authStyles.fieldError} />
      <View style={authStyles.actions}>
        <AuthButton title="Turn on" loading={checking} loadingTitle="Checking…" onPress={() => void turnOn()} />
        <AuthButton title="Not now" variant="tertiary" disabled={checking} onPress={onDone} />
      </View>
    </AuthScreenLayout>
  );
}
