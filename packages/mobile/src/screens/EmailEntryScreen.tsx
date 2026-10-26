import { useState } from "react";
import { Text, View } from "react-native";
import {
  AGE_ADULT_CONFIRMATION_LABEL,
  AGE_ADULT_CONFIRMATION_NOTE,
  AGE_ADULT_NEEDS_16_HINT,
  AGE_CONFIRMATION_LABEL,
  isEmailAddress,
} from "../auth/ageConfirmation";
import type { MobileAuthClient } from "../auth/authClient";
import { FAILURE_MESSAGES, MAGIC_LINK_EXPIRY_MINUTES, sendEmailCode, sendMagicLink, type ActionResult } from "../auth/signInActions";
import { textStyles } from "../theme/tokens";
import { AgeCheckbox } from "./AgeCheckbox";
import { AuthButton } from "./AuthButton";
import { AuthScreenLayout } from "./AuthScreenLayout";
import { type LinkErrorCardProps, LinkErrorCard } from "./LinkErrorCard";
import { StatusText } from "./StatusText";
import { TextField } from "./TextField";
import { authStyles } from "./authStyles";
import { formatCountdown, RESEND_COOLDOWN_SECONDS, useCountdown } from "./useCountdown";

export const TICK_AGE_BOX_MESSAGE = "Tick the box to confirm you are 16 or older.";
/** Calm note when the backend could not be reached (copy per Vera, HEN-285). Cleared by the next submit attempt. */
export const SERVER_UNREACHABLE_NOTE = "Can't reach the server right now. Check your connection and try again.";

export interface EmailEntryScreenProps {
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
}

type Sending = "code" | "link" | null;

