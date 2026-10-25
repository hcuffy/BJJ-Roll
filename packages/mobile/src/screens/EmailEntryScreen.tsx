import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { AGE_CONFIRMATION_LABEL, canContinue } from "../auth/ageConfirmation";
import type { MobileAuthClient } from "../auth/authClient";
import { sendEmailCode, sendMagicLink, type ActionResult } from "../auth/signInActions";
import { textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { authStyles } from "./authStyles";

export interface EmailEntryScreenProps {
  readonly client: MobileAuthClient;
  readonly onCodeSent: (email: string) => void;
}

export function EmailEntryScreen({ client, onCodeSent }: EmailEntryScreenProps) {
  const [email, setEmail] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const continueEnabled = canContinue({ email, ageConfirmed }) && !isSending;

  const send = async (action: typeof sendEmailCode, onSuccess: () => void) => {
    setIsSending(true);
    setMessage(null);
    const result: ActionResult = await action(client, { email, ageConfirmed });
    setIsSending(false);
    if (result.ok) {
      onSuccess();
    } else {
      setMessage(result.message);
    }
  };

  return (
    <View style={authStyles.screen}>
      <Text style={textStyles.title}>Sign in to BJJ Roll</Text>
      <TextInput
        accessibilityLabel="Email"
        autoCapitalize="none"
        autoComplete="email"
        inputMode="email"
        placeholder="you@example.com"
        style={authStyles.input}
        value={email}
        onChangeText={setEmail}
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: ageConfirmed }}
        style={authStyles.checkboxRow}
        onPress={() => setAgeConfirmed(!ageConfirmed)}>
        <View style={[authStyles.checkbox, ageConfirmed && authStyles.checkboxTicked]}>
          {ageConfirmed ? <Text style={authStyles.checkmark}>✓</Text> : null}
        </View>
        <Text style={textStyles.body}>{AGE_CONFIRMATION_LABEL}</Text>
      </Pressable>
      {message ? <Text style={authStyles.error}>{message}</Text> : null}
      <AuthButton title="Continue" disabled={!continueEnabled} onPress={() => void send(sendEmailCode, () => onCodeSent(email.trim()))} />
      <AuthButton
        title="Email me a sign-in link instead"
        variant="link"
        disabled={!continueEnabled}
        onPress={() => void send(sendMagicLink, () => setMessage("Check your email and open the link on this phone."))}
      />
    </View>
  );
}
