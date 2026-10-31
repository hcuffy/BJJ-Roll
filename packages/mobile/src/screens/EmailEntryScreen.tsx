import { useEffect, useState } from "react";
import { View } from "react-native";
import { isEmailAddress, missingHint } from "../auth/ageConfirmation";
import type { MobileAuthClient } from "../auth/authClient";
import { FAILURE_MESSAGES, sendEmailCode, sendMagicLink, type ActionResult } from "../auth/signInActions";
import { signInWithProvider, socialFailureMessage, type SocialProvider, type SocialSignInDependencies } from "../auth/socialSignIn";
import { SIGN_UP_ATTESTATION_REFUSAL_MESSAGE } from "../auth/signUpAttestation";
import { AgeConfirmationFields } from "./AgeConfirmationFields";
import { EmailSendButtons } from "./EmailSendButtons";
import { AuthScreenLayout } from "./AuthScreenLayout";
import type { LinkErrorCardProps } from "./LinkErrorCard";
import { LinkSentScreen } from "./LinkSentScreen";
import { ServerUnreachableNote, type StartupRetryProps } from "./ServerUnreachableNote";
import { SignInHeader } from "./SignInHeader";
import { SignUpAttestationFields } from "./SignUpAttestationFields";
import { SocialSignInButtons } from "./SocialSignInButtons";
import { StatusText } from "./StatusText";
import { EMAIL_INPUT_PROPS, TextField } from "./TextField";
import { authStyles } from "./authStyles";
import { RESEND_COOLDOWN_SECONDS, useCountdown } from "./useCountdown";

export const TICK_AGE_BOX_MESSAGE = "Tick the box to confirm you are 16 or older.";
export { SERVER_UNREACHABLE_NOTE } from "./ServerUnreachableNote";

export interface EmailEntryScreenProps extends StartupRetryProps {
  readonly client: MobileAuthClient;
  readonly onCodeSent: (email: string, age18Confirmed: boolean) => void;
  readonly linkError?: string | null;
  readonly linkErrorReason?: LinkErrorCardProps["reason"];
  readonly onClearLinkError?: () => void;
  readonly accountNotice?: string | null;
  readonly onClearAccountNotice?: () => void;
  readonly serverUnreachable?: boolean;
  readonly onClearServerUnreachable?: () => void;
  readonly linkAttempt?: number;
  readonly socialProviders?: readonly SocialProvider[];
  readonly socialSignIn?: SocialSignInDependencies;
  readonly onSignedIn?: () => void;
}

type Sending = "code" | "link" | SocialProvider | null;

