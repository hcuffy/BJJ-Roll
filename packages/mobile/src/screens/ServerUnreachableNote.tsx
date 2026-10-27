import { textStyles } from "../theme/tokens";
import { StatusText } from "./StatusText";

/** Calm note when the backend could not be reached (copy per Vera, HEN-285). Cleared by the next submit attempt. */
export const SERVER_UNREACHABLE_NOTE = "Can't reach the server right now. Check your connection and try again.";

/** The one "can't reach the server" message on every sign-in screen (HEN-287): muted, polite, never red. */
export function ServerUnreachableNote({ visible }: { readonly visible: boolean }) {
  return <StatusText message={visible ? SERVER_UNREACHABLE_NOTE : null} style={textStyles.bodyMuted} announce="polite" />;
}