/** Screen-reader hint for the dimmed send buttons: names only what is still missing. */
function missingHint(emailValid: boolean, age16Confirmed: boolean): string | undefined {
  if (!emailValid && !age16Confirmed) {
    return "Enter your email and tick the 16 or older box first.";
  }
  if (!emailValid) {
    return "Enter your email first.";
  }
  return age16Confirmed ? undefined : "Tick the 16 or older box first.";
}

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
}: EmailEntryScreenProps) {
  const [email, setEmail] = useState("");
  const [age16Confirmed, setAge16Confirmed] = useState(false);
  const [age18Confirmed, setAge18Confirmed] = useState(false);
  const [sending, setSending] = useState<Sending>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [ageError, setAgeError] = useState<string | null>(null);
  // False only when this submit also brought up a new email error, which is then the one announced (Vera items 8 and delta 6).
  const [announceAgeError, setAnnounceAgeError] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);
  const linkCooldown = useCountdown(RESEND_COOLDOWN_SECONDS);
  const ready = age16Confirmed && isEmailAddress(email);
  const sendHint = missingHint(isEmailAddress(email), age16Confirmed);

  const startAction = () => {
    onClearLinkError?.();
    onClearAccountNotice?.();
    setFormError(null);
    setNotice(null);
  };

  const showFailure = (result: Extract<ActionResult, { ok: false }>) => {
    if (result.reason === "ageRequired") {
      setAgeError(result.message);
    } else if (result.reason === "invalidEmail") {
      setEmailError(result.message);
    } else {
      setFormError(result.message);
    }
  };

  /** Checks the form like a user expects: every missing piece gets its own message, and nothing is sent. */
  const validate = (): boolean => {
    const emailValid = isEmailAddress(email);
    setEmailError(emailValid ? null : FAILURE_MESSAGES.invalidEmail);
    // An email error already showing from blur is not read again, so the age error must be heard instead.
    setAnnounceAgeError(emailValid || emailError !== null);
    setAgeError(age16Confirmed ? null : TICK_AGE_BOX_MESSAGE);
    return emailValid && age16Confirmed;
  };

  const send = async (kind: "code" | "link") => {
    startAction();
    onClearServerUnreachable?.();
    if (sending !== null || !validate()) {
      return;
    }
    setSending(kind);
    const action = kind === "code" ? sendEmailCode : sendMagicLink;
    const result = await action(client, { email, age16Confirmed, age18Confirmed });
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

  if (linkSentTo !== null) {
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
            <StatusText message={`We sent a sign-in link to ${linkSentTo}. Open it on this phone.`} style={authStyles.notice} />
            <Text style={textStyles.bodyMuted}>Link expires in {MAGIC_LINK_EXPIRY_MINUTES} minutes.</Text>
            <StatusText message={notice} style={textStyles.bodyMuted} />
          </View>
        </View>
        <StatusText message={formError} style={authStyles.fieldError} />
        <View style={authStyles.actions}>
          <AuthButton
            title={linkCooldown.secondsLeft > 0 && sending !== "link" ? `Resend in ${formatCountdown(linkCooldown.secondsLeft)}` : "Resend link"}
            variant="secondary"
            disabled={linkCooldown.secondsLeft > 0}
            loading={sending === "link"}
            loadingTitle="Sending link…"
            onPress={() => void send("link")}
          />
          <AuthButton
            title="Use a different email"
            variant="tertiary"
            disabled={sending !== null}
            onPress={() => {
              startAction();
              setLinkSentTo(null);
            }}
          />
        </View>
      </AuthScreenLayout>
    );
  }

  return (
    <AuthScreenLayout>
      {linkError ? <LinkErrorCard message={linkError} reason={linkErrorReason} /> : null}
      {accountNotice ? (
        <View style={authStyles.card}>
          <StatusText message={accountNotice} style={authStyles.notice} />
        </View>
      ) : null}
      <View style={authStyles.heading}>
        <Text accessibilityRole="header" style={textStyles.display}>
          Sign in to BJJ Roll
        </Text>
        <Text style={textStyles.bodyMuted}>New here? We&apos;ll create your account.</Text>
      </View>
      <TextField
        label="Email"
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
      <StatusText message={serverUnreachable ? SERVER_UNREACHABLE_NOTE : null} style={textStyles.bodyMuted} announce="polite" />
      <View style={authStyles.ageGroup}>
        <View>
          <AgeCheckbox
            label={AGE_CONFIRMATION_LABEL}
            checked={age16Confirmed}
            hint={ageError ?? undefined}
            onPress={() => {
              startAction();
              // Unticking 16+ also unticks 18+; ticking 18+ never ticks 16+ for the user (Vera item 2).
              if (age16Confirmed) {
                setAge18Confirmed(false);
              }
              setAge16Confirmed(!age16Confirmed);
              setAgeError(null);
            }}
          />
          {/* After an empty submit the new email error is read first; this one stays visible but is not announced over it. */}
          <StatusText message={ageError} style={authStyles.fieldError} announce={announceAgeError ? "alert" : "quiet"} />
        </View>
        <View style={authStyles.ageOptional}>
          <AgeCheckbox
            label={AGE_ADULT_CONFIRMATION_LABEL}
            checked={age18Confirmed}
            disabled={!age16Confirmed}
            hint={age16Confirmed ? undefined : AGE_ADULT_NEEDS_16_HINT}
            onPress={() => {
              startAction();
              setAge18Confirmed(!age18Confirmed);
            }}
          />
          <Text style={textStyles.bodyMuted}>{AGE_ADULT_CONFIRMATION_NOTE}</Text>
        </View>
      </View>
      <StatusText message={formError} style={authStyles.fieldError} />
      <View style={authStyles.actions}>
        <AuthButton
          title="Continue"
          looksDisabled={!ready}
          accessibilityHint={sendHint}
          loading={sending === "code"}
          loadingTitle="Sending code…"
          disabled={sending === "link"}
          onPress={() => void send("code")}
        />
        <AuthButton
          title="Email me a sign-in link instead"
          variant="secondary"
          looksDisabled={!ready}
          accessibilityHint={sendHint}
          loading={sending === "link"}
          loadingTitle="Sending link…"
          disabled={sending === "code"}
          onPress={() => void send("link")}
        />
      </View>
    </AuthScreenLayout>
  );
}
