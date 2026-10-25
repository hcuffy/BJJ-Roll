import { useEffect, useState } from "react";

const ONE_SECOND_MS = 1000;

/** Wait before Resend code / Resend link turns on again. */
export const RESEND_COOLDOWN_SECONDS = 30;

/** "0:30" style label for a countdown in seconds. */
export function formatCountdown(seconds: number): string {
  const clamped = Math.max(seconds, 0);
  return `${Math.floor(clamped / 60)}:${String(clamped % 60).padStart(2, "0")}`;
}

/** Counts down once per second from `seconds`; `restart` starts it again. Returns the seconds left (0 when done). */
export function useCountdown(seconds: number): { readonly secondsLeft: number; readonly restart: () => void } {
  const [secondsLeft, setSecondsLeft] = useState(seconds);
  useEffect(() => {
    if (secondsLeft <= 0) {
      return undefined;
    }
    const timer = setTimeout(() => setSecondsLeft(secondsLeft - 1), ONE_SECOND_MS);
    return () => clearTimeout(timer);
  }, [secondsLeft]);
  return { secondsLeft, restart: () => setSecondsLeft(seconds) };
}
