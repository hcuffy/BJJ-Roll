import { StyleSheet, View } from "react-native";
import { spacing, textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { StatusText } from "./StatusText";

export const SERVER_UNREACHABLE_NOTE = "Can't reach the server right now. Check your connection and try again.";

export interface StartupRetry {
  readonly onRetry: () => void;
  readonly retrying: boolean;
  readonly announceKey: number;
}

export interface StartupRetryProps {
  readonly startupRetry?: StartupRetry;
  readonly focusEmailKey?: number;
}

const styles = StyleSheet.create({ retryGroup: { gap: spacing.small } });

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
