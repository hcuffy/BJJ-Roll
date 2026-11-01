import { View } from "react-native";
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
        <StatusText message={reason === "attestationRequired" ? ATTESTATION_LINK_REFUSAL_NEXT_STEP : message} style={authStyles.cardError} />
      </View>
    </View>
  );
}
