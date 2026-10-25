import * as Linking from "expo-linking";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { appAuthClient } from "./auth/appAuthClient";
import { completeMagicLink, readSignedInUserId, signOut } from "./auth/signInActions";
import { CodeEntryScreen } from "./screens/CodeEntryScreen";
import { EmailEntryScreen } from "./screens/EmailEntryScreen";
import { SignedInScreen } from "./screens/SignedInScreen";
import { authStyles } from "./screens/authStyles";

type AuthScreen =
  { readonly name: "loading" } | { readonly name: "email" } | { readonly name: "code"; readonly email: string } | { readonly name: "signedIn" };

export function App() {
  const [screen, setScreen] = useState<AuthScreen>({ name: "loading" });
  const [linkMessage, setLinkMessage] = useState<string | null>(null);
  const deepLinkUrl = Linking.useURL();

  useEffect(() => {
    void readSignedInUserId(appAuthClient).then((userId) => setScreen(userId ? { name: "signedIn" } : { name: "email" }));
  }, []);

  useEffect(() => {
    if (!deepLinkUrl) {
      return;
    }
    void completeMagicLink(appAuthClient, deepLinkUrl).then((result) => {
      if (result.ok) {
        setScreen({ name: "signedIn" });
      } else if (result.message) {
        setLinkMessage(result.message);
      }
    });
  }, [deepLinkUrl]);

  const handleSignOut = () => {
    void signOut(appAuthClient).finally(() => setScreen({ name: "email" }));
  };

  switch (screen.name) {
    case "loading": {
      return (
        <View style={authStyles.screen}>
          <ActivityIndicator />
        </View>
      );
    }
    case "signedIn": {
      return <SignedInScreen onSignOut={handleSignOut} />;
    }
    case "code": {
      return (
        <CodeEntryScreen
          client={appAuthClient}
          email={screen.email}
          onSignedIn={() => setScreen({ name: "signedIn" })}
          onBack={() => setScreen({ name: "email" })}
        />
      );
    }
    case "email": {
      return (
        <View style={{ flex: 1 }}>
          {linkMessage ? <Text style={authStyles.error}>{linkMessage}</Text> : null}
          <EmailEntryScreen client={appAuthClient} onCodeSent={(email) => setScreen({ name: "code", email })} />
        </View>
      );
    }
  }
}
