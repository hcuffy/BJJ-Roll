import { StyleSheet, View } from "react-native";
import { spacing, textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { StatusText } from "./StatusText";

/** Calm note when the backend could not be reached (copy per Vera, HEN-285). Cleared by the next submit attempt. */
export const SERVER_UNREACHABLE_NOTE = "Can't reach the server right now. Check your connection and try again.";

/** Try again under the note, for a note that came from the startup check (HEN-310). */
export interface StartupRetry {
  readonly onRetry: () => void;
  /** The check is running again: the button is busy and ignores taps. */
  readonly retrying: boolean;
  /** Bumped by each failed retry: the note's text stays the same, so this makes screen readers hear it again. */
  readonly announceKey: number;
}

export interface StartupRetryProps {
  /** Shown under the note while the note is up; re-runs the startup check. */
  readonly startupRetry?: StartupRetry;
  /** Changes when a retry reached the server: screen-reader focus moves to the Email field, as the button it was on is gone. */
  readonly focusEmailKey?: number;
}

// Try again sits 8 under the note it belongs to, closer than the 16 to the next field (Vera #94 item 4).
const styles = StyleSheet.create({ retryGroup: { gap: spacing.small } });

/** The one "can't reach the server" message on every sign-in screen (HEN-287): muted, polite, never red. */
export function ServerUnreachableNote({ visible, startupRetry }: { readonly visible: boolean } & StartupRetryProps) {
  const note = (
    <StatusText
      message={visible ? SERVER_UNREACHABLE_NOTE : null}
      style={textStyles.bodyMuted}
      announce="polite"
      announceKey={startupRetry?.announceKey}
    />
  );
  if (!visible || !startupRetry) {
    return note;
  }
  return (
    <View style={styles.retryGroup}>
      {note}
      <AuthButton
        title="Try again"
        variant="tertiary"
        accessibilityHint="Checks the connection to the server again."
        loading={startupRetry.retrying}
        loadingTitle="Trying again…"
        onPress={startupRetry.onRetry}
      />
    </View>
  );
}
