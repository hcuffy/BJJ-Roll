import * as Linking from "expo-linking";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, StatusBar, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  confirmAdult,
  deleteAccount,
  exportAccountData,
  readAgeConfirmation,
  requestAccountDeletionCode,
  type AccountSession,
} from "./auth/accountActions";
import { appAuthClient, appBackendUrl, appSecureStore } from "./auth/appAuthClient";
import { completeMagicLink, type FailureReason, readSignedInUserId, signOut } from "./auth/signInActions";
import { CodeEntryScreen } from "./screens/CodeEntryScreen";
import { EmailEntryScreen } from "./screens/EmailEntryScreen";
import { SignedInScreen } from "./screens/SignedInScreen";
import { authStyles } from "./screens/authStyles";
import { colours, textStyles } from "./theme/tokens";

type AuthScreen =
  | { readonly name: "loading" }
  | { readonly name: "email" }
  | { readonly name: "code"; readonly email: string; readonly age18Confirmed: boolean }
  | { readonly name: "signedIn" };

export function App() {
  const [screen, setScreen] = useState<AuthScreen>({ name: "loading" });
  // The reason travels with the message so the card can key extra guidance on it, not on the copy (Vera round 4 item 4).
  const [linkError, setLinkError] = useState<{ readonly message: string; readonly reason: FailureReason } | null>(null);
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
        setLinkError({ message: result.message, reason: result.reason });
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
            onRequestDeleteCode={() => requestAccountDeletionCode(accountSession())}
            onDeleteAccount={(code) => deleteAccount(accountSession(), code)}
            onReadAgeConfirmation={() => readAgeConfirmation(accountSession())}
            onConfirmAdult={() => confirmAdult(accountSession())}
            onAccountDeleted={() => {
              setAccountNotice("Your account was deleted. If you sign up again, you get a new, empty account.");
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
            age18Confirmed={screen.age18Confirmed}
            onSignedIn={() => setScreen({ name: "signedIn" })}
            onBack={() => setScreen({ name: "email" })}
          />
        );
      }
      case "email": {
        return (
          <EmailEntryScreen
            client={appAuthClient}
            linkError={linkError?.message ?? null}
            linkErrorReason={linkError?.reason ?? null}
            onClearLinkError={() => setLinkError(null)}
            accountNotice={accountNotice}
            onClearAccountNotice={() => setAccountNotice(null)}
            onCodeSent={(email, age18Confirmed) => setScreen({ name: "code", email, age18Confirmed })}
          />
        );
      }
    }
  }
}
