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
import { TextField } from "./TextField";
import { authStyles } from "./authStyles";
import { RESEND_COOLDOWN_SECONDS, useCountdown } from "./useCountdown";

export const TICK_AGE_BOX_MESSAGE = "Tick the box to confirm you are 16 or older.";
export { SERVER_UNREACHABLE_NOTE } from "./ServerUnreachableNote";

export interface EmailEntryScreenProps extends StartupRetryProps {
  readonly client: MobileAuthClient;
  readonly onCodeSent: (email: string, age18Confirmed: boolean) => void;
  /** Error from a failed sign-in link, shown as a card above the title until the next action. */
  readonly linkError?: string | null;
  /** Why the link failed; see LinkErrorCard. */
  readonly linkErrorReason?: LinkErrorCardProps["reason"];
  readonly onClearLinkError?: () => void;
  /** One-time neutral notice, e.g. after the account was deleted; cleared by the next input or action. */
  readonly accountNotice?: string | null;
  readonly onClearAccountNotice?: () => void;
  /** The backend could not be reached (startup or sign-in link); shows a muted note under the email field. */
  readonly serverUnreachable?: boolean;
  readonly onClearServerUnreachable?: () => void;
  /** Changes when an opened sign-in link failed: a new attempt, so this screen's own note and red error go (HEN-304). */
  readonly linkAttempt?: number;
  /** Apple and Google buttons to show (HEN-239); none without `socialSignIn`. */
  readonly socialProviders?: readonly SocialProvider[];
  readonly socialSignIn?: SocialSignInDependencies;
  /** A social sign-in finished with a session. */
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
  // HEN-183: the sign-up duties box; every send carries the current text version id once it is ticked.
  const [attestationAccepted, setAttestationAccepted] = useState(false);
  const [attestationError, setAttestationError] = useState<string | null>(null);
  const [sending, setSending] = useState<Sending>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [ageError, setAgeError] = useState<string | null>(null);
  // False only when this submit also brought up a new email error, which is then the one announced (Vera items 8 and delta 6).
  const [announceAgeError, setAnnounceAgeError] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);
  // This screen's own send failed on the network; App's serverUnreachable covers startup and links.
  const [offline, setOffline] = useState(false);
  const [socialProgress, setSocialProgress] = useState<"opening" | "signingIn">("opening");
  const [socialError, setSocialError] = useState<string | null>(null);
  const linkCooldown = useCountdown(RESEND_COOLDOWN_SECONDS);
  const ready = age16Confirmed && attestationAccepted && isEmailAddress(email);
  const sendHint = missingHint(isEmailAddress(email), age16Confirmed, attestationAccepted);
  const answers = { age16Confirmed, age18Confirmed, signUpAttestationAccepted: attestationAccepted };

  // A failed sign-in link is a new attempt: this screen's own offline note and red error from the last one go (HEN-304).
  useEffect(() => setOffline(false), [linkAttempt]);
  useEffect(() => setFormError(null), [linkAttempt]);

  const startAction = () => {
    onClearLinkError?.();
    onClearAccountNotice?.();
    setFormError(null);
    setSocialError(null);
    setNotice(null);
  };

  /** Age, email and offline failures go to their own slots; anything else goes to `showOther` (the form error by default). */
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

  /** Checks the form like a user expects: every missing piece gets its own message, and nothing is sent. */
  const validate = (): boolean => {
    const emailValid = isEmailAddress(email);
    setEmailError(emailValid ? null : FAILURE_MESSAGES.invalidEmail);
    // An email error already showing from blur is not read again, so the age error must be heard instead.
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

  /** Social sign-in needs the 16+ and duties boxes, not the email (the provider gives it), and sends the answers like the email buttons. */
  const signInWithSocial = async (provider: SocialProvider) => {
    startAction();
    // A new attempt: an offline note from an earlier one must not sit next to this one's result (HEN-287, Vera interim item 4).
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
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        inputMode="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        placeholder="you@example.com"
        returnKeyType="go"
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
          // Unticking 16+ also unticks 18+; ticking 18+ never ticks 16+ for the user (Vera item 2).
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
        // Announced only when it is the one thing missing; the email or 16+ error is read first otherwise.
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
            error={socialError}
            onPress={(provider) => void signInWithSocial(provider)}
          />
        ) : null}
      </View>
    </AuthScreenLayout>
  );
}
