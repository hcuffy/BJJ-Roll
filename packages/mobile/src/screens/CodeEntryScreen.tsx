import { useRef, useState } from "react";
import { Text, View } from "react-native";
import type { MobileAuthClient } from "../auth/authClient";
import { OTP_EXPIRY_MINUTES, sendEmailCode, verifyEmailCode, type ActionResult } from "../auth/signInActions";
import { textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { AuthScreenLayout } from "./AuthScreenLayout";
import { ServerUnreachableNote } from "./ServerUnreachableNote";
import { StatusText } from "./StatusText";
import { TextField } from "./TextField";
import { authStyles } from "./authStyles";
import { formatCountdown, RESEND_COOLDOWN_SECONDS, useCountdown } from "./useCountdown";

const CODE_LENGTH = 6;

export interface CodeEntryScreenProps {
  readonly client: MobileAuthClient;
  readonly email: string;
  /** The optional 18+ tick from the email screen; Resend sends it again so the latest send keeps it (HEN-263). */
  readonly age18Confirmed?: boolean;
  readonly onSignedIn: () => void;
  readonly onBack: () => void;
}

export function CodeEntryScreen({ client, email, age18Confirmed = false, onSignedIn, onBack }: CodeEntryScreenProps) {
  const [code, setCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const resendCooldown = useCountdown(RESEND_COOLDOWN_SECONDS);
  // Refs, not state: the 6th digit and the Done key can arrive in the same tick, before a re-render,
  // so both handlers must see the latest digits and the in-flight request immediately.
  const latestCode = useRef("");
  const inFlight = useRef(false);

  const showFailure = (result: Extract<ActionResult, { ok: false }>) => {
    if (result.reason === "network") {
      setOffline(true);
    } else {
      setFormError(result.message);
    }
  };

  const verify = async (candidate: string) => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setIsVerifying(true);
    setCodeError(null);
    setFormError(null);
    setNotice(null);
    setOffline(false);
    // The user ticked the 16+ box on the email screen; it is required to get here.
    const result = await verifyEmailCode(client, { email, code: candidate, age16Confirmed: true, signUpAttestationAccepted: true });
    inFlight.current = false;
    setIsVerifying(false);
    if (result.ok) {
      onSignedIn();
    } else if (result.reason === "invalidCode") {
      setCodeError(result.message);
    } else {
      showFailure(result);
    }
  };

  const resend = async () => {
    setIsResending(true);
    setCodeError(null);
    setFormError(null);
    setNotice(null);
    setOffline(false);
    const result = await sendEmailCode(client, { email, age16Confirmed: true, age18Confirmed, signUpAttestationAccepted: true });
    setIsResending(false);
    if (result.ok) {
      setNotice(`We sent a new code to ${email}.`);
      resendCooldown.restart();
    } else {
      showFailure(result);
    }
  };

  const canResend = resendCooldown.secondsLeft <= 0 && !isVerifying;

  return (
    <AuthScreenLayout>
      <View style={authStyles.heading}>
        <Text accessibilityRole="header" style={textStyles.display}>
          Enter your code
        </Text>
        <Text style={textStyles.body}>We emailed a 6-digit code to {email}.</Text>
        <Text style={textStyles.bodyMuted}>Code expires in {OTP_EXPIRY_MINUTES} minutes.</Text>
        <StatusText message={notice} style={textStyles.bodyMuted} />
      </View>
      <TextField
        label="6-digit code"
        error={codeError}
        autoFocus
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        inputMode="numeric"
        keyboardType="number-pad"
        maxLength={CODE_LENGTH}
        returnKeyType="done"
        value={code}
        onChangeText={(text) => {
          latestCode.current = text;
          setCode(text);
          setCodeError(null);
          // The 6th digit submits on its own.
          if (text.trim().length === CODE_LENGTH) {
            void verify(text);
          }
        }}
        onSubmitEditing={() => void verify(latestCode.current)}
      />
      <ServerUnreachableNote visible={offline} />
      <StatusText message={formError} style={authStyles.fieldError} />
      <View style={authStyles.actions}>
        <AuthButton
          title="Sign in"
          disabled={code.trim().length !== CODE_LENGTH}
          loading={isVerifying}
          loadingTitle="Signing in…"
          onPress={() => void verify(code)}
        />
        <AuthButton
          title={canResend || isResending ? "Resend code" : `Resend in ${formatCountdown(resendCooldown.secondsLeft)}`}
          variant="secondary"
          disabled={!canResend}
          loading={isResending}
          loadingTitle="Sending code…"
          onPress={() => void resend()}
        />
        <AuthButton title="Use a different email" variant="tertiary" disabled={isVerifying} onPress={onBack} />
      </View>
    </AuthScreenLayout>
  );
}
