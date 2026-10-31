import { useEffect, useRef, useState } from "react";

interface StartupRetryOptions<Screen extends { readonly name: string }> {
  readonly serverUnreachable: boolean;
  readonly setServerUnreachable: (on: boolean) => void;
  readonly runCheck: () => Promise<Screen>;
  readonly setScreen: (update: (current: Screen) => Screen) => void;
}

export function useStartupRetry<Screen extends { readonly name: string }>({
  serverUnreachable,
  setServerUnreachable,
  runCheck,
  setScreen,
}: StartupRetryOptions<Screen>) {
  const [startupRetry, setStartupRetry] = useState<"idle" | "running" | null>(null);
  const retryingStartup = useRef(false);
  const [startupRetryFailures, setStartupRetryFailures] = useState(0);
  const [startupRetrySuccesses, setStartupRetrySuccesses] = useState(0);
  const startupRetryShown = useRef(false);
  startupRetryShown.current = startupRetry !== null;

  useEffect(() => {
    if (!serverUnreachable) {
      setStartupRetry(null);
    }
  }, [serverUnreachable]);

  const handleRetryStartup = () => {
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
