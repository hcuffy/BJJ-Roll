import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { MobileAuthClient } from "../auth/authClient";
import { OTP_EXPIRY_MINUTES, sendEmailCode, verifyEmailCode } from "../auth/signInActions";
import { textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { AuthScreenLayout } from "./AuthScreenLayout";
import { StatusText } from "./StatusText";
import { TextField } from "./TextField";
import { authStyles } from "./authStyles";

export const RESEND_COOLDOWN_SECONDS = 30;
const CODE_LENGTH = 6;
const ONE_SECOND_MS = 1000;

export interface CodeEntryScreenProps {
  readonly client: MobileAuthClient;
  readonly email: string;
  readonly onSignedIn: () => void;
  readonly onBack: () => void;
}

function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function CodeEntryScreen({ client, email, onSignedIn, onBack }: CodeEntryScreenProps) {
  const [code, setCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendSecondsLeft, setResendSecondsLeft] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (resendSecondsLeft <= 0) {
      return undefined;
    }
    const timer = setTimeout(() => setResendSecondsLeft(resendSecondsLeft - 1), ONE_SECOND_MS);
    return () => clearTimeout(timer);
  }, [resendSecondsLeft]);

  const verify = async (candidate: string) => {
    if (isVerifying) {
      return;
    }
    setIsVerifying(true);
    setCodeError(null);
    setFormError(null);
    setNotice(null);
    // The user ticked the 17+ box on the email screen; it is required to get here.
    const result = await verifyEmailCode(client, { email, code: candidate, ageConfirmed: true });
    setIsVerifying(false);
    if (result.ok) {
      onSignedIn();
    } else if (result.reason === "invalidCode") {
      setCodeError(result.message);
    } else {
      setFormError(result.message);
    }
  };

  const resend = async () => {
    setIsResending(true);
    setCodeError(null);
    setFormError(null);
    setNotice(null);
    const result = await sendEmailCode(client, { email, ageConfirmed: true });
    setIsResending(false);
    if (result.ok) {
      setNotice(`We sent a new code to ${email}.`);
      setResendSecondsLeft(RESEND_COOLDOWN_SECONDS);
    } else {
      setFormError(result.message);
    }
  };

  const canResend = resendSecondsLeft <= 0 && !isVerifying;

  return (
    <AuthScreenLayout>
      <View style={authStyles.heading}>
        <Text accessibilityRole="header" style={textStyles.display}>
          Enter your code
        </Text>
        <Text style={textStyles.body}>We emailed a 6-digit code to {email}.</Text>
        <Text style={textStyles.bodyMuted}>Code expires in {OTP_EXPIRY_MINUTES} minutes.</Text>
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
          setCode(text);
          setCodeError(null);
          // The 6th digit submits on its own.
          if (text.trim().length === CODE_LENGTH && !isVerifying) {
            void verify(text);
          }
        }}
        onSubmitEditing={() => void verify(code)}
      />
      <StatusText message={notice} style={authStyles.notice} />
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
          title={canResend || isResending ? "Resend code" : `Resend in ${formatCountdown(Math.max(resendSecondsLeft, 0))}`}
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
