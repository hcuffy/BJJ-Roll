import { useEffect, useRef, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import type { BiometricCheck, BiometricSetting } from "../auth/biometricUnlock";
import { colours, sizes, spacing, textStyles } from "../theme/tokens";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";

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
  return { setting, onSettingChanged: setSetting, onChangeBiometricUnlock };
}

/** Account section toggle (HEN-288). Disabled, with a note, on a phone without a fingerprint or face enrolled. */
export function BiometricUnlockSetting({ setting, onSettingChanged, onChangeBiometricUnlock }: BiometricUnlockSettingState) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (on: boolean) => {
    setSaving(true);
    setError(null);
    const check = await onChangeBiometricUnlock(on).catch((): BiometricCheck => ({ ok: false, cancelled: false }));
    setSaving(false);
    if (check.ok) {
      onSettingChanged({ available: true, on });
    } else if (!check.cancelled) {
      setError(on ? "That didn't work. Try again." : "We could not save that. Try again.");
    }
  };

  const available = setting?.available === true;
  return (
    <View style={styles.item}>
      <View style={styles.row}>
        <Text style={available ? styles.label : [styles.label, { color: colours.textSecondary }]}>Biometric unlock</Text>
        <Switch
          accessibilityLabel="Biometric unlock"
          accessibilityHint="Asks for your fingerprint, face or phone PIN when the app opens."
          value={setting?.available === true && setting.on}
          disabled={!available || saving}
          onValueChange={(on: boolean) => void change(on)}
          trackColor={{ false: colours.surfaceRaised, true: colours.primary }}
          thumbColor={colours.textPrimary}
        />
      </View>
      {setting?.available === false ? (
        <Text style={textStyles.bodyMuted}>Set up a fingerprint or face unlock in your phone&apos;s settings to use this.</Text>
      ) : null}
      <StatusText message={error} style={authStyles.fieldError} />
    </View>
  );
}
