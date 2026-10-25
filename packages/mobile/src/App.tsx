import * as Linking from "expo-linking";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, StatusBar, Text, View } from "react-native";
import { appAuthClient, appSecureStore } from "./auth/appAuthClient";
import { completeMagicLink, readSignedInUserId, signOut } from "./auth/signInActions";
import { CodeEntryScreen } from "./screens/CodeEntryScreen";
import { EmailEntryScreen } from "./screens/EmailEntryScreen";
import { SignedInScreen } from "./screens/SignedInScreen";
import { authStyles } from "./screens/authStyles";
import { colours, textStyles } from "./theme/tokens";

type AuthScreen =
  { readonly name: "loading" } | { readonly name: "email" } | { readonly name: "code"; readonly email: string } | { readonly name: "signedIn" };

export function App() {
  const [screen, setScreen] = useState<AuthScreen>({ name: "loading" });
  const [linkError, setLinkError] = useState<string | null>(null);
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
        setLinkError(null);
        setScreen({ name: "signedIn" });
      } else if (result.message) {
        setLinkError(result.message);
      }
    });
  }, [deepLinkUrl]);

  const handleSignOut = () => {
    void signOut(appAuthClient, appSecureStore).finally(() => setScreen({ name: "email" }));
  };

  return (
    <>
      {/* Dark app: light status bar icons on the background colour. */}
      <StatusBar barStyle="light-content" backgroundColor={colours.background} />
      {renderScreen()}
    </>
  );

  function renderScreen(): ReactNode {
    switch (screen.name) {
      case "loading": {
        return (
          <View style={authStyles.centred}>
            <ActivityIndicator size="large" color={colours.primary} accessibilityLabel="Loading" />
            <Text style={textStyles.bodyMuted}>Loading</Text>
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
          <EmailEntryScreen
            client={appAuthClient}
            linkError={linkError}
            onClearLinkError={() => setLinkError(null)}
            onCodeSent={(email) => setScreen({ name: "code", email })}
          />
        );
      }
    }
  }
}