export function EmailEntryScreen({
  client,
  onCodeSent,
  linkError = null,
  linkErrorReason = null,
  onClearLinkError,
  accountNotice = null,
  onClearAccountNotice,
  serverUnreachable = false,
  onClearServerUnreachable,
  linkAttempt = 0,
  socialProviders = [],
  socialSignIn,
  onSignedIn,
  ...startup
}: EmailEntryScreenProps) {
  const [email, setEmail] = useState("");
  const [age16Confirmed, setAge16Confirmed] = useState(false);
  const [age18Confirmed, setAge18Confirmed] = useState(false);
  const [attestationAccepted, setAttestationAccepted] = useState(false);
  const [attestationError, setAttestationError] = useState<string | null>(null);
  const [sending, setSending] = useState<Sending>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [ageError, setAgeError] = useState<string | null>(null);
  const [announceAgeError, setAnnounceAgeError] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [socialProgress, setSocialProgress] = useState<"opening" | "signingIn">("opening");
  const [socialError, setSocialError] = useState<string | null>(null);
  const linkCooldown = useCountdown(RESEND_COOLDOWN_SECONDS);
  const ready = age16Confirmed && attestationAccepted && isEmailAddress(email);
  const sendHint = missingHint(isEmailAddress(email), age16Confirmed, attestationAccepted);
  const answers = { age16Confirmed, age18Confirmed, signUpAttestationAccepted: attestationAccepted };

  useEffect(() => setOffline(false), [linkAttempt]);
  useEffect(() => setFormError(null), [linkAttempt]);
  useEffect(() => setSocialError(null), [linkAttempt]);

  const startAction = () => {
    onClearLinkError?.();
    onClearAccountNotice?.();
    setFormError(null);
    setSocialError(null);
    setNotice(null);
  };

  const showFailure = (result: Extract<ActionResult, { ok: false }>, showOther: (message: string | null) => void = setFormError) => {
    if (result.reason === "ageRequired") {
      setAgeError(result.message);
    } else if (result.reason === "attestationRequired") {
      setAttestationError(result.message);
    } else if (result.reason === "invalidEmail") {
      setEmailError(result.message);
    } else if (result.reason === "network") {
      setOffline(true);
    } else {
      showOther(result.message);
    }
  };

  const validate = (): boolean => {
    const emailValid = isEmailAddress(email);
    setEmailError(emailValid ? null : FAILURE_MESSAGES.invalidEmail);
    setAnnounceAgeError(emailValid || emailError !== null);
    setAgeError(age16Confirmed ? null : TICK_AGE_BOX_MESSAGE);
    setAttestationError(attestationAccepted ? null : SIGN_UP_ATTESTATION_REFUSAL_MESSAGE);
    return emailValid && age16Confirmed && attestationAccepted;
  };

  const send = async (kind: "code" | "link") => {
    startAction();
    onClearServerUnreachable?.();
    setOffline(false);
    if (sending !== null || !validate()) {
      return;
    }
    setSending(kind);
    const result = await (kind === "code" ? sendEmailCode : sendMagicLink)(client, { email, ...answers });
    setSending(null);
    if (!result.ok) {
      showFailure(result);
    } else if (kind === "code") {
      onCodeSent(email.trim(), age18Confirmed);
    } else if (linkSentTo === null) {
      setLinkSentTo(email.trim());
      linkCooldown.restart();
    } else {
      setNotice(`We sent a new link to ${email.trim()}.`);
      linkCooldown.restart();
    }
  };

  const signInWithSocial = async (provider: SocialProvider) => {
    startAction();
    onClearServerUnreachable?.();
    setOffline(false);
    setEmailError(null);
    if (sending !== null || !socialSignIn) {
      return;
    }
    if (!age16Confirmed) {
      setAnnounceAgeError(true);
      setAgeError(TICK_AGE_BOX_MESSAGE);
      return;
    }
    setAgeError(null);
    if (!attestationAccepted) {
      setAttestationError(SIGN_UP_ATTESTATION_REFUSAL_MESSAGE);
      return;
    }
    setSending(provider);
    setSocialProgress("opening");
    const result = await signInWithProvider({ ...socialSignIn, onReturned: () => setSocialProgress("signingIn") }, provider, answers);
    setSending(null);
    if (result.ok) {
      onSignedIn?.();
    } else {
      showFailure({ ...result, message: socialFailureMessage(provider, result) }, setSocialError);
    }
  };

  if (linkSentTo !== null) {
    return (
      <LinkSentScreen
        email={linkSentTo}
        notice={notice}
        linkError={linkError}
        linkErrorReason={linkErrorReason}
        offline={serverUnreachable || (offline && !linkError)}
        formError={linkError ? null : formError}
        cooldownSecondsLeft={linkCooldown.secondsLeft}
        sending={sending === "link"}
        canUseDifferentEmail={sending === null}
        onResend={() => void send("link")}
        onUseDifferentEmail={() => {
          startAction();
          setOffline(false);
          setLinkSentTo(null);
        }}
      />
    );
  }

  return (
    <AuthScreenLayout>
      <SignInHeader linkError={linkError} linkErrorReason={linkErrorReason} accountNotice={accountNotice} />
      <TextField
        label="Email"
        focusKey={startup.focusEmailKey}
        error={emailError}
        {...EMAIL_INPUT_PROPS}
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          setEmailError(null);
          onClearLinkError?.();
          onClearAccountNotice?.();
        }}
        onBlur={() => {
          if (email.trim() !== "" && !isEmailAddress(email)) {
            setEmailError(FAILURE_MESSAGES.invalidEmail);
          }
        }}
        onSubmitEditing={() => void send("code")}
      />
      <ServerUnreachableNote visible={serverUnreachable || offline} startupRetry={serverUnreachable ? startup.startupRetry : undefined} />
      <AgeConfirmationFields
        age16Confirmed={age16Confirmed}
        age18Confirmed={age18Confirmed}
        ageError={ageError}
        announceAgeError={announceAgeError}
        onPress16={() => {
          startAction();
          if (age16Confirmed) {
            setAge18Confirmed(false);
          }
          setAge16Confirmed(!age16Confirmed);
          setAgeError(null);
        }}
        onPress18={() => {
          startAction();
          setAge18Confirmed(!age18Confirmed);
        }}
      />
      <SignUpAttestationFields
        accepted={attestationAccepted}
        error={attestationError}
        announceError={isEmailAddress(email) && age16Confirmed}
        onPress={() => {
          startAction();
          setAttestationAccepted(!attestationAccepted);
          setAttestationError(null);
        }}
      />
      <StatusText message={linkError ? null : formError} style={authStyles.fieldError} />
      <View style={authStyles.actions}>
        <EmailSendButtons ready={ready} hint={sendHint} sending={sending} onSend={(kind) => void send(kind)} />
        {socialSignIn ? (
          <SocialSignInButtons
            providers={socialProviders}
            age16Confirmed={age16Confirmed}
            attestationAccepted={attestationAccepted}
            sending={sending}
            progress={socialProgress}
            error={linkError ? null : socialError}
            onPress={(provider) => void signInWithSocial(provider)}
          />
        ) : null}
      </View>
    </AuthScreenLayout>
  );
}
