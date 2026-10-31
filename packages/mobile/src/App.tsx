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
  type AccountSession,
  type SignUpAttestationResult,
} from "./auth/accountActions";
import { appAuthClient, appBackendUrl, appSecureStore } from "./auth/appAuthClient";
import { appSocialProviders, appSocialSignIn } from "./auth/appSocialSignIn";
import { type BiometricKind, changeBiometricUnlock, clearBiometricUnlock, readBiometricSetting, takeBiometricOffer } from "./auth/biometricUnlock";
import { completeMagicLink, FAILURE_MESSAGES, type FailureReason, signOut } from "./auth/signInActions";
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

export function App() {
  const [screen, setScreen] = useState<AuthScreen>({ name: "loading" });
  // The reason travels with the message so the card can key extra guidance on it, not on the copy (Vera round 4 item 4).
  const [linkError, setLinkError] = useState<{ readonly message: string; readonly reason: FailureReason } | null>(null);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const [serverUnreachable, setServerUnreachable] = useState(false);
  // Counts sign-in links that failed; each one is a new attempt, so the screen drops what its last attempt showed (HEN-304).
  const [linkAttempt, setLinkAttempt] = useState(0);
  // Where startup lands (null while it runs); a link that started the app keeps Loading until its exchange settles.
  const [startupScreen, setStartupScreen] = useState<AuthScreen | null>(null);
  const deepLinkUrl = Linking.useURL();
  // One 10 s budget for all of startup, the gate's first status read included; a sign-in in the running app drops it (HEN-310).
  const startupBudget = useRef<StartupBudget | null>(null);
  // The launch's or sign-in's revoke of queued old sessions; a sign-out stops it and waits for it before it starts (HEN-315).
  const { start: startLeftoverRevoke, take: takeLeftoverRevoke } = useLeftoverRevoke();
  // Each startup check gets one 10 s budget for all its steps (HEN-303, HEN-310).
  const runStartupCheck = () => {
    const budget = createStartupBudget();
    startupBudget.current = budget;
    return checkStartup(budget, startLeftoverRevoke);
  };
  const retry = useStartupRetry({ serverUnreachable, setServerUnreachable, runCheck: runStartupCheck, setScreen });

  // Signing in proves the server is reachable, so a note set earlier must not reappear later.
  useEffect(() => {
    if (screen.name === "signedIn") {
      setServerUnreachable(false);
    }
    // The lock and the biometric offer wait on the user, so the gate's status read after them gets its own 10 s (HEN-288, HEN-310).
    if (screen.name === "locked" || screen.name === "biometricOffer") {
      startupBudget.current = null;
    }
  }, [screen.name]);

  useEffect(() => {
    // A sign-out that failed last time is finished first; the user stays signed out on this launch either way.
    // All steps share one deadline, so a host that never answers cannot hold Loading (HEN-303, HEN-310); a timeout lands like a network failure.
    void runStartupCheck()
      .then(setStartupScreen)
      .catch(() => {
        // Backend unreachable: show sign-in with a note and Try again instead of loading forever.
        setServerUnreachable(true);
        retry.offerRetry();
        setStartupScreen({ name: "email" });
      });
  }, []);

  // A link that started the app waits for the startup step, so a pending sign-out cannot end the session the link creates.
  useEffect(() => {
    if (!startupScreen) {
      return;
    }
    // Leaves Loading only once. A failed link leaves the user where they are; one that signs in moves them (to the lock if biometric unlock is on).
    const showStartupScreen = () => setScreen((current) => (current.name === "loading" ? startupScreen : current));
    if (!deepLinkUrl) {
      showStartupScreen();
      return;
    }
    // A link opened in the running app replaces the last result; at startup the startup note stays next to a link card.
    const openedInRunningApp = screen.name !== "loading";
    // A link that never answers times out into .catch like a network failure: the grey note only, never the card (HEN-303).
    // At startup it shares the startup budget (HEN-310).
    const exchange = (signal: AbortSignal) => completeMagicLink(appAuthClient, deepLinkUrl, signal);
    const startupLink = !openedInRunningApp && startupBudget.current;
    void (startupLink ? startupLink.run(exchange) : withStartupTimeout(exchange))
      .then(async (result) => {
        if (result.ok) {
          setLinkError(null);
          // Biometric unlock on (HEN-288, Henry 28 Oct): the link signs in, but the lock screen still shows first.
          // Its revoke of old sessions is tracked like a sign-in's, so a sign-out from the lock stops it and waits (HEN-315).
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

  // The gate's status read: the first one after startup uses what is left of its budget, any other gets its own (HEN-310).
  // A timeout shows the gate's offline note and its Try again.
  const readGateStatus = (): Promise<SignUpAttestationResult> => {
    const budget = startupBudget.current ?? createStartupBudget();
    startupBudget.current = null;
    return budget
      .run((signal) => readSignUpAttestation(accountSession(), signal))
      .catch(() => ({ ok: false, reason: "network", message: FAILURE_MESSAGES.network }));
  };

  const handleSignedIn = (atStartup = false) => {
    if (!atStartup) {
      startupBudget.current = null;
    }
    // A new sign-in cancels a sign-out left to finish and revokes its old session; if either fails the user still gets in.
    startLeftoverRevoke();
    // The biometric offer shows once per install; if it cannot be decided the user simply goes in.
    void takeBiometricOffer(appSecureStore)
      .catch(() => null)
      .then((kind) => setScreen(kind ? { name: "biometricOffer", kind } : { name: "signedIn" }));
  };

  const handleSignOut = () => {
    // Biometric unlock goes at the tap, best effort, never waiting on the server or a timeout (HEN-288, Stamp HEN-314 fix 2).
    void clearBiometricUnlock(appSecureStore).catch(() => undefined);
    // Loading at once, so the signed-in screen is never shown after the tap (HEN-314). signOut clears the phone first and
    // tells the server within the deadline; a sign-out the server did not confirm is finished on the next launch.
    setScreen({ name: "signingOut" });
    // A note from a link that failed while signed in is stale on the sign-in screen.
    setServerUnreachable(false);
    // A revoke still running from the sign-in is stopped (its sessions stay queued) and awaited, so the two never touch the
    // queue or the same session at once; signOut retries those sessions itself within the deadline.
    const leftover = takeLeftoverRevoke();
    leftover?.stop.abort();
    void withStartupTimeout(async (signal) => {
      await leftover?.done;
      await signOut(appAuthClient, appSecureStore, signal);
    })
      .catch(() => undefined)
      .finally(() => setScreen({ name: "email" }));
  };

  const handleAccountDeleted = () => {
    void clearBiometricUnlock(appSecureStore).catch(() => undefined);
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
      case "loading":
      case "signingOut": {
        return <LoadingScreen />;
      }
      case "signedIn": {
        // HEN-183: an account without the current sign-up attestation stays on the prompt until it accepts.
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
              // As on "Check your email": the card is about this view; App's note stays (HEN-287 item 1).
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
