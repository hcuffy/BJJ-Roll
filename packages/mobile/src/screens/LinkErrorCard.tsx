import { Text, View } from "react-native";
import { AGE_LINK_REFUSAL_NEXT_STEP } from "../auth/ageConfirmation";
import type { FailureReason } from "../auth/signInActions";
import { textStyles } from "../theme/tokens";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";

export interface LinkErrorCardProps {
  readonly message: string;
  /** "ageRequired" (r=age_refused) adds the next step under the refusal; keyed on the reason, not the copy (Vera round 4 item 4). */
  readonly reason: FailureReason | null;
}

/** Red card above the sign-in title when a magic link failed. One column body, like the "Check your email" card (Vera round 4 item 1). */
export function LinkErrorCard({ message, reason }: LinkErrorCardProps) {
  return (
    <View style={[authStyles.card, authStyles.errorCard]}>
      <View style={authStyles.cardBody}>
        <StatusText message={message} style={authStyles.cardError} />
        {reason === "ageRequired" ? <Text style={textStyles.body}>{AGE_LINK_REFUSAL_NEXT_STEP}</Text> : null}
      </View>
    </View>
  );
}
