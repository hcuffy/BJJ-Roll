import * as Linking from "expo-linking";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
  type AccountDeletionExit,
  type AccountSession,
  type SignUpAttestationResult,
} from "./auth/accountActions";
import { appAuthClient, appBackendUrl, appSecureStore } from "./auth/appAuthClient";
import { appSocialProviders, appSocialSignIn } from "./auth/appSocialSignIn";
import { type BiometricKind, changeBiometricUnlock, clearBiometricUnlock, readBiometricSetting, takeBiometricOffer } from "./auth/biometricUnlock";
import { exchangeMagicLink } from "./auth/magicLinkReturn";
import { failureMessages, type FailureReason } from "./auth/signInActions";
import { checkStartup, readBiometricLock } from "./auth/startupCheck";
import { createStartupBudget, type StartupBudget, withStartupTimeout } from "./auth/startupTimeout";
import { BiometricLockScreen } from "./screens/BiometricLockScreen";
import { BiometricOfferScreen } from "./screens/BiometricOfferScreen";
import { CodeEntryScreen } from "./screens/CodeEntryScreen";
import { EmailEntryScreen } from "./screens/EmailEntryScreen";
import { LoadingScreen } from "./screens/LoadingScreen";
import { SignUpAttestationGate } from "./screens/SignUpAttestationGate";
import { SignedInScreen } from "./screens/SignedInScreen";
import { colours } from "./theme/tokens";
import { useLeftoverRevoke } from "./useLeftoverRevoke";
import { useStartupRetry } from "./useStartupRetry";

type AuthScreen =
  | { readonly name: "loading" }
  | { readonly name: "email" }
  | { readonly name: "code"; readonly email: string; readonly age18Confirmed: boolean }
  | { readonly name: "biometricOffer"; readonly kind: BiometricKind }
  | { readonly name: "locked"; readonly kind: BiometricKind }
  | { readonly name: "signedIn" }
  | { readonly name: "signingOut" };

const signedInScreens = new Set<AuthScreen["name"]>(["signedIn", "signingOut", "biometricOffer", "locked"]);

const accountExitNotices: Record<AccountDeletionExit, string> = {
  deleted: "Your account was deleted. If you sign up again, you get a new, empty account.",
  signedOut: "You're signed out. We couldn't confirm the delete. If you sign in and your data is still there, delete it again under Account.",
};

