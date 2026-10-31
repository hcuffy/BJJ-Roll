import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import type { BiometricCheck, BiometricSetting } from "../auth/biometricUnlock";
import { colours, sizes, spacing, textStyles } from "../theme/tokens";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";
import { biometricCopy, biometricCheckError } from "./biometricCopy";

export interface BiometricUnlockSettingProps {
  readonly onReadBiometricSetting: () => Promise<BiometricSetting>;
  readonly onChangeBiometricUnlock: (on: boolean) => Promise<BiometricCheck>;
}

const styles = StyleSheet.create({
  item: { gap: spacing.small },
  row: { minHeight: sizes.minTapTarget, paddingHorizontal: spacing.large, flexDirection: "row", alignItems: "center", gap: spacing.medium },
  label: { ...textStyles.body, flex: 1 },
});

export interface BiometricUnlockSettingState {
  readonly setting: BiometricSetting | null;
  readonly onSettingChanged: (setting: BiometricSetting) => void;
  readonly onChangeBiometricUnlock: BiometricUnlockSettingProps["onChangeBiometricUnlock"];
  readonly error: string | null;
  readonly onErrorChanged: (error: string | null) => void;
  readonly saving: boolean;
  readonly onSavingChanged: (saving: boolean) => void;
}

export function useBiometricUnlockSetting({
  onReadBiometricSetting,
  onChangeBiometricUnlock,
}: BiometricUnlockSettingProps): BiometricUnlockSettingState {
  const [setting, setSetting] = useState<BiometricSetting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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
  return { setting, onSettingChanged: setSetting, onChangeBiometricUnlock, error, onErrorChanged: setError, saving, onSavingChanged: setSaving };
}

export interface BiometricUnlockSettingViewProps extends Omit<BiometricUnlockSettingState, "saving" | "onSavingChanged"> {
  readonly onSavingChanged?: BiometricUnlockSettingState["onSavingChanged"];
  readonly onChangeStarted: () => void;
  readonly otherActionRunning?: boolean;
}

export function BiometricUnlockSetting({
  setting,
  onSettingChanged,
  onChangeBiometricUnlock,
  error,
  onErrorChanged: setError,
  onSavingChanged = () => undefined,
  onChangeStarted,
  otherActionRunning = false,
}: BiometricUnlockSettingViewProps) {
  const [saving, setLocalSaving] = useState(false);
  const setSaving = (next: boolean) => {
    setLocalSaving(next);
    onSavingChanged(next);
  };
  const kind = setting?.kind ?? "biometrics";
  const copy = biometricCopy[kind];

  const change = async (on: boolean) => {
    onChangeStarted();
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
  const disabled = !available || saving || otherActionRunning;
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
          style={disabled ? [styles.label, { color: colours.textSecondary }] : styles.label}>
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
