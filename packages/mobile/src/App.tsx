import * as Linking from "expo-linking";
import { useEffect, useState, type ReactNode } from "react";
import { StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  acceptSignUpAttestation,
  confirmAdult,
  deleteAccount,
  exportAccountData,
  readAgeConfirmation,
  readSignUpAttestation,
  requestAccountDeletionCode,
  type AccountSession,
} from "./auth/accountActions";
import { appAuthClient, appBackendUrl, appSecureStore } from "./auth/appAuthClient";
import { appSocialProviders, appSocialSignIn } from "./auth/appSocialSignIn";
import { cancelPendingSignOut, completeMagicLink, type FailureReason, finishPendingSignOut, readSignedInUserId, signOut } from "./auth/signInActions";
import { CodeEntryScreen } from "./screens/CodeEntryScreen";
import { EmailEntryScreen } from "./screens/EmailEntryScreen";
import { LoadingScreen } from "./screens/LoadingScreen";
import { SignUpAttestationGate } from "./screens/SignUpAttestationGate";
import { SignedInScreen } from "./screens/SignedInScreen";
import { colours } from "./theme/tokens";

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
  const [serverUnreachable, setServerUnreachable] = useState(false);
  // Where startup lands (null while it runs); a link that started the app keeps Loading until its exchange settles.
  const [startupScreen, setStartupScreen] = useState<AuthScreen | null>(null);
  const deepLinkUrl = Linking.useURL();

  // Signing in proves the server is reachable, so a note set earlier must not reappear later.
  useEffect(() => {
    if (screen.name === "signedIn") {
      setServerUnreachable(false);
    }
  }, [screen.name]);

  useEffect(() => {
    // A sign-out that failed last time is finished first; the user stays signed out on this launch either way.
    void finishPendingSignOut(appAuthClient, appSecureStore)
      .then(async (signOutPending) => (signOutPending ? null : await readSignedInUserId(appAuthClient)))
      .then((userId) => setStartupScreen(userId ? { name: "signedIn" } : { name: "email" }))
      .catch(() => {
        // Backend unreachable: show sign-in with a note instead of loading forever; the next submit is the retry.
        setServerUnreachable(true);
        setStartupScreen({ name: "email" });
      });
  }, []);

  // A link that started the app waits for the startup step, so a pending sign-out cannot end the session the link creates.
  useEffect(() => {
    if (!startupScreen) {
      return;
    }
    // Leaves Loading only once; a link opened later in the running app does not move the user.
    const showStartupScreen = () => setScreen((current) => (current.name === "loading" ? startupScreen : current));
    if (!deepLinkUrl) {
      showStartupScreen();
      return;
    }
    void completeMagicLink(appAuthClient, deepLinkUrl)
      .then((result) => {
        if (result.ok) {
          setLinkError(null);
          handleSignedIn();
          return;
        }
        if (result.reason === "network") {
          setServerUnreachable(true);
        } else if (result.message) {
          setLinkError({ message: result.message, reason: result.reason });
        }
        showStartupScreen();
      })
      .catch(() => {
        setServerUnreachable(true);
        showStartupScreen();
      });
  }, [deepLinkUrl, startupScreen]);

  const accountSession = (): AccountSession => ({ client: appAuthClient, secureStore: appSecureStore, backendUrl: appBackendUrl });

  const handleSignedIn = () => {
    // A new sign-in cancels a sign-out left to finish; if that fails the user still gets in.
    void cancelPendingSignOut(appSecureStore);
    setScreen({ name: "signedIn" });
  };

  const handleSignOut = () => {
    // A note from a link that failed while signed in is stale on the sign-in screen.
    setServerUnreachable(false);
    // signOut clears the local session when the server is down and finishes a failed one on the next launch.
    void signOut(appAuthClient, appSecureStore)
      .catch(() => undefined)
      .finally(() => setScreen({ name: "email" }));
  };

  const handleAccountDeleted = () => {
    // A note from a link that failed while signed in must not sit next to the deleted card.
    setServerUnreachable(false);
    setAccountNotice("Your account was deleted. If you sign up again, you get a new, empty account.");
    setScreen({ name: "email" });
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
        return <LoadingScreen />;
      }
      case "signedIn": {
        // HEN-183: an account without the current sign-up attestation stays on the prompt until it accepts.
        return (
          <SignUpAttestationGate
            onReadStatus={() => readSignUpAttestation(accountSession())}
            onAccept={() => acceptSignUpAttestation(accountSession())}
            onSignOut={handleSignOut}
            onRequestDeleteCode={() => requestAccountDeletionCode(accountSession())}
            onDeleteAccount={(code) => deleteAccount(accountSession(), code)}
            onAccountDeleted={handleAccountDeleted}>
            <SignedInScreen
              onSignOut={handleSignOut}
              onExportData={() => exportAccountData(accountSession())}
              onRequestDeleteCode={() => requestAccountDeletionCode(accountSession())}
              onDeleteAccount={(code) => deleteAccount(accountSession(), code)}
              onReadAgeConfirmation={() => readAgeConfirmation(accountSession())}
              onConfirmAdult={() => confirmAdult(accountSession())}
              onAccountDeleted={handleAccountDeleted}
            />
          </SignUpAttestationGate>
        );
      }
      case "code": {
        return (
          <CodeEntryScreen
            client={appAuthClient}
            email={screen.email}
            age18Confirmed={screen.age18Confirmed}
            onSignedIn={handleSignedIn}
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
            serverUnreachable={serverUnreachable}
            onClearServerUnreachable={() => setServerUnreachable(false)}
            onCodeSent={(email, age18Confirmed) => setScreen({ name: "code", email, age18Confirmed })}
            socialProviders={appSocialProviders}
            socialSignIn={appSocialSignIn}
            onSignedIn={handleSignedIn}
          />
        );
      }
    }
  }
}
