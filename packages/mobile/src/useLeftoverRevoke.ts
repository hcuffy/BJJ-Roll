import { useRef } from "react";
import { appAuthClient, appSecureStore } from "./auth/appAuthClient";
import { cancelPendingSignOut, signOutOnPhone, signOutOnServerAfterPhone } from "./auth/signInActions";
import { startupDeadline } from "./auth/startupTimeout";

interface TrackedRevoke {
  readonly stop: AbortController;
  readonly done: Promise<void>;
}

export function useLeftoverRevoke() {
  const current = useRef<TrackedRevoke | null>(null);
  const start = (
    deadline?: AbortSignal,
    revoke: (signal: AbortSignal) => Promise<void> = (signal) => cancelPendingSignOut(appAuthClient, appSecureStore, signal),
  ) => {
    const previous = current.current;
    previous?.stop.abort();
    const stop = new AbortController();
    deadline?.addEventListener("abort", () => stop.abort());
    const revokeAfterPrevious = async () => {
      await previous?.done;
      if (!stop.signal.aborted) {
        await revoke(stop.signal);
      }
    };
    current.current = { stop, done: revokeAfterPrevious() };
  };
  const signOutStarted = useRef(new AbortController());
  const signOut = async () => {
    signOutStarted.current.abort();
    signOutStarted.current = new AbortController();
    const signedOut = await signOutOnPhone(appAuthClient, appSecureStore);
    start(startupDeadline(), (signal) => signOutOnServerAfterPhone(appAuthClient, appSecureStore, { ...signedOut, signal }));
  };
  return { start, signOut, signOutStarted };
}
