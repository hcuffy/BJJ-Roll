import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { AGE_CONFIRMATION_LABEL, isEmailAddress } from "../auth/ageConfirmation";
import type { MobileAuthClient } from "../auth/authClient";
import { FAILURE_MESSAGES, MAGIC_LINK_EXPIRY_MINUTES, sendEmailCode, sendMagicLink, type ActionResult } from "../auth/signInActions";
import { textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { AuthScreenLayout } from "./AuthScreenLayout";
import { ServerUnreachableNote } from "./ServerUnreachableNote";
import { StatusText } from "./StatusText";
import { TextField } from "./TextField";
import { authStyles } from "./authStyles";
import { formatCountdown, RESEND_COOLDOWN_SECONDS, useCountdown } from "./useCountdown";

export const TICK_AGE_BOX_MESSAGE = "Tick the box to confirm you are 17 or older.";
export { SERVER_UNREACHABLE_NOTE } from "./ServerUnreachableNote";

export interface EmailEntryScreenProps {
  readonly client: MobileAuthClient;
  readonly onCodeSent: (email: string) => void;
  /** Error from a failed sign-in link, shown as a card above the title until the next action. */
  readonly linkError?: string | null;
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
function missingHint(emailValid: boolean, ageConfirmed: boolean): string | undefined {
  if (!emailValid && !ageConfirmed) {
    return "Enter your email and tick the 17 or older box first.";
  }
  if (!emailValid) {
    return "Enter your email first.";
  }
  return ageConfirmed ? undefined : "Tick the 17 or older box first.";
}

export function EmailEntryScreen({
  client,
  onCodeSent,
  linkError = null,
  onClearLinkError,
  accountNotice = null,
  onClearAccountNotice,
  serverUnreachable = false,
  onClearServerUnreachable,
}: EmailEntryScreenProps) {
  const [email, setEmail] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [sending, setSending] = useState<Sending>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [ageError, setAgeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);
  // This screen's own send failed on the network; App's serverUnreachable covers startup and links.
  const [offline, setOffline] = useState(false);
  const linkCooldown = useCountdown(RESEND_COOLDOWN_SECONDS);
  const ready = ageConfirmed && isEmailAddress(email);
  const sendHint = missingHint(isEmailAddress(email), ageConfirmed);

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
    } else if (result.reason === "network") {
      setOffline(true);
    } else {
      setFormError(result.message);
    }
  };

  /** Checks the form like a user expects: every missing piece gets its own message, and nothing is sent. */
  const validate = (): boolean => {
    const emailValid = isEmailAddress(email);
    setEmailError(emailValid ? null : FAILURE_MESSAGES.invalidEmail);
    setAgeError(ageConfirmed ? null : TICK_AGE_BOX_MESSAGE);
    return emailValid && ageConfirmed;
  };

  const send = async (kind: "code" | "link") => {
    startAction();
    onClearServerUnreachable?.();
    setOffline(false);
    if (sending !== null || !validate()) {
      return;
    }
    setSending(kind);
    const action = kind === "code" ? sendEmailCode : sendMagicLink;
    const result = await action(client, { email, ageConfirmed });
    setSending(null);
    if (!result.ok) {
      showFailure(result);
    } else if (kind === "code") {
      onCodeSent(email.trim());
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
        <ServerUnreachableNote visible={serverUnreachable || offline} />
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
              setOffline(false);
              setLinkSentTo(null);
            }}
          />
        </View>
      </AuthScreenLayout>
    );
  }

  return (
    <AuthScreenLayout>
      {linkError ? (
        <View style={[authStyles.card, authStyles.errorCard]}>
          <StatusText message={linkError} style={authStyles.cardError} />
        </View>
      ) : null}
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
      <ServerUnreachableNote visible={serverUnreachable || offline} />
      <View>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={AGE_CONFIRMATION_LABEL}
          accessibilityState={{ checked: ageConfirmed }}
          accessibilityHint={ageError ?? undefined}
          style={authStyles.checkboxRow}
          onPress={() => {
            startAction();
            setAgeConfirmed(!ageConfirmed);
            setAgeError(null);
          }}>
          <View style={[authStyles.checkbox, ageConfirmed && authStyles.checkboxTicked]}>
            {ageConfirmed ? (
              <Text style={authStyles.checkmark} accessibilityElementsHidden importantForAccessibility="no">
                ✓
              </Text>
            ) : null}
          </View>
          <Text style={authStyles.checkboxLabel}>{AGE_CONFIRMATION_LABEL}</Text>
        </Pressable>
        <StatusText message={ageError} style={authStyles.fieldError} />
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
