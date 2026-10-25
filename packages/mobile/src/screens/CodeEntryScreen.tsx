import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import type { MobileAuthClient } from "../auth/authClient";
import { verifyEmailCode } from "../auth/signInActions";
import { textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { authStyles } from "./authStyles";

export interface CodeEntryScreenProps {
  readonly client: MobileAuthClient;
  readonly email: string;
  readonly onSignedIn: () => void;
  readonly onBack: () => void;
}

export function CodeEntryScreen({ client, email, onSignedIn, onBack }: CodeEntryScreenProps) {
  const [code, setCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const verify = async () => {
    setIsVerifying(true);
    setMessage(null);
    // The user ticked the 17+ box on the email screen; it is required to get here.
    const result = await verifyEmailCode(client, { email, code, ageConfirmed: true });
    setIsVerifying(false);
    if (result.ok) {
      onSignedIn();
    } else {
      setMessage(result.message);
    }
  };

  return (
    <View style={authStyles.screen}>
      <Text style={textStyles.title}>Enter your code</Text>
      <Text style={textStyles.body}>We emailed a 6-digit code to {email}.</Text>
      <TextInput
        accessibilityLabel="6-digit code"
        autoComplete="one-time-code"
        inputMode="numeric"
        maxLength={6}
        style={authStyles.input}
        value={code}
        onChangeText={setCode}
      />
      {message ? <Text style={authStyles.error}>{message}</Text> : null}
      <AuthButton title="Sign in" disabled={code.trim().length !== 6 || isVerifying} onPress={() => void verify()} />
      <AuthButton title="Use a different email" variant="link" onPress={onBack} />
    </View>
  );
}