export function App() {
  const [screen, setScreen] = useState<AuthScreen>({ name: "loading" });
  const [linkError, setLinkError] = useState<{ readonly message: string; readonly reason: FailureReason } | null>(null);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const [serverUnreachable, setServerUnreachable] = useState(false);
  const [linkAttempt, setLinkAttempt] = useState(0);
  const [startupScreen, setStartupScreen] = useState<AuthScreen | null>(null);
  const deepLinkUrl = Linking.useURL();
  const startupBudget = useRef<StartupBudget | null>(null);
  const { start: startLeftoverRevoke, signOut, signOutStarted } = useLeftoverRevoke();
  const runStartupCheck = () => {
    const budget = createStartupBudget();
    startupBudget.current = budget;
    return checkStartup(budget, startLeftoverRevoke);
  };
  const retry = useStartupRetry({ serverUnreachable, setServerUnreachable, runCheck: runStartupCheck, setScreen });

  useEffect(() => {
    if (screen.name === "signedIn") {
      setServerUnreachable(false);
    }
    if (screen.name === "locked" || screen.name === "biometricOffer") {
      startupBudget.current = null;
    }
  }, [screen.name]);

  useEffect(() => {
    void runStartupCheck()
      .then(setStartupScreen)
      .catch(() => {
        setServerUnreachable(true);
        retry.offerRetry();
        setStartupScreen({ name: "email" });
      });
  }, []);

  useEffect(() => {
    if (!startupScreen) {
      return;
    }
    const showStartupScreen = () => setScreen((current) => (current.name === "loading" ? startupScreen : current));
    if (!deepLinkUrl || signedInScreens.has(screen.name)) {
      showStartupScreen();
      return;
    }
    const openedInRunningApp = screen.name !== "loading";
    const signedOut = signOutStarted.current.signal;
    const exchange = (signal: AbortSignal) => exchangeMagicLink(appAuthClient, appSecureStore, { url: deepLinkUrl, signal, signedOut });
    const startupLink = !openedInRunningApp && startupBudget.current;
    void (startupLink ? startupLink.run(exchange) : withStartupTimeout(exchange))
      .then(async (result) => {
        if (result.ok) {
          setLinkError(null);
          const lock = await readBiometricLock();
          if (lock) {
            startLeftoverRevoke();
            setScreen(lock);
            return;
          }
          handleSignedIn(!openedInRunningApp);
          return;
        }
        if (result.reason !== "ignored") {
          setLinkAttempt((count) => count + 1);
          setLinkError(result.reason === "network" || !result.message ? null : { message: result.message, reason: result.reason });
          setServerUnreachable((current) => result.reason === "network" || (current && !openedInRunningApp));
        }
        showStartupScreen();
      })
      .catch(() => {
        setLinkAttempt((count) => count + 1);
        setLinkError(null);
        setServerUnreachable(true);
        showStartupScreen();
      });
  }, [deepLinkUrl, startupScreen]);

  const accountSession = (): AccountSession => ({ client: appAuthClient, secureStore: appSecureStore, backendUrl: appBackendUrl });

  const readGateStatus = (): Promise<SignUpAttestationResult> => {
    const budget = startupBudget.current ?? createStartupBudget();
    startupBudget.current = null;
    return budget
      .run((signal) => readSignUpAttestation(accountSession(), signal))
      .catch(() => ({ ok: false, reason: "network", message: failureMessages.network }));
  };

  const handleSignedIn = (atStartup = false) => {
    if (!atStartup) {
      startupBudget.current = null;
    }
    startLeftoverRevoke();
    void takeBiometricOffer(appSecureStore)
      .catch(() => null)
      .then((kind) => setScreen(kind ? { name: "biometricOffer", kind } : { name: "signedIn" }));
  };

  const handleSignOut = () => {
    void clearBiometricUnlock(appSecureStore).catch(() => undefined);
    setScreen({ name: "signingOut" });
    setServerUnreachable(false);
    void signOut()
      .catch(() => undefined)
      .finally(() => setScreen({ name: "email" }));
  };

  const handleAccountDeleted = (exit: AccountDeletionExit) => {
    setAccountNotice(accountExitNotices[exit]);
    if (exit === "signedOut") {
      handleSignOut();
      return;
    }
    void clearBiometricUnlock(appSecureStore, { resetOffer: true }).catch(() => undefined);
    setServerUnreachable(false);
    setScreen({ name: "email" });
  };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colours.background} />
      {renderScreen()}
    </SafeAreaProvider>
  );

  function renderScreen(): ReactNode {
    switch (screen.name) {
      case "loading":
      case "signingOut": {
        return <LoadingScreen />;
      }
      case "signedIn": {
        return (
          <SignUpAttestationGate
            onReadStatus={readGateStatus}
            onAccept={() => acceptSignUpAttestation(accountSession())}
            onSignOut={handleSignOut}
            onRequestDeleteCode={() => requestAccountDeletionCode(accountSession())}
            onDeleteAccount={(code) => deleteAccount(accountSession(), code)}
            onAccountDeleted={handleAccountDeleted}
            onExportData={() => exportAccountData(accountSession())}>
            <SignedInScreen
              onSignOut={handleSignOut}
              onExportData={() => exportAccountData(accountSession())}
              onRequestDeleteCode={() => requestAccountDeletionCode(accountSession())}
              onDeleteAccount={(code) => deleteAccount(accountSession(), code)}
              onReadAgeConfirmation={() => readAgeConfirmation(accountSession())}
              onConfirmAdult={() => confirmAdult(accountSession())}
              onReadBiometricSetting={() => readBiometricSetting(appSecureStore)}
              onChangeBiometricUnlock={(on) => changeBiometricUnlock(appSecureStore, on)}
              onAccountDeleted={handleAccountDeleted}
            />
          </SignUpAttestationGate>
        );
      }
      case "biometricOffer": {
        return (
          <BiometricOfferScreen
            kind={screen.kind}
            onTurnOn={() => changeBiometricUnlock(appSecureStore, true)}
            onDone={() => setScreen({ name: "signedIn" })}
          />
        );
      }
      case "locked": {
        return <BiometricLockScreen kind={screen.kind} onUnlocked={() => setScreen({ name: "signedIn" })} onSignOut={handleSignOut} />;
      }
      case "code": {
        return (
          <CodeEntryScreen
            client={appAuthClient}
            secureStore={appSecureStore}
            email={screen.email}
            age18Confirmed={screen.age18Confirmed}
            linkError={linkError?.message ?? null}
            linkErrorReason={linkError?.reason ?? null}
            onClearLinkError={() => setLinkError(null)}
            serverUnreachable={serverUnreachable}
            onClearServerUnreachable={() => setServerUnreachable(false)}
            linkAttempt={linkAttempt}
            onSignedIn={() => handleSignedIn()}
            onBack={() => {
              setLinkError(null);
              setScreen({ name: "email" });
            }}
          />
        );
      }
      case "email": {
        return (
          <EmailEntryScreen
            client={appAuthClient}
            secureStore={appSecureStore}
            linkError={linkError?.message ?? null}
            linkErrorReason={linkError?.reason ?? null}
            onClearLinkError={() => setLinkError(null)}
            accountNotice={accountNotice}
            onClearAccountNotice={() => setAccountNotice(null)}
            serverUnreachable={serverUnreachable}
            onClearServerUnreachable={() => setServerUnreachable(false)}
            startupRetry={retry.startupRetry}
            focusEmailKey={retry.focusEmailKey}
            linkAttempt={linkAttempt}
            onCodeSent={(email, age18Confirmed) => setScreen({ name: "code", email, age18Confirmed })}
            socialProviders={appSocialProviders}
            socialSignIn={appSocialSignIn}
            onSignedIn={() => handleSignedIn()}
          />
        );
      }
    }
  }
}
