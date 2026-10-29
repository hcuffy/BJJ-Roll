import type { ComponentRef, ReactNode, Ref } from "react";
import { Text, View } from "react-native";
import { textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { AuthScreenLayout } from "./AuthScreenLayout";
import { ServerUnreachableNote } from "./ServerUnreachableNote";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";

export interface DeleteAccountConfirmStepProps {
  /** The caller moves screen-reader focus here when the step opens (it acts as a dialog). */
  readonly headingRef: Ref<ComponentRef<typeof Text>>;
  /** "Export my data first" and its error (ExportDataFirstAction); the gate offers it too, as export is not attestation-gated (HEN-308). */
  readonly exportAction?: ReactNode;
  readonly codeRequestError: string | null;
  /** The grey "can't reach the server" note instead of a red error (the gate, Vera #74 round 4). */
  readonly offline?: boolean;
  readonly sendingCode: boolean;
  readonly emailCodeDisabled?: boolean;
  readonly cancelDisabled: boolean;
  readonly onEmailCode: () => void;
  readonly onCancel: () => void;
}

/**
 * First step of delete account (HEN-65), shared by the signed-in screen and the sign-up attestation gate.
 * Nothing is sent until "Email me a code".
 */
export function DeleteAccountConfirmStep(props: DeleteAccountConfirmStepProps) {
  return (
    <AuthScreenLayout>
      <Text accessibilityRole="header" style={textStyles.display}>
        You are signed in
      </Text>
      <View style={authStyles.heading}>
        <Text ref={props.headingRef} accessibilityRole="header" style={textStyles.title}>
          Delete your account?
        </Text>
        <Text style={textStyles.body}>This permanently deletes your account, handle and sign-in data now. It can&apos;t be undone.</Text>
        <Text style={textStyles.body}>If you sign up again later, you get a new, empty account.</Text>
      </View>
      <ServerUnreachableNote visible={props.offline === true} />
      <View style={authStyles.actions}>
        {props.exportAction}
        <StatusText message={props.codeRequestError} style={authStyles.fieldError} />
        <AuthButton
          title="Email me a code"
          variant="secondary"
          disabled={props.emailCodeDisabled}
          loading={props.sendingCode}
          loadingTitle="Sending code…"
          accessibilityHint="Emails you a code to confirm. Nothing is deleted yet."
          onPress={props.onEmailCode}
        />
        <AuthButton title="Cancel" variant="tertiary" disabled={props.cancelDisabled} onPress={props.onCancel} />
      </View>
    </AuthScreenLayout>
  );
}
