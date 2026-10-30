import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import type { BiometricCheck, BiometricSetting } from "../auth/biometricUnlock";
import { colours, sizes, spacing, textStyles } from "../theme/tokens";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";
import { BIOMETRIC_COPY, biometricCheckError } from "./biometricCopy";

export interface BiometricUnlockSettingProps {
  readonly onReadBiometricSetting: () => Promise<BiometricSetting>;
  /** Turning on runs the check first; turning off needs none. */
  readonly onChangeBiometricUnlock: (on: boolean) => Promise<BiometricCheck>;
}

const styles = StyleSheet.create({
  item: { gap: spacing.small },
  row: { minHeight: sizes.minTapTarget, paddingHorizontal: spacing.large, flexDirection: "row", alignItems: "center", gap: spacing.medium },
  label: { ...textStyles.body, flex: 1 },
});

export interface BiometricUnlockSettingState {
  /** null while it is read. */
  readonly setting: BiometricSetting | null;
  readonly onSettingChanged: (setting: BiometricSetting) => void;
  readonly onChangeBiometricUnlock: BiometricUnlockSettingProps["onChangeBiometricUnlock"];
  /** The toggle's red error; held by the screen so its clearMessages() clears it with the other slots (HEN-311). */
  readonly error: string | null;
  readonly onErrorChanged: (error: string | null) => void;
}

/**
 * Reads the setting once per visit to the signed-in screen; called there, not in the toggle, so the delete and 18+ dialogs
 * (which replace the account section) do not re-read it each time they close.
 */
export function useBiometricUnlockSetting({
  onReadBiometricSetting,
  onChangeBiometricUnlock,
}: BiometricUnlockSettingProps): BiometricUnlockSettingState {
  const [setting, setSetting] = useState<BiometricSetting | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The parent passes a fresh callback on every render.
  const readSetting = useRef(onReadBiometricSetting);
  useEffect(() => {
    let active = true;
    void readSetting.current().then((result) => {
      if (active) {
        setSetting(result);
      }
    });
    return () => {
      active = false;
    };
  }, []);
  return { setting, onSettingChanged: setSetting, onChangeBiometricUnlock, error, onErrorChanged: setError };
}

/**
 * Account section toggle (HEN-288). The whole row is the switch (one screen-reader stop, named by the visible label).
 * Disabled, with a note that is also its hint, on a phone without a fingerprint or face enrolled.
 */
export function BiometricUnlockSetting({
  setting,
  onSettingChanged,
  onChangeBiometricUnlock,
  error,
  onErrorChanged: setError,
}: BiometricUnlockSettingState) {
  const [saving, setSaving] = useState(false);
  const kind = setting?.kind ?? "biometrics";
  const copy = BIOMETRIC_COPY[kind];

  const change = async (on: boolean) => {
    setSaving(true);
    setError(null);
    const check = await onChangeBiometricUnlock(on).catch((): BiometricCheck => ({ ok: false, failure: "failed" }));
    setSaving(false);
    if (check.ok) {
      onSettingChanged({ available: true, on, kind });
    } else if (check.failure !== "cancelled") {
      setError(on ? biometricCheckError(check.failure, copy, "That didn't work. Try again.") : "We could not save that. Try again.");
    }
  };

  const available = setting?.available === true;
  const on = available && setting.on;
  const disabled = !available || saving;
  return (
    <View style={styles.item}>
      <Pressable
        accessible
        accessibilityRole="switch"
        accessibilityLabel={copy.toggleLabel}
        accessibilityHint={available ? copy.toggleHint : copy.setUpNote}
        accessibilityState={{ checked: on, disabled, busy: saving }}
        disabled={disabled}
        onPress={() => void change(!on)}
        style={styles.row}>
        <Text
          importantForAccessibility="no"
          accessibilityElementsHidden
          style={available ? styles.label : [styles.label, { color: colours.textSecondary }]}>
          {copy.toggleLabel}
        </Text>
        <Switch
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          value={on}
          disabled={disabled}
          onValueChange={(next: boolean) => void change(next)}
          trackColor={{ false: colours.border, true: colours.primary }}
          ios_backgroundColor={colours.border}
          thumbColor={on ? colours.background : colours.textPrimary}
        />
      </Pressable>
      {setting?.available === false ? <Text style={textStyles.bodyMuted}>{copy.setUpNote}</Text> : null}
      <StatusText message={error} style={authStyles.fieldError} />
    </View>
  );
}
