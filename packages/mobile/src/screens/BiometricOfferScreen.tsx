import { useEffect, useRef, useState } from "react";
import { BackHandler, Text, View } from "react-native";
import type { BiometricCheck, BiometricKind } from "../auth/biometricUnlock";
import { textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { AuthScreenLayout } from "./AuthScreenLayout";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";
import { biometricCopy, BIOMETRIC_OFFER_BENEFIT, biometricCheckError } from "./biometricCopy";

export interface BiometricOfferScreenProps {
  readonly kind: BiometricKind;
  readonly onTurnOn: () => Promise<BiometricCheck>;
  readonly onDone: () => void;
}

export const BIOMETRIC_CHECK_FAILED = "That didn't work. Try again, or choose Not now.";

export function BiometricOfferScreen({ kind, onTurnOn, onDone }: BiometricOfferScreenProps) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = biometricCopy[kind];
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      done.current();
      return true;
    });
    return () => subscription.remove();
  }, []);

  const turnOn = async () => {
    setChecking(true);
    setError(null);
    const check = await onTurnOn().catch((): BiometricCheck => ({ ok: false, failure: "failed" }));
    setChecking(false);
    if (check.ok) {
      onDone();
    } else if (check.failure !== "cancelled") {
      setError(biometricCheckError(check.failure, copy, BIOMETRIC_CHECK_FAILED));
    }
  };

  return (
    <AuthScreenLayout>
      <View style={authStyles.heading}>
        <Text accessibilityRole="header" style={textStyles.display}>
          {copy.offerTitle}
        </Text>
        <Text style={textStyles.body}>{BIOMETRIC_OFFER_BENEFIT}</Text>
        <Text style={textStyles.body}>{copy.offerBody}</Text>
        <Text style={textStyles.bodyMuted}>{copy.offerPrivacy}</Text>
        <Text style={textStyles.bodyMuted}>You can change this later under Account.</Text>
      </View>
      <StatusText message={error} style={authStyles.fieldError} />
      <View style={authStyles.actions}>
        <AuthButton title="Turn on" loading={checking} loadingTitle="Checking…" onPress={() => void turnOn()} />
        <AuthButton title="Not now" variant="secondary" large disabled={checking} onPress={onDone} />
      </View>
    </AuthScreenLayout>
  );
}
