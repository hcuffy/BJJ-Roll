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
import {
  cancelPendingSignOut,
  completeMagicLink,
  FAILURE_MESSAGES,
  type FailureReason,
  finishPendingSignOut,
  readSignedInUserId,
  signOut,
} from "./auth/signInActions";
import { createStartupBudget, type StartupBudget, withStartupTimeout } from "./auth/startupTimeout";
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
  | { readonly name: "signedIn" }
  | { readonly name: "signingOut" };

/** Runs the startup check in one budget: an unfinished sign-out first, then the session read (HEN-303, HEN-310). */
async function checkStartup(budget: StartupBudget): Promise<AuthScreen> {
  const signOutPending = await budget.run((signal) => finishPendingSignOut(appAuthClient, appSecureStore, signal));
  const userId = signOutPending ? null : await budget.run((signal) => readSignedInUserId(appAuthClient, signal));
  return userId ? { name: "signedIn" } : { name: "email" };
}

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
  // The note came from the startup check, so it gets a Try again: "idle", or "running" while the retry runs (HEN-310).
  const [startupRetry, setStartupRetry] = useState<"idle" | "running" | null>(null);
  const retryingStartup = useRef(false);

  // Signing in proves the server is reachable, so a note set earlier must not reappear later.
  useEffect(() => {
    if (screen.name === "signedIn") {
      setServerUnreachable(false);
    }
  }, [screen.name]);

  // Try again belongs to the startup note only; once the note goes, so does the button.
  useEffect(() => {
    if (!serverUnreachable) {
      setStartupRetry(null);
    }
  }, [serverUnreachable]);

  useEffect(() => {
    // A sign-out that failed last time is finished first; the user stays signed out on this launch either way.
    // All steps share one deadline, so a host that never answers cannot hold Loading (HEN-303, HEN-310); a timeout lands like a network failure.
    const budget = createStartupBudget();
    startupBudget.current = budget;
    void checkStartup(budget)
      .then(setStartupScreen)
      .catch(() => {
        // Backend unreachable: show sign-in with a note and Try again instead of loading forever.
        setServerUnreachable(true);
        setStartupRetry("idle");
        setStartupScreen({ name: "email" });
      });
  }, []);

  const handleRetryStartup = () => {
    // A second tap while the check runs does nothing.
    if (retryingStartup.current) {
      return;
    }
    retryingStartup.current = true;
    setStartupRetry("running");
    const budget = createStartupBudget();
    startupBudget.current = budget;
    void checkStartup(budget)
      .then((next) => {
        setServerUnreachable(false);
        // Moves only from sign-in: a code sent meanwhile keeps its screen.
        setScreen((current) => (current.name === "email" ? next : current));
      })
      .catch(() => setStartupRetry((current) => (current === null ? null : "idle")))
      .finally(() => {
        retryingStartup.current = false;
      });
  };

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
    // A link opened in the running app replaces the last result; at startup the startup note stays next to a link card.
    const openedInRunningApp = screen.name !== "loading";
    // A link that never answers times out into .catch like a network failure: the grey note only, never the card (HEN-303).
    // At startup it shares the startup budget (HEN-310).
    const exchange = (signal: AbortSignal) => completeMagicLink(appAuthClient, deepLinkUrl, signal);
    const startupLink = !openedInRunningApp && startupBudget.current;
    void (startupLink ? startupLink.run(exchange) : withStartupTimeout(exchange))
      .then((result) => {
        if (result.ok) {
          setLinkError(null);
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
    void cancelPendingSignOut(appAuthClient, appSecureStore);
    setScreen({ name: "signedIn" });
  };

  const handleSignOut = () => {
    // Loading at once, so the signed-in screen is never shown after the tap (HEN-314). signOut clears the phone first and
    // tells the server within the deadline; a sign-out the server did not confirm is finished on the next launch.
    setScreen({ name: "signingOut" });
    // A note from a link that failed while signed in is stale on the sign-in screen.
    setServerUnreachable(false);
    void withStartupTimeout((signal) => signOut(appAuthClient, appSecureStore, signal))
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
            startupRetry={startupRetry ? { onRetry: handleRetryStartup, retrying: startupRetry === "running" } : undefined}
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
