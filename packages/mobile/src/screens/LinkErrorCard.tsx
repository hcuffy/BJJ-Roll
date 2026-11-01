import { Text, View } from "react-native";
import { AGE_LINK_REFUSAL_NEXT_STEP } from "../auth/ageConfirmation";
import type { FailureReason } from "../auth/signInActions";
import { ATTESTATION_LINK_REFUSAL_NEXT_STEP } from "../auth/signUpAttestation";
import { textStyles } from "../theme/tokens";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";

export interface LinkErrorCardProps {
  readonly message: string;
  readonly reason: FailureReason | null;
}

export function LinkErrorCard({ message, reason }: LinkErrorCardProps) {
  if (reason === "linkNotStartedHere") {
    return <StatusText message={message} style={textStyles.bodyMuted} announce="polite" />;
  }
  return (
    <View style={[authStyles.card, authStyles.errorCard]}>
      <View style={authStyles.cardBody}>
        <StatusText message={message} style={authStyles.cardError} />
        {reason === "ageRequired" ? <Text style={textStyles.body}>{AGE_LINK_REFUSAL_NEXT_STEP}</Text> : null}
        {reason === "attestationRequired" ? <Text style={textStyles.body}>{ATTESTATION_LINK_REFUSAL_NEXT_STEP}</Text> : null}
      </View>
    </View>
  );
}
