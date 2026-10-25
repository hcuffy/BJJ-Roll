import * as Linking from "expo-linking";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, StatusBar, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { deleteAccount, exportAccountData, type AccountSession } from "./auth/accountActions";
import { appAuthClient, appBackendUrl, appSecureStore } from "./auth/appAuthClient";
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
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
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

  const accountSession = (): AccountSession => ({ client: appAuthClient, secureStore: appSecureStore, backendUrl: appBackendUrl });

  const handleSignOut = () => {
    void signOut(appAuthClient, appSecureStore).finally(() => setScreen({ name: "email" }));
  };

  return (
    // One provider at the root measures the real insets (status bar, notch, home indicator) on iOS and Android.
    <SafeAreaProvider>
      {/* Dark app: light status bar icons on the background colour. */}
      <StatusBar barStyle="light-content" backgroundColor={colours.background} />
      {renderScreen()}
    </SafeAreaProvider>
  );

  function renderScreen(): ReactNode {
    switch (screen.name) {
      case "loading": {
        return (
          <SafeAreaView style={authStyles.safeArea}>
            <View style={authStyles.centred}>
              {/* Muted spinner (lime is for the primary action); the visible word is the one thing screen readers read. */}
              <ActivityIndicator size="large" color={colours.textSecondary} accessibilityElementsHidden importantForAccessibility="no" />
              <Text style={textStyles.bodyMuted}>Loading</Text>
            </View>
          </SafeAreaView>
        );
      }
      case "signedIn": {
        return (
          <SignedInScreen
            onSignOut={handleSignOut}
            onExportData={() => exportAccountData(accountSession())}
            onDeleteAccount={() => deleteAccount(accountSession())}
            onAccountDeleted={() => {
              setAccountNotice("Your account was deleted.");
              setScreen({ name: "email" });
            }}
          />
        );
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
            accountNotice={accountNotice}
            onClearAccountNotice={() => setAccountNotice(null)}
            onCodeSent={(email) => setScreen({ name: "code", email })}
          />
        );
      }
    }
  }
}
