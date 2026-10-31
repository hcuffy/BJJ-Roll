import { Text, View } from "react-native";
import { MAGIC_LINK_EXPIRY_MINUTES } from "../auth/signInActions";
import { textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { AuthScreenLayout } from "./AuthScreenLayout";
import { LinkErrorCard, type LinkErrorCardProps } from "./LinkErrorCard";
import { ServerUnreachableNote } from "./ServerUnreachableNote";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";
import { formatCountdown } from "./useCountdown";

export interface LinkSentScreenProps {
  readonly email: string;
  readonly notice: string | null;
  readonly linkError: string | null;
  readonly linkErrorReason: LinkErrorCardProps["reason"];
  readonly offline: boolean;
  readonly formError: string | null;
  readonly cooldownSecondsLeft: number;
  readonly sending: boolean;
  readonly canUseDifferentEmail: boolean;
  readonly onResend: () => void;
  readonly onUseDifferentEmail: () => void;
}

export function LinkSentScreen(props: LinkSentScreenProps) {
  const { email, notice, offline, formError, cooldownSecondsLeft, sending } = props;
  return (
    <AuthScreenLayout>
      <Text accessibilityRole="header" style={textStyles.display}>
        Check your email
      </Text>
      <View style={authStyles.card}>
        <Text style={authStyles.cardIcon} accessibilityElementsHidden importantForAccessibility="no">
          ✉
        </Text>
        <View style={authStyles.cardBody}>
          <StatusText message={`We sent a sign-in link to ${email}. Open it on this phone.`} style={authStyles.notice} />
          <Text style={textStyles.bodyMuted}>Link expires in {MAGIC_LINK_EXPIRY_MINUTES} minutes.</Text>
          <StatusText message={notice} style={textStyles.bodyMuted} />
        </View>
      </View>
      <ServerUnreachableNote visible={offline} />
      {props.linkError ? <LinkErrorCard message={props.linkError} reason={props.linkErrorReason} /> : null}
      <StatusText message={formError} style={authStyles.fieldError} />
      <View style={authStyles.actions}>
        <AuthButton
          title={cooldownSecondsLeft > 0 && !sending ? `Resend in ${formatCountdown(cooldownSecondsLeft)}` : "Resend link"}
          variant="secondary"
          disabled={cooldownSecondsLeft > 0}
          loading={sending}
          loadingTitle="Sending link…"
          onPress={props.onResend}
        />
        <AuthButton title="Use a different email" variant="tertiary" disabled={!props.canUseDifferentEmail} onPress={props.onUseDifferentEmail} />
      </View>
    </AuthScreenLayout>
  );
}
