import { useRef } from "react";
import { appAuthClient, appSecureStore } from "./auth/appAuthClient";
import { cancelPendingSignOut } from "./auth/signInActions";

interface TrackedRevoke {
  readonly stop: AbortController;
  readonly done: Promise<void>;
}

export function useLeftoverRevoke() {
  const current = useRef<TrackedRevoke | null>(null);
  const start = (deadline?: AbortSignal) => {
    const previous = current.current;
    previous?.stop.abort();
    const stop = new AbortController();
    deadline?.addEventListener("abort", () => stop.abort());
    const revokeAfterPrevious = async () => {
      await previous?.done;
      if (!stop.signal.aborted) {
        await cancelPendingSignOut(appAuthClient, appSecureStore, stop.signal);
      }
    };
    current.current = { stop, done: revokeAfterPrevious() };
  };
  const take = () => {
    const taken = current.current;
    current.current = null;
    return taken;
  };
  return { start, take };
}
