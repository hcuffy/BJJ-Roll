import { textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { StatusText } from "./StatusText";

/** Calm note when the backend could not be reached (copy per Vera, HEN-285). Cleared by the next submit attempt. */
export const SERVER_UNREACHABLE_NOTE = "Can't reach the server right now. Check your connection and try again.";

/** Try again under the note, for a note that came from the startup check (HEN-310). */
export interface StartupRetry {
  readonly onRetry: () => void;
  /** The check is running again: the button is busy and ignores taps. */
  readonly retrying: boolean;
}

export interface StartupRetryProps {
  /** Shown under the note while the note is up; re-runs the startup check. */
  readonly startupRetry?: StartupRetry;
}

/** The one "can't reach the server" message on every sign-in screen (HEN-287): muted, polite, never red. */
export function ServerUnreachableNote({ visible, startupRetry }: { readonly visible: boolean } & StartupRetryProps) {
  return (
    <>
      <StatusText message={visible ? SERVER_UNREACHABLE_NOTE : null} style={textStyles.bodyMuted} announce="polite" />
      {visible && startupRetry ? (
        <AuthButton
          title="Try again"
          variant="tertiary"
          loading={startupRetry.retrying}
          loadingTitle="Trying again…"
          onPress={startupRetry.onRetry}
        />
      ) : null}
    </>
  );
}
