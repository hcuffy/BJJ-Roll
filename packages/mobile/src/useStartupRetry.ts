import { useEffect, useRef, useState } from "react";

interface StartupRetryOptions<Screen extends { readonly name: string }> {
  readonly serverUnreachable: boolean;
  readonly setServerUnreachable: (on: boolean) => void;
  /** Runs the startup check again in a fresh budget. */
  readonly runCheck: () => Promise<Screen>;
  readonly setScreen: (update: (current: Screen) => Screen) => void;
}

/** Try again under the startup offline note (HEN-310): its state, the retry itself, and the screen-reader keys. */
export function useStartupRetry<Screen extends { readonly name: string }>({
  serverUnreachable,
  setServerUnreachable,
  runCheck,
  setScreen,
}: StartupRetryOptions<Screen>) {
  // The note came from the startup check, so it gets a Try again: "idle", or "running" while the retry runs (HEN-310).
  const [startupRetry, setStartupRetry] = useState<"idle" | "running" | null>(null);
  const retryingStartup = useRef(false);
  // Bumped by each failed retry (the note is announced again) and each one that reached the server (focus moves to Email).
  const [startupRetryFailures, setStartupRetryFailures] = useState(0);
  const [startupRetrySuccesses, setStartupRetrySuccesses] = useState(0);
  // Read when a retry ends: if a send already removed Try again, focus stays where the user is.
  const startupRetryShown = useRef(false);
  startupRetryShown.current = startupRetry !== null;

  // Try again belongs to the startup note only; once the note goes, so does the button.
  useEffect(() => {
    if (!serverUnreachable) {
      setStartupRetry(null);
    }
  }, [serverUnreachable]);

  const handleRetryStartup = () => {
    // A second tap while the check runs does nothing.
    if (retryingStartup.current) {
      return;
    }
    retryingStartup.current = true;
    setStartupRetry("running");
    void runCheck()
      .then((next) => {
        if (startupRetryShown.current) {
          setStartupRetrySuccesses((count) => count + 1);
        }
        setServerUnreachable(false);
        // Moves only from sign-in: a code sent meanwhile keeps its screen.
        setScreen((current) => (current.name === "email" ? next : current));
      })
      .catch(() => {
        setStartupRetry((current) => (current === null ? null : "idle"));
        setStartupRetryFailures((count) => count + 1);
      })
      .finally(() => {
        retryingStartup.current = false;
      });
  };

  return {
    offerRetry: () => setStartupRetry("idle"),
    startupRetry: startupRetry ? { onRetry: handleRetryStartup, retrying: startupRetry === "running", announceKey: startupRetryFailures } : undefined,
    focusEmailKey: startupRetrySuccesses,
  };
}
