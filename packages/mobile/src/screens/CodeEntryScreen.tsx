import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { MobileAuthClient } from "../auth/authClient";
import { OTP_EXPIRY_MINUTES, sendEmailCode, verifyEmailCode, type ActionResult, type SessionKeyStore } from "../auth/signInActions";
import { textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { AuthScreenLayout } from "./AuthScreenLayout";
import { LinkErrorCard, type LinkErrorCardProps } from "./LinkErrorCard";
import { ServerUnreachableNote } from "./ServerUnreachableNote";
import { StatusText } from "./StatusText";
import { TextField } from "./TextField";
import { authStyles } from "./authStyles";
import { formatCountdown, RESEND_COOLDOWN_SECONDS, useCountdown } from "./useCountdown";

const CODE_LENGTH = 6;
export const CODE_SCREEN_INVALID_LINK = "This sign-in link has expired or was already used. Enter the code from your email, or send a new one.";

export interface CodeEntryScreenProps {
  readonly client: MobileAuthClient;
  readonly secureStore: SessionKeyStore;
  readonly email: string;
  readonly age18Confirmed?: boolean;
  readonly linkError?: string | null;
  readonly linkErrorReason?: LinkErrorCardProps["reason"];
  readonly onClearLinkError?: () => void;
  readonly serverUnreachable?: boolean;
  readonly onClearServerUnreachable?: () => void;
  readonly linkAttempt?: number;
  readonly onSignedIn: () => void;
  readonly onBack: () => void;
}

export function CodeEntryScreen({
  client,
  secureStore,
  email,
  age18Confirmed = false,
  linkError = null,
  linkErrorReason = null,
  onClearLinkError,
  serverUnreachable = false,
  onClearServerUnreachable,
  linkAttempt = 0,
  onSignedIn,
  onBack,
}: CodeEntryScreenProps) {
  const [code, setCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const resendCooldown = useCountdown(RESEND_COOLDOWN_SECONDS);
  const latestCode = useRef("");
  const inFlight = useRef(false);

  useEffect(() => {
    setCodeError(null);
    setFormError(null);
    setOffline(false);
  }, [linkAttempt]);

  const startAttempt = () => {
    onClearLinkError?.();
    onClearServerUnreachable?.();
    setCodeError(null);
    setFormError(null);
    setNotice(null);
    setOffline(false);
  };

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
    startAttempt();
    const result = await verifyEmailCode(client, { email, code: candidate, age16Confirmed: true, signUpAttestationAccepted: true }, secureStore);
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
    startAttempt();
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
        error={linkError ? null : codeError}
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
          if (text.trim().length === CODE_LENGTH) {
            void verify(text);
          }
        }}
        onSubmitEditing={() => void verify(latestCode.current)}
      />
      <ServerUnreachableNote visible={serverUnreachable || (offline && !linkError)} />
      {linkError ? (
        <LinkErrorCard message={linkErrorReason === "invalidLink" ? CODE_SCREEN_INVALID_LINK : linkError} reason={linkErrorReason} />
      ) : null}
      <StatusText message={linkError ? null : formError} style={authStyles.fieldError} />
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
